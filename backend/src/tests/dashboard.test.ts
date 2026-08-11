/**
 * Dashboard aggregates.
 *
 * Every assertion here is written against the fixture set in helpers/db.ts, and
 * several of them cross-check a counter against the list endpoint that shows the
 * same rows — a tile that disagrees with the screen behind it is the specific
 * failure this module has to avoid.
 */
import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, request, stopServer } from './helpers/api';
import { closeDatabase, dateFromToday } from './helpers/db';
import { setupSuite, type Suite } from './helpers/setup';

let suite: Suite;

beforeEach(async () => {
  suite = await setupSuite();
});

after(async () => {
  await stopServer();
  await closeDatabase();
});

const summary = () => get('/api/dashboard/summary', suite.tokens.admin);

describe('GET /api/dashboard/summary', () => {
  it('returns every documented section', async () => {
    const response = await summary();

    assert.equal(response.status, 200);
    for (const key of [
      'customers',
      'products',
      'challans',
      'lowStockProducts',
      'recentChallans',
      'recentMovements',
    ]) {
      assert.ok(key in response.body.data, `missing section: ${key}`);
    }
  });

  it('counts customers by status, ignoring soft-deleted rows', async () => {
    const before = (await summary()).body.data.customers;
    assert.deepEqual(before, { total: 5, active: 2, leads: 2, followUpsDue: 2 });

    await request('DELETE', `/api/customers/${suite.fixtures.customers.active}`, {
      token: suite.tokens.admin,
    });

    const after = (await summary()).body.data.customers;
    assert.equal(after.total, 4, 'a soft-deleted customer must leave the count');
    assert.equal(after.active, 1);
  });

  it('agrees with the customer list about how many follow-ups are due', async () => {
    const counter = (await summary()).body.data.customers.followUpsDue;
    const list = await get(
      `/api/customers?followUpBefore=${dateFromToday(0)}`,
      suite.tokens.admin,
    );

    assert.equal(counter, list.body.pagination.total);
  });

  it('counts products, with outOfStock a subset of lowStock', async () => {
    const products = (await summary()).body.data.products;

    assert.deepEqual(products, { total: 4, lowStock: 3, outOfStock: 1, inactive: 0 });
    assert.ok(products.outOfStock <= products.lowStock, 'outOfStock must be a subset');
  });

  it('agrees with the product list about how many are low', async () => {
    const counter = (await summary()).body.data.products.lowStock;
    const list = await get('/api/products?lowStock=true', suite.tokens.admin);

    assert.equal(counter, list.body.pagination.total);
  });

  it('excludes deactivated products from the stock counters but not from the total', async () => {
    await request('PATCH', `/api/products/${suite.fixtures.products.zero}/status`, {
      body: { isActive: false },
      token: suite.tokens.warehouse,
    });

    const products = (await summary()).body.data.products;

    assert.equal(products.total, 4, 'the total still counts every product');
    assert.equal(products.inactive, 1);
    assert.equal(products.lowStock, 2, 'the deactivated one drops out of lowStock');
    assert.equal(products.outOfStock, 0, 'and out of outOfStock');
  });

  it('reports zero challans and 0.00 value on an empty month', async () => {
    const challans = (await summary()).body.data.challans;

    assert.deepEqual(challans, {
      total: 0,
      draft: 0,
      confirmed: 0,
      cancelled: 0,
      confirmedThisMonth: 0,
      valueThisMonth: '0.00',
    });
  });

  it('formats money as a 2-decimal string, never a number', async () => {
    const value = (await summary()).body.data.challans.valueThisMonth;

    assert.equal(typeof value, 'string');
    assert.match(value, /^\d+\.\d{2}$/);
  });

  it('counts a draft but does not count it as dispatched', async () => {
    await post(
      '/api/challans',
      {
        customerId: suite.fixtures.customers.active,
        items: [{ productId: suite.fixtures.products.plenty, quantity: 3 }],
      },
      suite.tokens.sales,
    );

    const challans = (await summary()).body.data.challans;

    assert.equal(challans.total, 1);
    assert.equal(challans.draft, 1);
    assert.equal(challans.confirmedThisMonth, 0, 'a draft ships nothing');
    assert.equal(challans.valueThisMonth, '0.00');
  });

  it('counts a confirmed challan in the month value', async () => {
    await post(
      '/api/challans',
      {
        customerId: suite.fixtures.customers.active,
        items: [{ productId: suite.fixtures.products.plenty, quantity: 3 }], // 3 × 100.00
        confirmImmediately: true,
      },
      suite.tokens.sales,
    );

    const challans = (await summary()).body.data.challans;

    assert.equal(challans.confirmed, 1);
    assert.equal(challans.confirmedThisMonth, 1);
    assert.equal(challans.valueThisMonth, '300.00');
  });

  it('excludes a cancelled challan from the month value', async () => {
    const created = await post(
      '/api/challans',
      {
        customerId: suite.fixtures.customers.active,
        items: [{ productId: suite.fixtures.products.plenty, quantity: 3 }],
      },
      suite.tokens.sales,
    );
    await post(`/api/challans/${created.body.data.id}/cancel`, undefined, suite.tokens.sales);

    const challans = (await summary()).body.data.challans;

    assert.equal(challans.cancelled, 1);
    assert.equal(challans.valueThisMonth, '0.00');
  });

  it('orders low-stock products by how far below the threshold they are', async () => {
    const list = (await summary()).body.data.lowStockProducts;

    // LOW is 15 under, ZERO is 5 under, EXACT is exactly at the line.
    assert.deepEqual(
      list.map((p: any) => p.sku),
      ['LOW-1', 'ZERO-1', 'EXACT-1'],
    );
    assert.equal(list[0].currentStock, 5);
    assert.equal(list[0].minStockAlert, 20);
  });

  it('caps each activity list at five rows', async () => {
    for (let i = 0; i < 7; i += 1) {
      await post(
        '/api/stock-movements',
        {
          productId: suite.fixtures.products.plenty,
          movementType: 'IN',
          quantity: 1,
          reason: `Cap test ${i}`,
        },
        suite.tokens.warehouse,
      );
    }

    const data = (await summary()).body.data;
    assert.equal(data.recentMovements.length, 5);
  });

  it('lists recent challans newest first with the customer business name', async () => {
    const first = await post(
      '/api/challans',
      {
        customerId: suite.fixtures.customers.active,
        items: [{ productId: suite.fixtures.products.plenty, quantity: 1 }],
      },
      suite.tokens.sales,
    );
    const second = await post(
      '/api/challans',
      {
        customerId: suite.fixtures.customers.dueToday,
        items: [{ productId: suite.fixtures.products.plenty, quantity: 1 }],
      },
      suite.tokens.sales,
    );

    const recent = (await summary()).body.data.recentChallans;

    assert.equal(recent[0].id, second.body.data.id, 'newest first');
    assert.equal(recent[1].id, first.body.data.id);
    assert.equal(recent[0].customerName, 'Gamma Works');
  });

  it('shows the confirmation OUT movement, with the balance it produced', async () => {
    await post(
      '/api/challans',
      {
        customerId: suite.fixtures.customers.active,
        items: [{ productId: suite.fixtures.products.plenty, quantity: 4 }],
        confirmImmediately: true,
      },
      suite.tokens.sales,
    );

    const movement = (await summary()).body.data.recentMovements[0];

    assert.equal(movement.movementType, 'OUT');
    assert.equal(movement.quantity, 4);
    assert.equal(movement.balanceAfter, 96);
    assert.equal(movement.productName, 'Plenty Widget');
  });

  it('gives every role the same figures', async () => {
    const responses = await Promise.all(
      (['admin', 'sales', 'warehouse', 'accounts'] as const).map((role) =>
        get('/api/dashboard/summary', suite.tokens[role]),
      ),
    );

    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.data.customers, responses[0]!.body.data.customers);
      assert.deepEqual(response.body.data.products, responses[0]!.body.data.products);
    }
  });
});
