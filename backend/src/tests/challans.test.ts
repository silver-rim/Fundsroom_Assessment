/**
 * Sales challans — the core of the case study.
 *
 * What is being proven here:
 *   - a DRAFT never touches stock;
 *   - CONFIRM is all-or-nothing across every line;
 *   - the line items are a SNAPSHOT and never follow a later product change;
 *   - the lifecycle cannot be walked backwards;
 *   - two simultaneous confirmations of one challan deduct stock exactly once.
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

/** Creates a draft challan and returns its body. */
async function createDraft(items: Array<{ productId: number; quantity: number }>, notes?: string) {
  const response = await post(
    '/api/challans',
    { customerId: suite.fixtures.customers.active, items, ...(notes ? { notes } : {}) },
    suite.tokens.sales,
  );
  assert.equal(response.status, 201, `draft creation failed: ${JSON.stringify(response.body)}`);
  return response.body.data;
}

describe('POST /api/challans — draft', () => {
  it('creates a draft without touching stock', async () => {
    const productId = suite.fixtures.products.plenty;
    const before = await stockOf(productId);

    const challan = await createDraft([{ productId, quantity: 5 }]);

    assert.equal(challan.status, 'DRAFT');
    assert.equal(challan.totalQuantity, 5);
    assert.equal(challan.totalAmount, '500.00');
    assert.equal(await stockOf(productId), before, 'a draft must not move stock');
    assert.equal(await movementCount(productId), 1, 'a draft must not write a ledger row');
  });

  it('assigns sequential challan numbers in the CH-YYYY-NNNNNN format', async () => {
    const first = await createDraft([{ productId: suite.fixtures.products.plenty, quantity: 1 }]);
    const second = await createDraft([{ productId: suite.fixtures.products.plenty, quantity: 1 }]);

    const year = new Date().getFullYear();
    assert.equal(first.challanNumber, `CH-${year}-000001`);
    assert.equal(second.challanNumber, `CH-${year}-000002`);
  });

  it('prices lines from the product table, ignoring any price in the request', async () => {
    const response = await post(
      '/api/challans',
      {
        customerId: suite.fixtures.customers.active,
        items: [{ productId: suite.fixtures.products.plenty, quantity: 2, unitPrice: '0.01' }],
      },
      suite.tokens.sales,
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.data.items[0].unitPrice, '100.00');
    assert.equal(response.body.data.totalAmount, '200.00');
  });

  it('computes totals across several lines', async () => {
    const challan = await createDraft([
      { productId: suite.fixtures.products.plenty, quantity: 2 }, // 2 × 100.00 = 200.00
      { productId: suite.fixtures.products.low, quantity: 2 }, // 2 × 250.50 = 501.00
    ]);

    assert.equal(challan.totalQuantity, 4);
    assert.equal(challan.totalAmount, '701.00');
    assert.equal(challan.items.length, 2);
  });

  it('allows a draft for more stock than exists — the check belongs to confirm', async () => {
    const challan = await createDraft([{ productId: suite.fixtures.products.low, quantity: 999 }]);

    assert.equal(challan.status, 'DRAFT');
    assert.equal(await stockOf(suite.fixtures.products.low), 5);
  });

  it('allows a challan for a LEAD — a first order is how a lead converts', async () => {
    const response = await post(
      '/api/challans',
      {
        customerId: suite.fixtures.customers.dueYesterday, // LEAD
        items: [{ productId: suite.fixtures.products.plenty, quantity: 1 }],
      },
      suite.tokens.sales,
    );

    assert.equal(response.status, 201);
  });

  it('refuses a challan for an INACTIVE customer with 409', async () => {
    const response = await post(
      '/api/challans',
      {
        customerId: suite.fixtures.customers.noFollowUp, // INACTIVE
        items: [{ productId: suite.fixtures.products.plenty, quantity: 1 }],
      },
      suite.tokens.sales,
    );

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'INVALID_STATE');
  });

  it('404s for a customer that does not exist', async () => {
    const response = await post(
      '/api/challans',
      { customerId: 999999, items: [{ productId: suite.fixtures.products.plenty, quantity: 1 }] },
      suite.tokens.sales,
    );

    assert.equal(response.status, 404);
  });

  it('rejects an empty item list', async () => {
    const response = await post(
      '/api/challans',
      { customerId: suite.fixtures.customers.active, items: [] },
      suite.tokens.sales,
    );

    assert.equal(response.status, 422);
  });

  it('rejects duplicate products on one challan', async () => {
    const productId = suite.fixtures.products.plenty;
    const response = await post(
      '/api/challans',
      {
        customerId: suite.fixtures.customers.active,
        items: [
          { productId, quantity: 1 },
          { productId, quantity: 2 },
        ],
      },
      suite.tokens.sales,
    );

    assert.equal(response.status, 422);
  });

  it('rejects a zero or negative quantity', async () => {
    for (const quantity of [0, -3]) {
      const response = await post(
        '/api/challans',
        {
          customerId: suite.fixtures.customers.active,
          items: [{ productId: suite.fixtures.products.plenty, quantity }],
        },
        suite.tokens.sales,
      );
      assert.equal(response.status, 422, `quantity ${quantity} should be rejected`);
    }
  });

  it('refuses a deactivated product', async () => {
    const productId = suite.fixtures.products.plenty;
    await request('PATCH', `/api/products/${productId}/status`, {
      body: { isActive: false },
      token: suite.tokens.warehouse,
    });

    const response = await post(
      '/api/challans',
      { customerId: suite.fixtures.customers.active, items: [{ productId, quantity: 1 }] },
      suite.tokens.sales,
    );

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'INVALID_STATE');
  });

  it('reports every unusable product at once', async () => {
    const response = await post(
      '/api/challans',
      {
        customerId: suite.fixtures.customers.active,
        items: [
          { productId: 999998, quantity: 1 },
          { productId: 999999, quantity: 1 },
        ],
      },
      suite.tokens.sales,
    );

    assert.equal(response.status, 409);
    assert.equal(response.body.error.details.length, 2);
  });
});

