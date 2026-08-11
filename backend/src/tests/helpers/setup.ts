/**
 * One-line setup for a test file: reset the database, start the server, and log
 * in as every role.
 *
 * Tokens are obtained through the real POST /api/auth/login rather than signed
 * directly with the JWT utility. A token minted by the test would prove the
 * tests can sign JWTs; a token minted by the login endpoint proves the endpoint
 * issues ones the middleware accepts.
 */
import { post, startServer } from './api';
import { resetDatabase, TEST_PASSWORD, type Fixtures } from './db';

export type RoleKey = 'admin' | 'sales' | 'warehouse' | 'accounts';

export interface Suite {
  fixtures: Fixtures;
  tokens: Record<RoleKey, string>;
}

const EMAILS: Record<RoleKey, string> = {
  admin: 'admin@test.local',
  sales: 'sales@test.local',
  warehouse: 'warehouse@test.local',
  accounts: 'accounts@test.local',
};

export async function login(email: string, password = TEST_PASSWORD): Promise<string> {
  const response = await post('/api/auth/login', { email, password });

  if (response.status !== 200) {
    throw new Error(
      `Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }

  return response.body.data.token as string;
}

export async function setupSuite(): Promise<Suite> {
  await startServer();
  const fixtures = await resetDatabase();

  const entries = await Promise.all(
    (Object.keys(EMAILS) as RoleKey[]).map(async (role) => [role, await login(EMAILS[role])] as const),
  );

  return { fixtures, tokens: Object.fromEntries(entries) as Record<RoleKey, string> };
}
