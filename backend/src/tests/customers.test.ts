/**
 * Customer CRM: CRUD, validation, search, filters, pagination, soft delete and
 * the follow-up log.
 */
import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { del, get, post, put, stopServer } from './helpers/api';
import { closeDatabase, dateFromToday, query } from './helpers/db';
import { setupSuite, type Suite } from './helpers/setup';

let suite: Suite;

beforeEach(async () => {
  // Every test starts from the same fixture set, so one test's writes can never
  // change another's expected counts.
  suite = await setupSuite();
});

after(async () => {
  await stopServer();
  await closeDatabase();
});

function validCustomer(overrides: Record<string, unknown> = {}) {
  return {
    name: 'New Customer',
    mobile: '9111111111',
    email: 'new@example.com',
    businessName: 'New Business',
    customerType: 'RETAIL',
    address: '99 New Road, New City 400002',
    status: 'LEAD',
    ...overrides,
  };
}

describe('POST /api/customers', () => {
  it('creates a customer and returns 201', async () => {
    const response = await post('/api/customers', validCustomer(), suite.tokens.sales);

    assert.equal(response.status, 201);
    assert.equal(response.body.data.name, 'New Customer');
    assert.equal(response.body.data.status, 'LEAD');
    assert.equal(response.body.data.createdBy.name, 'Test Sales');
  });

  it('defaults status to LEAD when omitted', async () => {
    const payload = validCustomer();
    delete (payload as Record<string, unknown>).status;

    const response = await post('/api/customers', payload, suite.tokens.admin);

    assert.equal(response.status, 201);
    assert.equal(response.body.data.status, 'LEAD');
  });

  it('normalises mobile punctuation and lower-cases the email', async () => {
    const response = await post(
      '/api/customers',
      validCustomer({ mobile: '+91 91234 56789', email: 'MiXeD@Example.COM' }),
      suite.tokens.admin,
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.data.mobile, '919123456789');
    assert.equal(response.body.data.email, 'mixed@example.com');
  });

  it('upper-cases a GST number and rejects a malformed one', async () => {
    const ok = await post(
      '/api/customers',
      validCustomer({ gstNumber: '24aaacs1234f1z5' }),
      suite.tokens.admin,
    );
    assert.equal(ok.status, 201);
    assert.equal(ok.body.data.gstNumber, '24AAACS1234F1Z5');

    const bad = await post(
      '/api/customers',
      validCustomer({ mobile: '9111111112', gstNumber: 'NOT-A-GSTIN' }),
      suite.tokens.admin,
    );
    assert.equal(bad.status, 422);
  });

  it('treats an empty optional string as absent, not invalid', async () => {
    const response = await post(
      '/api/customers',
      validCustomer({ gstNumber: '', followUpDate: '', notes: '' }),
      suite.tokens.admin,
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.data.gstNumber, null);
    assert.equal(response.body.data.followUpDate, null);
  });

  it('rejects a duplicate mobile with 409 DUPLICATE_MOBILE', async () => {
    const response = await post(
      '/api/customers',
      validCustomer({ mobile: '9000000001' }), // fixture "Alpha Trading"
      suite.tokens.admin,
    );

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'DUPLICATE_MOBILE');
    assert.equal(response.body.error.details[0].field, 'body.mobile');
  });

  it('rejects an impossible calendar date', async () => {
    const response = await post(
      '/api/customers',
      validCustomer({ followUpDate: '2026-02-31' }),
      suite.tokens.admin,
    );

    assert.equal(response.status, 422);
  });

  it('reports every invalid field at once, not just the first', async () => {
    const response = await post(
      '/api/customers',
      { name: 'X', mobile: '123', email: 'nope', businessName: '', customerType: 'ALIEN', address: 'x' },
      suite.tokens.admin,
    );

    assert.equal(response.status, 422);
    assert.ok(
      response.body.error.details.length >= 5,
      `expected several field errors, got ${response.body.error.details.length}`,
    );
  });

  it('strips unknown fields rather than rejecting them', async () => {
    const response = await post(
      '/api/customers',
      validCustomer({ somethingNew: 'ignore me', id: 999, currentStock: 5 }),
      suite.tokens.admin,
    );

    assert.equal(response.status, 201);
    assert.notEqual(response.body.data.id, 999);
    assert.equal(response.body.data.somethingNew, undefined);
  });

  it('trims surrounding whitespace', async () => {
    const response = await post(
      '/api/customers',
      validCustomer({ name: '   Spaced Name   ' }),
      suite.tokens.admin,
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.data.name, 'Spaced Name');
  });
});