describe('POST /api/challans — confirmImmediately', () => {
  it('creates and confirms in one transaction, deducting stock', async () => {
    const productId = suite.fixtures.products.plenty;

    const response = await post(
      '/api/challans',
      {
        customerId: suite.fixtures.customers.active,
        items: [{ productId, quantity: 10 }],
        confirmImmediately: true,
      },
      suite.tokens.sales,
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.data.status, 'CONFIRMED');
    assert.ok(response.body.data.confirmedAt);
    assert.equal(response.body.data.confirmedBy.name, 'Test Sales');
    assert.equal(await stockOf(productId), 90);
  });

  it('leaves no draft behind when the immediate confirm fails', async () => {
    const response = await post(
      '/api/challans',
      {
        customerId: suite.fixtures.customers.active,
        items: [{ productId: suite.fixtures.products.low, quantity: 999 }],
        confirmImmediately: true,
      },
      suite.tokens.sales,
    );

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'INSUFFICIENT_STOCK');

    // The creation rolled back with the confirmation: no orphaned draft.
    const list = await get('/api/challans', suite.tokens.sales);
    assert.equal(list.body.pagination.total, 0);
    assert.equal(await stockOf(suite.fixtures.products.low), 5);
  });
});

describe('POST /api/challans/:id/confirm', () => {
  it('deducts stock and writes one OUT movement per line', async () => {
    const plenty = suite.fixtures.products.plenty;
    const low = suite.fixtures.products.low;

    const challan = await createDraft([
      { productId: plenty, quantity: 10 },
      { productId: low, quantity: 2 },
    ]);

    const response = await post(`/api/challans/${challan.id}/confirm`, undefined, suite.tokens.warehouse);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'CONFIRMED');
    assert.equal(response.body.data.confirmedBy.name, 'Test Warehouse');

    assert.equal(await stockOf(plenty), 90);
    assert.equal(await stockOf(low), 3);

    const ledger = await get(
      `/api/stock-movements?referenceType=SALES_CHALLAN`,
      suite.tokens.warehouse,
    );
    assert.equal(ledger.body.pagination.total, 2);
    assert.ok(ledger.body.data.every((m: any) => m.movementType === 'OUT'));
    assert.ok(ledger.body.data.every((m: any) => m.referenceId === challan.id));
    assert.ok(
      ledger.body.data.every((m: any) => m.reason.includes(challan.challanNumber)),
      'the ledger reason should name the challan',
    );
  });

  it('is all-or-nothing: one short line rolls the whole confirmation back', async () => {
    const plenty = suite.fixtures.products.plenty; // 100 available
    const low = suite.fixtures.products.low; // 5 available

    const challan = await createDraft([
      { productId: plenty, quantity: 10 }, // fine
      { productId: low, quantity: 50 }, // impossible
    ]);

    const response = await post(`/api/challans/${challan.id}/confirm`, undefined, suite.tokens.admin);

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'INSUFFICIENT_STOCK');

    // The line that COULD have succeeded must not have been deducted.
    assert.equal(await stockOf(plenty), 100, 'the satisfiable line must be rolled back too');
    assert.equal(await stockOf(low), 5);
    assert.equal(await movementCount(plenty), 1, 'no ledger row for the rolled-back line');

    const after = await get(`/api/challans/${challan.id}`, suite.tokens.admin);
    assert.equal(after.body.data.status, 'DRAFT', 'the challan must remain a draft');
  });

  it('reports every short line at once, not just the first', async () => {
    const challan = await createDraft([
      { productId: suite.fixtures.products.low, quantity: 50 },
      { productId: suite.fixtures.products.zero, quantity: 1 },
    ]);

    const response = await post(`/api/challans/${challan.id}/confirm`, undefined, suite.tokens.admin);

    assert.equal(response.status, 409);
    assert.equal(response.body.error.details.length, 2);
  });

  it('allows a confirmation that takes stock to exactly zero', async () => {
    const challan = await createDraft([{ productId: suite.fixtures.products.low, quantity: 5 }]);

    const response = await post(`/api/challans/${challan.id}/confirm`, undefined, suite.tokens.admin);

    assert.equal(response.status, 200);
    assert.equal(await stockOf(suite.fixtures.products.low), 0);
  });

  it('refuses to confirm the same challan twice', async () => {
    const challan = await createDraft([{ productId: suite.fixtures.products.plenty, quantity: 5 }]);

    assert.equal(
      (await post(`/api/challans/${challan.id}/confirm`, undefined, suite.tokens.admin)).status,
      200,
    );

    const second = await post(`/api/challans/${challan.id}/confirm`, undefined, suite.tokens.admin);
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'INVALID_STATE');
    assert.equal(await stockOf(suite.fixtures.products.plenty), 95, 'stock deducted exactly once');
  });

  it('404s for a challan that does not exist', async () => {
    const response = await post('/api/challans/999999/confirm', undefined, suite.tokens.admin);

    assert.equal(response.status, 404);
  });
});

