/**
 * Test runner.
 *
 * Integration tests need a real PostgreSQL database — the guarantees being
 * tested (row locks, CHECK constraints, transactional rollback) do not exist in
 * a mock. So this script provisions a SEPARATE database beside the development
 * one and points the suite at it:
 *
 *   1. read backend/.env for the developer's connection string
 *   2. derive `<database>_test` from it
 *   3. refuse to continue if that name is not distinct from the real database
 *   4. CREATE DATABASE if it does not exist yet
 *   5. run `node --test` with DATABASE_URL overridden for the child process
 *
 * Step 3 is the important one. The suite truncates every table between files;
 * pointed at the development database that would delete the developer's data.
 * dotenv does not overwrite variables that are already set, so the override in
 * step 5 survives `dotenv.config()` inside src/config/env.ts.
 *
 *   npm test
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const testsDir = path.join(rootDir, 'src', 'tests');

dotenv.config({ path: path.join(rootDir, '.env') });

function fail(message) {
  process.stderr.write(`\n[test] ${message}\n\n`);
  process.exit(1);
}

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  fail('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
}

let parsed;
try {
  parsed = new URL(baseUrl);
} catch {
  fail('DATABASE_URL is not a valid connection string.');
}

const sourceName = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'postgres';
const testName = process.env.TEST_DATABASE_NAME ?? `${sourceName}_test`;

// A database name is an SQL identifier and cannot be a bound parameter, so it is
// whitelisted rather than escaped.
if (!/^[A-Za-z0-9_]+$/.test(testName)) {
  fail(`Refusing to use "${testName}" as a database name: letters, digits and _ only.`);
}

if (testName === sourceName) {
  fail(
    `The test database resolves to the same name as the development one ("${sourceName}").\n` +
      `        The suite truncates every table, so this is refused. Set TEST_DATABASE_NAME.`,
  );
}

const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false;

// `postgres` is the maintenance database every server has; CREATE DATABASE
// cannot be issued from inside the database being created.
const adminUrl = new URL(baseUrl);
adminUrl.pathname = '/postgres';

const admin = new pg.Client({ connectionString: adminUrl.toString(), ssl });

try {
  await admin.connect();
} catch (error) {
  fail(
    `Cannot connect to PostgreSQL: ${error.message}\n` +
      `        Is the server running, and is DATABASE_URL correct?`,
  );
}

const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [testName]);

if (existing.rowCount === 0) {
  process.stdout.write(`[test] creating database "${testName}"\n`);
  await admin.query(`CREATE DATABASE "${testName}"`);
} else {
  process.stdout.write(`[test] reusing database "${testName}"\n`);
}

await admin.end();

const testUrl = new URL(baseUrl);
testUrl.pathname = `/${testName}`;

const files = readdirSync(testsDir)
  .filter((file) => file.endsWith('.test.ts'))
  .sort()
  .map((file) => path.join(testsDir, file));

if (files.length === 0) fail(`No *.test.ts files found in ${testsDir}`);

const result = spawnSync(
  process.execPath,
  [
    '--import',
    'tsx',
    '--test',
    // Every file talks to the same database, so they must not run at the same
    // time. Files still get their own process; they just take turns.
    '--test-concurrency=1',
    ...files,
  ],
  {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: testUrl.toString(),
      // Hashing is the slowest thing the suite does and its cost is the point
      // of bcrypt, not of these tests. The application default stays at 10.
      BCRYPT_SALT_ROUNDS: '4',
      // Keeps the request log out of the assertion output.
      LOG_LEVEL: 'silent',
    },
  },
);

process.exit(result.status ?? 1);
