/**
 * Products, the stock ledger, and the negative-stock guarantee.
 *
 * The invariant under test throughout:
 *
 *     stock never goes negative, and products.current_stock always equals the
 *     sum of that product's movements.
 *
 * The concurrency test at the bottom is the one that matters. It is the only
 * way to prove the row lock does its job — a sequential test passes even with
 * the lock removed.
 */
import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, put, request, stopServer } from './helpers/api';
import { closeDatabase, movementCount, query, stockOf } from './helpers/db';
import { setupSuite, type Suite } from './helpers/setup';

let suite: Suite;

beforeEach(async () => {
  suite = await setupSuite();
});

after(async () => {
  await stopServer();
  await closeDatabase();
});

function validProduct(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test Product',
    sku: 'TEST-NEW-1',
    category: 'Testing',
    unitPrice: '199.99',
    minStockAlert: 10,
    location: 'Test Rack',
    ...overrides,
  };
}

describe('POST /api/products', () => {
  it('creates a product with zero stock and no ledger entry', async () => {
    const response = await post('/api/products', validProduct(), suite.tokens.warehouse);

    assert.equal(response.status, 201);
    assert.equal(response.body.data.currentStock, 0);
    assert.equal(response.body.data.isActive, true);
    assert.equal(await movementCount(response.body.data.id), 0);
  });

  it('writes opening stock through the ledger, not by direct assignment', async () => {
    const response = await post(
      '/api/products',
      validProduct({ openingStock: 40 }),
      suite.tokens.warehouse,
    );

    assert.equal(response.status, 201);
    const id = response.body.data.id;
    assert.equal(response.body.data.currentStock, 40);

    const ledger = await get(`/api/stock-movements?productId=${id}`, suite.tokens.warehouse);
    assert.equal(ledger.body.pagination.total, 1);
    assert.equal(ledger.body.data[0].movementType, 'IN');
    assert.equal(ledger.body.data[0].quantity, 40);
    assert.equal(ledger.body.data[0].balanceAfter, 40);
    assert.equal(ledger.body.data[0].referenceType, 'MANUAL');
  });

  it('upper-cases the SKU', async () => {
    const response = await post(
      '/api/products',
      validProduct({ sku: 'lower-case-sku' }),
      suite.tokens.admin,
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.data.sku, 'LOWER-CASE-SKU');
  });

  it('rejects a duplicate SKU, case-insensitively', async () => {
    const response = await post('/api/products', validProduct({ sku: 'plenty-1' }), suite.tokens.admin);

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'DUPLICATE_SKU');
  });

  it('refuses a direct currentStock write instead of ignoring it', async () => {
    const response = await post(
      '/api/products',
      validProduct({ currentStock: 500 }),
      suite.tokens.warehouse,
    );

    assert.equal(response.status, 422);
    assert.ok(
      JSON.stringify(response.body).includes('stock movement'),
      'the error should say what to do instead',
    );
  });

  it('rejects a negative price and more than two decimals', async () => {
    for (const unitPrice of ['-1.00', '10.999', 'abc']) {
      const response = await post(
        '/api/products',
        validProduct({ sku: `SKU-${Math.random().toString(36).slice(2, 8)}`, unitPrice }),
        suite.tokens.admin,
      );
      assert.equal(response.status, 422, `price ${unitPrice} should be rejected`);
    }
  });

  it('keeps price precision exactly — no float rounding', async () => {
    const response = await post(
      '/api/products',
      validProduct({ sku: 'PRECISE-1', unitPrice: '1234567.89' }),
      suite.tokens.admin,
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.data.unitPrice, '1234567.89');
  });

  it('rejects a SKU with characters the constraint forbids', async () => {
    const response = await post('/api/products', validProduct({ sku: 'BAD SKU!' }), suite.tokens.admin);

    assert.equal(response.status, 422);
  });
});