describe('product snapshot', () => {
  it('keeps the sold name, SKU and price after the product changes', async () => {
    const productId = suite.fixtures.products.plenty;

    const challan = await createDraft([{ productId, quantity: 2 }]);
    await post(`/api/challans/${challan.id}/confirm`, undefined, suite.tokens.admin);

    // Rename and reprice the product AFTER the sale.
    const renamed = await put(
      `/api/products/${productId}`,
      {
        name: 'Completely Different Name',
        sku: 'RENAMED-1',
        category: 'Changed',
        unitPrice: '999.00',
        minStockAlert: 1,
        location: 'Elsewhere',
      },
      suite.tokens.warehouse,
    );
    assert.equal(renamed.status, 200);

    const after = await get(`/api/challans/${challan.id}`, suite.tokens.admin);
    const item = after.body.data.items[0];

    assert.equal(item.productName, 'Plenty Widget', 'the document must keep the name it was signed with');
    assert.equal(item.productSku, 'PLENTY-1');
    assert.equal(item.unitPrice, '100.00');
    assert.equal(after.body.data.totalAmount, '200.00', 'the total must not be rewritten');

    // The link to the live product is still there for analytics.
    assert.equal(item.productId, productId);
  });

  it('records the price at the moment of confirmation, not of drafting', async () => {
    const productId = suite.fixtures.products.plenty;

    const challan = await createDraft([{ productId, quantity: 2 }]);

    await put(
      `/api/products/${productId}`,
      {
        name: 'Plenty Widget',
        sku: 'PLENTY-1',
        category: 'Testing',
        unitPrice: '150.00',
        minStockAlert: 10,
        location: 'Test Rack',
      },
      suite.tokens.warehouse,
    );

    await post(`/api/challans/${challan.id}/confirm`, undefined, suite.tokens.admin);

    const after = await get(`/api/challans/${challan.id}`, suite.tokens.admin);
    assert.equal(after.body.data.items[0].unitPrice, '150.00');
    assert.equal(after.body.data.totalAmount, '300.00');
  });
});

