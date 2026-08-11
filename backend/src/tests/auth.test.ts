/**
 * Authentication and the role permission matrix.
 *
 * The matrix test at the bottom is the important one: it walks every protected
 * route with every role and asserts the outcome, so docs/AUTHENTICATION.md is
 * checked against running code rather than taken on trust.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, request, stopServer } from './helpers/api';
import { closeDatabase, query, TEST_PASSWORD } from './helpers/db';
import { login, setupSuite, type RoleKey, type Suite } from './helpers/setup';

let suite: Suite;

before(async () => {
  suite = await setupSuite();
});

after(async () => {
  await stopServer();
  await closeDatabase();
});

describe('POST /api/auth/login', () => {
  it('issues a token for valid credentials', async () => {
    const response = await post('/api/auth/login', {
      email: 'admin@test.local',
      password: TEST_PASSWORD,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(typeof response.body.data.token, 'string');
    assert.equal(response.body.data.user.role, 'ADMIN');
    assert.equal(response.body.data.user.email, 'admin@test.local');
  });

  it('never returns the password hash', async () => {
    const response = await post('/api/auth/login', {
      email: 'admin@test.local',
      password: TEST_PASSWORD,
    });

    const serialised = JSON.stringify(response.body);
    assert.ok(!serialised.includes('passwordHash'), 'response contained passwordHash');
    assert.ok(!serialised.includes('password_hash'), 'response contained password_hash');
    assert.ok(!serialised.includes('$2'), 'response contained a bcrypt hash');
  });

  it('accepts the email case-insensitively', async () => {
    const response = await post('/api/auth/login', {
      email: 'ADMIN@TEST.LOCAL',
      password: TEST_PASSWORD,
    });

    assert.equal(response.status, 200);
  });

  it('rejects a wrong password with 401 INVALID_CREDENTIALS', async () => {
    const response = await post('/api/auth/login', {
      email: 'admin@test.local',
      password: 'WrongPassword@1',
    });

    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'INVALID_CREDENTIALS');
  });

  it('gives an unknown email the identical response to a wrong password', async () => {
    // Deliberately indistinguishable: otherwise the endpoint becomes a way to
    // discover which email addresses have accounts.
    const unknown = await post('/api/auth/login', {
      email: 'nobody@test.local',
      password: TEST_PASSWORD,
    });
    const wrongPassword = await post('/api/auth/login', {
      email: 'admin@test.local',
      password: 'WrongPassword@1',
    });

    assert.equal(unknown.status, wrongPassword.status);
    assert.equal(unknown.body.error.code, wrongPassword.body.error.code);
    assert.equal(unknown.body.error.message, wrongPassword.body.error.message);
  });

  it('refuses an inactive account, with that same response', async () => {
    const response = await post('/api/auth/login', {
      email: 'inactive@test.local',
      password: TEST_PASSWORD,
    });

    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'INVALID_CREDENTIALS');
  });

  it('rejects a malformed body with 422 and field details', async () => {
    const response = await post('/api/auth/login', { email: 'not-an-email' });

    assert.equal(response.status, 422);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(response.body.error.details));
    assert.ok(response.body.error.details.length > 0);
  });

  it('rejects malformed JSON with 400, not 500', async () => {
    const response = await request('POST', '/api/auth/login', { rawBody: '{"email":' });

    assert.equal(response.status, 400);
    assert.equal(response.body.success, false);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the signed-in profile', async () => {
    const response = await get('/api/auth/me', suite.tokens.sales);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.email, 'sales@test.local');
    assert.equal(response.body.data.role, 'SALES');
  });

  it('requires a token', async () => {
    const response = await get('/api/auth/me');

    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'UNAUTHENTICATED');
  });

  it('rejects a malformed token', async () => {
    const response = await get('/api/auth/me', 'not-a-jwt');

    assert.equal(response.status, 401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    // Header and payload are plausible; only the signature is wrong.
    const forged = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: 1, role: 'ADMIN' })).toString('base64url'),
      'this-signature-is-not-valid',
    ].join('.');

    const response = await get('/api/auth/me', forged);

    assert.equal(response.status, 401);
  });

  /**
   * Pins a DOCUMENTED trade-off rather than a desired behaviour.
   *
   * `authenticate` trusts the signed token and does not re-read the user on
   * every request, which keeps the API stateless. The consequence is that
   * deactivating someone does not invalidate the token they already hold — it
   * takes effect at their next login. GET /auth/me does re-read the row, so the
   * frontend drops the session on its next rehydrate.
   *
   * If this test ever fails, the trade-off has been changed on purpose and
   * docs/AUTHENTICATION.md needs updating with it.
   */
  it('keeps an already-issued token working after the account is deactivated', async () => {
    const token = await login('sales@test.local');

    await query('UPDATE users SET is_active = false WHERE email = $1', ['sales@test.local']);

    const dataRoute = await get('/api/customers', token);
    assert.equal(dataRoute.status, 200, 'the existing token still works — this is the trade-off');

    const profile = await get('/api/auth/me', token);
    assert.equal(profile.status, 401, 'but /auth/me re-reads the user and refuses');

    await query('UPDATE users SET is_active = true WHERE email = $1', ['sales@test.local']);
  });

  it('rejects an Authorization header without the Bearer scheme', async () => {
    const response = await request('GET', '/api/auth/me', {
      headers: { Authorization: suite.tokens.admin },
    });

    assert.equal(response.status, 401);
  });
});