describe('GET /api/customers', () => {
  it('lists the fixture customers with pagination metadata', async () => {
    const response = await get('/api/customers', suite.tokens.accounts);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 5);
    assert.deepEqual(response.body.pagination, {
      page: 1,
      limit: 20,
      total: 5,
      totalPages: 1,
    });
  });

  it('filters by status', async () => {
    const response = await get('/api/customers?status=ACTIVE', suite.tokens.admin);

    assert.equal(response.status, 200);
    assert.equal(response.body.pagination.total, 2);
    assert.ok(response.body.data.every((c: any) => c.status === 'ACTIVE'));
  });

  it('finds customers by name, business name, mobile and email', async () => {
    for (const term of ['Alpha', 'alpha trading', '9000000001', '9000000001@test.local']) {
      const response = await get(`/api/customers?search=${encodeURIComponent(term)}`, suite.tokens.admin);
      assert.equal(response.status, 200);
      assert.equal(response.body.pagination.total, 1, `search "${term}" should match one customer`);
      assert.equal(response.body.data[0].businessName, 'Alpha Trading');
    }
  });

  it('searches case-insensitively', async () => {
    const response = await get('/api/customers?search=ALPHA', suite.tokens.admin);

    assert.equal(response.status, 200);
    assert.equal(response.body.pagination.total, 1);
  });

  it('returns an empty list, not a 404, when nothing matches', async () => {
    const response = await get('/api/customers?search=nothingmatchesthis', suite.tokens.admin);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, []);
    assert.equal(response.body.pagination.total, 0);
  });

  it('filters follow-ups due on or before today — today counts as due', async () => {
    const response = await get(
      `/api/customers?followUpBefore=${dateFromToday(0)}`,
      suite.tokens.sales,
    );

    assert.equal(response.status, 200);
    // dueYesterday and dueToday; the future one and the two with no date are out.
    assert.equal(response.body.pagination.total, 2);
  });

  it('paginates', async () => {
    const first = await get('/api/customers?page=1&limit=2', suite.tokens.admin);
    const second = await get('/api/customers?page=2&limit=2', suite.tokens.admin);

    assert.equal(first.body.data.length, 2);
    assert.equal(second.body.data.length, 2);
    assert.equal(first.body.pagination.totalPages, 3);
    assert.notEqual(first.body.data[0].id, second.body.data[0].id);
  });

  it('rejects an out-of-range limit', async () => {
    const response = await get('/api/customers?limit=500', suite.tokens.admin);

    assert.equal(response.status, 422);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  });

  it('rejects an unknown sort column instead of interpolating it', async () => {
    const response = await get('/api/customers?sortBy=password_hash', suite.tokens.admin);

    assert.equal(response.status, 422);
  });

  it('is not vulnerable to SQL injection through the search term', async () => {
    const response = await get(
      `/api/customers?search=${encodeURIComponent("'; DROP TABLE customers; --")}`,
      suite.tokens.admin,
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.pagination.total, 0);

    // The table must still be there with every row intact.
    const stillThere = await get('/api/customers', suite.tokens.admin);
    assert.equal(stillThere.body.pagination.total, 5);
  });
});

describe('GET /api/customers/:id', () => {
  it('returns one customer', async () => {
    const response = await get(`/api/customers/${suite.fixtures.customers.active}`, suite.tokens.admin);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.businessName, 'Alpha Trading');
  });

  it('404s for an id that does not exist', async () => {
    const response = await get('/api/customers/999999', suite.tokens.admin);

    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'NOT_FOUND');
  });

  // A bad path parameter is a malformed URL, not a failed field validation, so
  // it is 400 rather than 422 — API_PLAN.md §4 specifies exactly this split.
  it('rejects a non-numeric id with 400', async () => {
    const response = await get('/api/customers/abc', suite.tokens.admin);

    assert.equal(response.status, 400);
  });

  it('rejects a negative id with 400', async () => {
    const response = await get('/api/customers/-5', suite.tokens.admin);

    assert.equal(response.status, 400);
  });
});