describe('PUT /api/challans/:id', () => {
  it('replaces a draft', async () => {
    const challan = await createDraft([{ productId: suite.fixtures.products.plenty, quantity: 1 }]);

    const response = await put(
      `/api/challans/${challan.id}`,
      {
        customerId: suite.fixtures.customers.dueToday,
        items: [{ productId: suite.fixtures.products.low, quantity: 3 }],
        notes: 'Rewritten',
      },
      suite.tokens.sales,
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.data.customer.id, suite.fixtures.customers.dueToday);
    assert.equal(response.body.data.items.length, 1);
    assert.equal(response.body.data.totalAmount, '751.50');
    assert.equal(response.body.data.notes, 'Rewritten');
  });

  it('refuses to edit a confirmed challan', async () => {
    const challan = await createDraft([{ productId: suite.fixtures.products.plenty, quantity: 1 }]);
    await post(`/api/challans/${challan.id}/confirm`, undefined, suite.tokens.admin);

    const response = await put(
      `/api/challans/${challan.id}`,
      {
        customerId: suite.fixtures.customers.active,
        items: [{ productId: suite.fixtures.products.plenty, quantity: 50 }],
      },
      suite.tokens.sales,
    );

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'INVALID_STATE');
  });
});

describe('POST /api/challans/:id/cancel', () => {
  it('cancels a draft without touching stock', async () => {
    const productId = suite.fixtures.products.plenty;
    const challan = await createDraft([{ productId, quantity: 5 }]);

    const response = await post(
      `/api/challans/${challan.id}/cancel`,
      { reason: 'Customer withdrew the order' },
      suite.tokens.sales,
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'CANCELLED');
    assert.ok(response.body.data.cancelledAt);
    assert.equal(await stockOf(productId), 100);
  });

  it('refuses to cancel a confirmed challan — that would silently invent stock', async () => {
    const productId = suite.fixtures.products.plenty;
    const challan = await createDraft([{ productId, quantity: 5 }]);
    await post(`/api/challans/${challan.id}/confirm`, undefined, suite.tokens.admin);

    const response = await post(`/api/challans/${challan.id}/cancel`, undefined, suite.tokens.admin);

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'INVALID_STATE');
    assert.ok(
      response.body.error.message.toLowerCase().includes('return'),
      'the message should point at the returns flow',
    );
    assert.equal(await stockOf(productId), 95, 'stock must not be given back');
  });

  it('refuses to confirm a cancelled challan', async () => {
    const challan = await createDraft([{ productId: suite.fixtures.products.plenty, quantity: 1 }]);
    await post(`/api/challans/${challan.id}/cancel`, undefined, suite.tokens.sales);

    const response = await post(`/api/challans/${challan.id}/confirm`, undefined, suite.tokens.admin);

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'INVALID_STATE');
  });

  it('refuses to cancel twice', async () => {
    const challan = await createDraft([{ productId: suite.fixtures.products.plenty, quantity: 1 }]);
    await post(`/api/challans/${challan.id}/cancel`, undefined, suite.tokens.sales);

    const second = await post(`/api/challans/${challan.id}/cancel`, undefined, suite.tokens.sales);
    assert.equal(second.status, 409);
  });
});