describe('GET /api/products', () => {
  it('hides inactive products by default and shows them on request', async () => {
    const id = suite.fixtures.products.plenty;
    await request('PATCH', `/api/products/${id}/status`, {
      body: { isActive: false },
      token: suite.tokens.warehouse,
    });

    const byDefault = await get('/api/products', suite.tokens.sales);
    assert.equal(byDefault.body.pagination.total, 3);

    const all = await get('/api/products?isActive=all', suite.tokens.sales);
    assert.equal(all.body.pagination.total, 4);

    const inactive = await get('/api/products?isActive=false', suite.tokens.sales);
    assert.equal(inactive.body.pagination.total, 1);
  });

  it('filters low stock as `<=`, so a product exactly at its threshold counts', async () => {
    const response = await get('/api/products?lowStock=true', suite.tokens.warehouse);

    assert.equal(response.status, 200);
    // LOW (5/20), ZERO (0/5) and EXACT (10/10) — but not PLENTY (100/10).
    assert.equal(response.body.pagination.total, 3);
    const skus = response.body.data.map((p: any) => p.sku).sort();
    assert.deepEqual(skus, ['EXACT-1', 'LOW-1', 'ZERO-1']);
  });

  it('reports isLowStock per product', async () => {
    const response = await get('/api/products?isActive=all', suite.tokens.admin);
    const bySku = Object.fromEntries(response.body.data.map((p: any) => [p.sku, p.isLowStock]));

    assert.equal(bySku['PLENTY-1'], false);
    assert.equal(bySku['LOW-1'], true);
    assert.equal(bySku['ZERO-1'], true);
    assert.equal(bySku['EXACT-1'], true);
  });

  it('searches name, SKU and category', async () => {
    for (const term of ['Plenty', 'PLENTY-1', 'Testing']) {
      const response = await get(`/api/products?search=${encodeURIComponent(term)}`, suite.tokens.admin);
      assert.equal(response.status, 200);
      assert.ok(response.body.pagination.total >= 1, `search "${term}" found nothing`);
    }
  });

  it('treats LIKE wildcards in a search term as literal characters', async () => {
    // SKUs are allowed to contain underscores, so `_` has to mean `_` and not
    // "any character" — otherwise searching for the SKU LOW_1 silently returns
    // LOW-1 as well, and the user cannot tell the two products apart.
    const underscore = await get('/api/products?search=LOW_1', suite.tokens.admin);
    assert.equal(underscore.status, 200);
    assert.equal(underscore.body.pagination.total, 0, '_ must not match a hyphen');

    const percent = await get('/api/products?search=%25', suite.tokens.admin);
    assert.equal(percent.status, 200);
    assert.equal(percent.body.pagination.total, 0, '% must not match everything');
  });

  it('handles a backslash — LIKE’s escape character — in a search term', async () => {
    const response = await get('/api/products?search=%5C', suite.tokens.admin);

    assert.equal(response.status, 200);
    assert.equal(response.body.pagination.total, 0);
  });

  it('sorts by stock ascending', async () => {
    const response = await get(
      '/api/products?sortBy=currentStock&sortOrder=asc&isActive=all',
      suite.tokens.admin,
    );

    const stocks = response.body.data.map((p: any) => p.currentStock);
    assert.deepEqual(stocks, [...stocks].sort((a: number, b: number) => a - b));
  });
});

describe('PUT /api/products/:id', () => {
  it('updates fields without touching stock', async () => {
    const id = suite.fixtures.products.plenty;
    const before = await stockOf(id);

    const response = await put(
      `/api/products/${id}`,
      validProduct({ name: 'Renamed Widget', sku: 'PLENTY-1', minStockAlert: 50 }),
      suite.tokens.warehouse,
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.data.name, 'Renamed Widget');
    assert.equal(await stockOf(id), before, 'an edit must not change stock');
  });

  it('refuses a currentStock field on update too', async () => {
    const id = suite.fixtures.products.plenty;
    const response = await put(
      `/api/products/${id}`,
      validProduct({ sku: 'PLENTY-1', currentStock: 9999 }),
      suite.tokens.warehouse,
    );

    assert.equal(response.status, 422);
    assert.equal(await stockOf(id), 100);
  });

  it("rejects taking another product's SKU", async () => {
    const response = await put(
      `/api/products/${suite.fixtures.products.plenty}`,
      validProduct({ sku: 'LOW-1' }),
      suite.tokens.admin,
    );

    assert.equal(response.status, 409);
  });
});