describe('PUT /api/customers/:id', () => {
  it('replaces the record', async () => {
    const id = suite.fixtures.customers.active;
    const response = await put(
      `/api/customers/${id}`,
      validCustomer({ name: 'Renamed', mobile: '9000000001', status: 'INACTIVE' }),
      suite.tokens.sales,
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.data.name, 'Renamed');
    assert.equal(response.body.data.status, 'INACTIVE');
  });

  it('allows saving without changing the mobile number', async () => {
    const id = suite.fixtures.customers.active;
    const response = await put(
      `/api/customers/${id}`,
      validCustomer({ mobile: '9000000001' }),
      suite.tokens.admin,
    );

    assert.equal(response.status, 200);
  });

  it("rejects taking another customer's mobile number", async () => {
    const id = suite.fixtures.customers.active;
    const response = await put(
      `/api/customers/${id}`,
      validCustomer({ mobile: '9000000002' }), // belongs to Beta
      suite.tokens.admin,
    );

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'DUPLICATE_MOBILE');
  });

  it('404s for an unknown id', async () => {
    const response = await put('/api/customers/999999', validCustomer(), suite.tokens.admin);

    assert.equal(response.status, 404);
  });
});

describe('DELETE /api/customers/:id', () => {
  it('soft-deletes: the row survives, the API stops returning it', async () => {
    const id = suite.fixtures.customers.noFollowUp;

    // 204: the resource is gone, so there is nothing meaningful to return.
    const deleted = await del(`/api/customers/${id}`, suite.tokens.admin);
    assert.equal(deleted.status, 204);

    const fetched = await get(`/api/customers/${id}`, suite.tokens.admin);
    assert.equal(fetched.status, 404);

    const list = await get('/api/customers', suite.tokens.admin);
    assert.equal(list.body.pagination.total, 4);

    // Still physically present — challan history must keep resolving.
    const rows = await query<{ count: string }>(
      'SELECT count(*) AS count FROM customers WHERE id = $1 AND deleted_at IS NOT NULL',
      [id],
    );
    assert.equal(Number(rows.rows[0]!.count), 1);
  });

  it('frees the mobile number for reuse after deletion', async () => {
    const id = suite.fixtures.customers.noFollowUp;
    await del(`/api/customers/${id}`, suite.tokens.admin);

    const response = await post(
      '/api/customers',
      validCustomer({ mobile: '9000000005' }),
      suite.tokens.admin,
    );

    assert.equal(response.status, 201);
  });

  it('404s when deleting twice', async () => {
    const id = suite.fixtures.customers.noFollowUp;

    assert.equal((await del(`/api/customers/${id}`, suite.tokens.admin)).status, 204);
    assert.equal((await del(`/api/customers/${id}`, suite.tokens.admin)).status, 404);
  });
});

describe('follow-ups', () => {
  it('records a note and moves the customer follow-up date in one step', async () => {
    const id = suite.fixtures.customers.active;
    const nextDate = dateFromToday(5);

    const created = await post(
      `/api/customers/${id}/follow-ups`,
      { note: 'Called about the switchgear quote.', nextFollowUpDate: nextDate },
      suite.tokens.sales,
    );

    assert.equal(created.status, 201);
    assert.equal(created.body.data.note, 'Called about the switchgear quote.');
    assert.equal(created.body.data.nextFollowUpDate, nextDate);

    const customer = await get(`/api/customers/${id}`, suite.tokens.sales);
    assert.equal(
      customer.body.data.followUpDate,
      nextDate,
      'the customer record must move with the note',
    );
  });

  it('leaves the follow-up date alone when the note carries no date', async () => {
    const id = suite.fixtures.customers.dueToday;
    const before = (await get(`/api/customers/${id}`, suite.tokens.admin)).body.data.followUpDate;

    await post(`/api/customers/${id}/follow-ups`, { note: 'Left a voicemail.' }, suite.tokens.admin);

    const after = (await get(`/api/customers/${id}`, suite.tokens.admin)).body.data.followUpDate;
    assert.equal(after, before);
  });

  it('lists notes newest first', async () => {
    const id = suite.fixtures.customers.active;

    await post(`/api/customers/${id}/follow-ups`, { note: 'First note' }, suite.tokens.admin);
    await post(`/api/customers/${id}/follow-ups`, { note: 'Second note' }, suite.tokens.admin);

    const response = await get(`/api/customers/${id}/follow-ups`, suite.tokens.admin);

    assert.equal(response.status, 200);
    assert.equal(response.body.pagination.total, 2);
    assert.equal(response.body.data[0].note, 'Second note');
  });

  it('rejects an empty note', async () => {
    const id = suite.fixtures.customers.active;
    const response = await post(`/api/customers/${id}/follow-ups`, { note: '   ' }, suite.tokens.admin);

    assert.equal(response.status, 422);
  });

  it('404s on a customer that does not exist', async () => {
    const response = await post('/api/customers/999999/follow-ups', { note: 'x' }, suite.tokens.admin);

    assert.equal(response.status, 404);
  });
});