describe('permission matrix', () => {
  /**
   * Every protected route, and which roles may reach it.
   *
   * `allowed` lists the roles that must NOT get a 403. Any role missing from
   * the list must get exactly 403 — not 404, not 422, not 500. The request
   * bodies are intentionally minimal: authorize() runs before validate(), so an
   * allowed role may answer 422 here and that still proves it got past the gate.
   */
  const ROUTES: Array<{
    method: string;
    path: string;
    body?: unknown;
    allowed: RoleKey[];
  }> = [
    // Customers — everyone reads, Admin/Sales write, Admin alone deletes.
    { method: 'GET', path: '/api/customers', allowed: ['admin', 'sales', 'warehouse', 'accounts'] },
    { method: 'POST', path: '/api/customers', body: {}, allowed: ['admin', 'sales'] },
    { method: 'PUT', path: '/api/customers/1', body: {}, allowed: ['admin', 'sales'] },
    { method: 'DELETE', path: '/api/customers/1', allowed: ['admin'] },

    // Follow-ups — the warehouse has no reason to work the sales pipeline.
    { method: 'GET', path: '/api/customers/1/follow-ups', allowed: ['admin', 'sales', 'accounts'] },
    { method: 'POST', path: '/api/customers/1/follow-ups', body: {}, allowed: ['admin', 'sales'] },

    // Products — everyone reads, Admin/Warehouse write.
    { method: 'GET', path: '/api/products', allowed: ['admin', 'sales', 'warehouse', 'accounts'] },
    { method: 'POST', path: '/api/products', body: {}, allowed: ['admin', 'warehouse'] },
    { method: 'PUT', path: '/api/products/1', body: {}, allowed: ['admin', 'warehouse'] },

    // Stock — everyone reads the ledger, only the warehouse adjusts by hand.
    {
      method: 'GET',
      path: '/api/stock-movements',
      allowed: ['admin', 'sales', 'warehouse', 'accounts'],
    },
    { method: 'POST', path: '/api/stock-movements', body: {}, allowed: ['admin', 'warehouse'] },

    // Challans — everyone reads; Admin/Sales write and cancel; confirming is
    // additionally open to the warehouse, because that is when goods move.
    { method: 'GET', path: '/api/challans', allowed: ['admin', 'sales', 'warehouse', 'accounts'] },
    { method: 'POST', path: '/api/challans', body: {}, allowed: ['admin', 'sales'] },
    { method: 'PUT', path: '/api/challans/1', body: {}, allowed: ['admin', 'sales'] },
    {
      method: 'POST',
      path: '/api/challans/1/confirm',
      allowed: ['admin', 'sales', 'warehouse'],
    },
    { method: 'POST', path: '/api/challans/1/cancel', allowed: ['admin', 'sales'] },

    // Admin-only.
    { method: 'GET', path: '/api/users', allowed: ['admin'] },

    // Open to every authenticated role.
    {
      method: 'GET',
      path: '/api/dashboard/summary',
      allowed: ['admin', 'sales', 'warehouse', 'accounts'],
    },
  ];

  const ALL_ROLES: RoleKey[] = ['admin', 'sales', 'warehouse', 'accounts'];

  for (const route of ROUTES) {
    for (const role of ALL_ROLES) {
      const shouldAllow = route.allowed.includes(role);
      const label = `${route.method} ${route.path} — ${role} ${shouldAllow ? 'allowed' : 'forbidden'}`;

      it(label, async () => {
        const response = await request(route.method, route.path, {
          token: suite.tokens[role],
          body: route.body,
        });

        if (shouldAllow) {
          assert.notEqual(
            response.status,
            403,
            `${role} should not be blocked from ${route.method} ${route.path}`,
          );
        } else {
          assert.equal(
            response.status,
            403,
            `${role} should be blocked from ${route.method} ${route.path}, got ${response.status}`,
          );
          assert.equal(response.body.error.code, 'FORBIDDEN');
        }
      });
    }
  }

  it('rejects every protected route without a token', async () => {
    for (const route of ROUTES) {
      const response = await request(route.method, route.path, { body: route.body });
      assert.equal(
        response.status,
        401,
        `${route.method} ${route.path} should be 401 without a token, got ${response.status}`,
      );
    }
  });
});