describe('GET /api/challans', () => {
  it('filters by status and by customer, and searches by number', async () => {
    const draft = await createDraft([{ productId: suite.fixtures.products.plenty, quantity: 1 }]);
    const confirmed = await createDraft([{ productId: suite.fixtures.products.plenty, quantity: 1 }]);
    await post(`/api/challans/${confirmed.id}/confirm`, undefined, suite.tokens.admin);

    const drafts = await get('/api/challans?status=DRAFT', suite.tokens.accounts);
    assert.equal(drafts.body.pagination.total, 1);
    assert.equal(drafts.body.data[0].id, draft.id);

    const byCustomer = await get(
      `/api/challans?customerId=${suite.fixtures.customers.active}`,
      suite.tokens.accounts,
    );
    assert.equal(byCustomer.body.pagination.total, 2);

    const bySearch = await get(
      `/api/challans?search=${encodeURIComponent(draft.challanNumber)}`,
      suite.tokens.accounts,
    );
    assert.equal(bySearch.body.pagination.total, 1);
  });

  it('lists a customer’s challans through the nested route', async () => {
    await createDraft([{ productId: suite.fixtures.products.plenty, quantity: 1 }]);

    const response = await get(
      `/api/customers/${suite.fixtures.customers.active}/challans`,
      suite.tokens.accounts,
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.pagination.total, 1);
  });
});

describe('concurrency — confirming one challan twice at once', () => {
  it('deducts stock exactly once when two confirmations race', async () => {
    const productId = suite.fixtures.products.plenty; // 100
    const challan = await createDraft([{ productId, quantity: 30 }]);

    const [a, b] = await Promise.all([
      post(`/api/challans/${challan.id}/confirm`, undefined, suite.tokens.admin),
      post(`/api/challans/${challan.id}/confirm`, undefined, suite.tokens.warehouse),
    ]);

    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409], 'exactly one confirmation should win');

    assert.equal(await stockOf(productId), 70, 'stock deducted once, not twice');
    assert.equal(await movementCount(productId), 2, 'one opening movement plus one OUT');
  });

  it('serialises eight simultaneous confirmations of different challans on one product', async () => {
    const productId = suite.fixtures.products.plenty; // 100 available

    // 8 challans × 30 units = 240 requested. Only 3 can be satisfied.
    const challans = [];
    for (let i = 0; i < 8; i += 1) {
      challans.push(await createDraft([{ productId, quantity: 30 }]));
    }

    const results = await Promise.all(
      challans.map((challan) =>
        post(`/api/challans/${challan.id}/confirm`, undefined, suite.tokens.admin),
      ),
    );

    const confirmed = results.filter((r) => r.status === 200).length;
    const refused = results.filter((r) => r.status === 409).length;

    assert.equal(confirmed, 3, 'exactly 3 of 8 fit into 100 units');
    assert.equal(refused, 5);

    const finalStock = await stockOf(productId);
    assert.equal(finalStock, 10);
    assert.ok(finalStock >= 0);

    const sum = await query<{ total: string }>(
      `SELECT COALESCE(sum(CASE WHEN movement_type = 'IN' THEN quantity ELSE -quantity END), 0) AS total
         FROM stock_movements WHERE product_id = $1`,
      [productId],
    );
    assert.equal(Number(sum.rows[0]!.total), 10, 'ledger must reconcile after the race');
  });
});