describe('POST /api/stock-movements', () => {
  it('records an IN movement and raises stock', async () => {
    const id = suite.fixtures.products.low;

    const response = await post(
      '/api/stock-movements',
      { productId: id, movementType: 'IN', quantity: 45, reason: 'Purchase order 8842 received' },
      suite.tokens.warehouse,
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.data.balanceAfter, 50);
    assert.equal(await stockOf(id), 50);
  });

  it('records an OUT movement and lowers stock', async () => {
    const id = suite.fixtures.products.plenty;

    const response = await post(
      '/api/stock-movements',
      { productId: id, movementType: 'OUT', quantity: 30, reason: 'Damaged in the warehouse' },
      suite.tokens.warehouse,
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.data.balanceAfter, 70);
    assert.equal(await stockOf(id), 70);
  });

  it('refuses an OUT larger than the stock on hand, naming the real numbers', async () => {
    const id = suite.fixtures.products.low; // 5 in stock

    const response = await post(
      '/api/stock-movements',
      { productId: id, movementType: 'OUT', quantity: 6, reason: 'Attempt to oversell' },
      suite.tokens.warehouse,
    );

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'INSUFFICIENT_STOCK');
    assert.ok(response.body.error.message.includes('5'), 'message should name what is available');
    assert.equal(await stockOf(id), 5, 'a refused movement must not change stock');
    assert.equal(await movementCount(id), 1, 'a refused movement must not reach the ledger');
  });

  it('allows an OUT that takes stock to exactly zero', async () => {
    const id = suite.fixtures.products.low;

    const response = await post(
      '/api/stock-movements',
      { productId: id, movementType: 'OUT', quantity: 5, reason: 'Clearing the shelf' },
      suite.tokens.warehouse,
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.data.balanceAfter, 0);
    assert.equal(await stockOf(id), 0);
  });

  it('refuses any OUT against a product already at zero', async () => {
    const response = await post(
      '/api/stock-movements',
      {
        productId: suite.fixtures.products.zero,
        movementType: 'OUT',
        quantity: 1,
        reason: 'Nothing to give',
      },
      suite.tokens.warehouse,
    );

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'INSUFFICIENT_STOCK');
  });

  it('requires a reason of at least 3 characters', async () => {
    for (const reason of [undefined, '', 'ab', '   ']) {
      const response = await post(
        '/api/stock-movements',
        { productId: suite.fixtures.products.plenty, movementType: 'IN', quantity: 1, reason },
        suite.tokens.warehouse,
      );
      assert.equal(response.status, 422, `reason ${JSON.stringify(reason)} should be rejected`);
    }
  });

  it('rejects zero and negative quantities', async () => {
    for (const quantity of [0, -5]) {
      const response = await post(
        '/api/stock-movements',
        {
          productId: suite.fixtures.products.plenty,
          movementType: 'IN',
          quantity,
          reason: 'Invalid quantity test',
        },
        suite.tokens.warehouse,
      );
      assert.equal(response.status, 422, `quantity ${quantity} should be rejected`);
    }
  });

  it('rejects an unknown movement type rather than coercing it', async () => {
    const response = await post(
      '/api/stock-movements',
      {
        productId: suite.fixtures.products.plenty,
        movementType: 'SIDEWAYS',
        quantity: 1,
        reason: 'Unknown direction',
      },
      suite.tokens.warehouse,
    );

    assert.equal(response.status, 422);
  });

  it('404s for a product that does not exist', async () => {
    const response = await post(
      '/api/stock-movements',
      { productId: 999999, movementType: 'IN', quantity: 1, reason: 'Ghost product' },
      suite.tokens.warehouse,
    );

    assert.equal(response.status, 404);
  });

  it('keeps the running balance consistent across a sequence', async () => {
    const id = suite.fixtures.products.plenty;
    const steps: Array<['IN' | 'OUT', number, number]> = [
      ['OUT', 10, 90],
      ['IN', 25, 115],
      ['OUT', 15, 100],
      ['OUT', 100, 0],
      ['IN', 7, 7],
    ];

    for (const [movementType, quantity, expected] of steps) {
      const response = await post(
        '/api/stock-movements',
        { productId: id, movementType, quantity, reason: `Sequence step ${movementType} ${quantity}` },
        suite.tokens.warehouse,
      );
      assert.equal(response.status, 201);
      assert.equal(response.body.data.balanceAfter, expected);
    }

    assert.equal(await stockOf(id), 7);

    // The ledger must reconcile to the stored figure, independently computed.
    const sum = await query<{ total: string }>(
      `SELECT COALESCE(sum(CASE WHEN movement_type = 'IN' THEN quantity ELSE -quantity END), 0) AS total
         FROM stock_movements WHERE product_id = $1`,
      [id],
    );
    assert.equal(Number(sum.rows[0]!.total), 7, 'ledger sum must equal current_stock');
  });
});

