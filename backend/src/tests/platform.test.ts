/**
 * Cross-cutting behaviour: the response envelope, error handling, health,
 * security headers, CORS and body limits.
 *
 * These are the promises docs/API_PLAN.md §1 makes about EVERY endpoint, so
 * they are tested once here rather than repeated in each module's file.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, request, stopServer } from './helpers/api';
import { closeDatabase } from './helpers/db';
import { setupSuite, type Suite } from './helpers/setup';

let suite: Suite;

before(async () => {
  suite = await setupSuite();
});

after(async () => {
  await stopServer();
  await closeDatabase();
});

describe('service endpoints', () => {
  it('answers a bare GET / so a deploy can be confirmed live', async () => {
    const response = await get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.ok(response.body.data.name.includes('Mini ERP'));
  });

  it('reports health and database connectivity without a token', async () => {
    const response = await get('/api/health');

    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'ok');
    assert.equal(response.body.data.database.status, 'up');
    assert.equal(typeof response.body.data.database.latencyMs, 'number');
    assert.equal(typeof response.body.data.uptimeSeconds, 'number');
  });
});

describe('response envelope', () => {
  it('wraps a single resource as { success: true, data }', async () => {
    const response = await get('/api/auth/me', suite.tokens.admin);

    assert.deepEqual(Object.keys(response.body).sort(), ['data', 'success']);
    assert.equal(response.body.success, true);
  });

  it('adds pagination to every list response', async () => {
    for (const path of ['/api/customers', '/api/products', '/api/challans', '/api/stock-movements']) {
      const response = await get(path, suite.tokens.admin);

      assert.equal(response.status, 200, path);
      assert.ok(Array.isArray(response.body.data), `${path} data should be an array`);
      assert.deepEqual(
        Object.keys(response.body.pagination).sort(),
        ['limit', 'page', 'total', 'totalPages'],
        `${path} pagination shape`,
      );
    }
  });

  it('computes totalPages consistently with total and limit', async () => {
    const response = await get('/api/customers?limit=2', suite.tokens.admin);
    const { total, limit, totalPages } = response.body.pagination;

    assert.equal(totalPages, Math.ceil(total / limit));
  });

  it('returns an empty page rather than an error past the last page', async () => {
    const response = await get('/api/customers?page=99', suite.tokens.admin);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, []);
    assert.equal(response.body.pagination.page, 99);
  });

  it('wraps every failure as { success: false, error: { code, message } }', async () => {
    const cases = [
      { path: '/api/auth/me', token: undefined, status: 401 },
      { path: '/api/users', token: suite.tokens.sales, status: 403 },
      { path: '/api/customers/999999', token: suite.tokens.admin, status: 404 },
      { path: '/api/customers?limit=999', token: suite.tokens.admin, status: 422 },
      { path: '/api/customers/abc', token: suite.tokens.admin, status: 400 },
    ];

    for (const testCase of cases) {
      const response = await get(testCase.path, testCase.token);

      assert.equal(response.status, testCase.status, testCase.path);
      assert.equal(response.body.success, false);
      assert.equal(typeof response.body.error.code, 'string');
      assert.equal(typeof response.body.error.message, 'string');
      assert.ok(response.body.error.message.length > 0);
    }
  });

  it('404s an unknown route with the same envelope', async () => {
    const response = await get('/api/does-not-exist', suite.tokens.admin);

    assert.equal(response.status, 404);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.code, 'NOT_FOUND');
  });

  it('never leaks a password hash or a connection string in an error', async () => {
    const responses = await Promise.all([
      get('/api/customers/999999', suite.tokens.admin),
      post('/api/auth/login', { email: 'admin@test.local', password: 'wrong' }),
      get('/api/users', suite.tokens.accounts),
    ]);

    for (const response of responses) {
      const serialised = JSON.stringify(response.body);
      assert.ok(!serialised.includes('password_hash'), 'leaked a column name');
      assert.ok(!/\$2[aby]\$/.test(serialised), 'leaked a bcrypt hash');
      assert.ok(!serialised.includes('postgres://'), 'leaked a connection string');
      assert.ok(!serialised.includes('postgresql://'), 'leaked a connection string');
    }
  });
});

describe('security', () => {
  it('does not advertise Express', async () => {
    const response = await get('/api/health');

    assert.equal(response.headers.get('x-powered-by'), null);
  });

  it('sends the helmet security headers', async () => {
    const response = await get('/api/health');

    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(response.headers.get('x-frame-options') ?? response.headers.get('content-security-policy'));
  });

  it('rejects a request from an origin that is not allowed', async () => {
    const response = await request('GET', '/api/health', {
      headers: { Origin: 'https://evil.example.com' },
    });

    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'FORBIDDEN');
  });

  it('allows a configured origin', async () => {
    const response = await request('GET', '/api/health', {
      headers: { Origin: 'http://localhost:5173' },
    });

    assert.equal(response.status, 200);
  });

  it('rejects a body over the 100 kB limit', async () => {
    const response = await request('POST', '/api/customers', {
      token: suite.tokens.admin,
      rawBody: JSON.stringify({ name: 'x'.repeat(200_000) }),
    });

    assert.equal(response.status, 413);
  });

  it('does not accept a token in a query parameter', async () => {
    const response = await get(`/api/auth/me?token=${suite.tokens.admin}`);

    assert.equal(response.status, 401);
  });
});

describe('input handling', () => {
  it('coerces numeric query parameters and applies defaults', async () => {
    const response = await get('/api/customers', suite.tokens.admin);

    assert.equal(response.body.pagination.page, 1);
    assert.equal(response.body.pagination.limit, 20);
  });

  it('rejects page 0 and negative pages', async () => {
    for (const page of ['0', '-1']) {
      const response = await get(`/api/customers?page=${page}`, suite.tokens.admin);
      assert.equal(response.status, 422, `page=${page} should be rejected`);
    }
  });

  it('ignores an unknown query parameter rather than failing', async () => {
    const response = await get('/api/customers?unexpected=value', suite.tokens.admin);

    assert.equal(response.status, 200);
  });

  it('accepts a body-less POST where every field is optional', async () => {
    // Regression: Express 5 leaves req.body undefined when no body is sent, and
    // a Zod object schema rejects undefined even when all its fields are
    // optional. Cancelling without a reason is legal per API_PLAN.md.
    const created = await post(
      '/api/challans',
      {
        customerId: suite.fixtures.customers.active,
        items: [{ productId: suite.fixtures.products.plenty, quantity: 1 }],
      },
      suite.tokens.sales,
    );

    const response = await request('POST', `/api/challans/${created.body.data.id}/cancel`, {
      token: suite.tokens.sales,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'CANCELLED');
  });
});