describe('GET /api/stock-movements', () => {
  it('filters by product, type and reference type', async () => {
    const id = suite.fixtures.products.plenty;
    await post(
      '/api/stock-movements',
      { productId: id, movementType: 'OUT', quantity: 3, reason: 'Filter fixture' },
      suite.tokens.warehouse,
    );

    const byProduct = await get(`/api/stock-movements?productId=${id}`, suite.tokens.accounts);
    assert.equal(byProduct.body.pagination.total, 2);

    const outOnly = await get(
      `/api/stock-movements?productId=${id}&movementType=OUT`,
      suite.tokens.accounts,
    );
    assert.equal(outOnly.body.pagination.total, 1);

    const manual = await get('/api/stock-movements?referenceType=MANUAL', suite.tokens.accounts);
    assert.equal(manual.body.pagination.total, 4); // 3 opening + 1 above
  });

  it('rejects a reversed date range', async () => {
    const response = await get(
      '/api/stock-movements?dateFrom=2026-08-10&dateTo=2026-08-01',
      suite.tokens.admin,
    );

    assert.equal(response.status, 422);
  });

  it('is append-only: there is no update or delete route', async () => {
    const ledger = await get('/api/stock-movements', suite.tokens.admin);
    const movementId = ledger.body.data[0].id;

    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const response = await request(method, `/api/stock-movements/${movementId}`, {
        token: suite.tokens.admin,
        body: {},
      });
      assert.equal(response.status, 404, `${method} on a movement should not exist`);
    }
  });
});

describe('concurrency — the row lock', () => {
  it('serialises simultaneous OUT movements so stock cannot go negative', async () => {
    const id = suite.fixtures.products.plenty; // 100 in stock

    // 20 requests × 10 units = 200 requested against 100 available. Exactly 10
    // must succeed and 10 must be refused. Without SELECT … FOR UPDATE these
    // would all read 100, all conclude there is room, and drive stock negative.
    const attempts = Array.from({ length: 20 }, (_, index) =>
      post(
        '/api/stock-movements',
        {
          productId: id,
          movementType: 'OUT',
          quantity: 10,
          reason: `Concurrent dispatch ${index + 1}`,
        },
        suite.tokens.warehouse,
      ),
    );

    const results = await Promise.all(attempts);
    const succeeded = results.filter((r) => r.status === 201).length;
    const refused = results.filter((r) => r.status === 409).length;

    assert.equal(succeeded, 10, 'exactly 10 of 20 should succeed');
    assert.equal(refused, 10, 'the other 10 must be refused with 409');
    assert.equal(succeeded + refused, 20, 'no request should fail any other way');

    const finalStock = await stockOf(id);
    assert.equal(finalStock, 0);
    assert.ok(finalStock >= 0, 'stock must never be negative');

    // 1 opening movement + 10 successful OUTs. The refused ones left no trace.
    assert.equal(await movementCount(id), 11);

    const sum = await query<{ total: string }>(
      `SELECT COALESCE(sum(CASE WHEN movement_type = 'IN' THEN quantity ELSE -quantity END), 0) AS total
         FROM stock_movements WHERE product_id = $1`,
      [id],
    );
    assert.equal(Number(sum.rows[0]!.total), 0, 'ledger must still reconcile after the race');
  });
});
