/**
 * The migration runner and the development seed.
 *
 * These two scripts are the first thing a reviewer runs, and they are the one
 * part of the system that is normally only ever exercised by hand. Both are
 * executed here as real subprocesses — the same way `npm run db:setup` does it —
 * because their contract includes their exit code.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { closeDatabase, query, resetDatabase } from './helpers/db';

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Runs a project script exactly as an npm script would.
 *
 * LOG_LEVEL is forced back to 'info': the test runner sets it to 'silent' for
 * readable assertion output, and these tests assert on what the scripts print.
 */
function runScript(script: string, extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', path.join('src', 'db', script)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, LOG_LEVEL: 'info', ...extraEnv },
  });
}

async function countOf(table: string): Promise<number> {
  const result = await query<{ count: string }>(`SELECT count(*) AS count FROM ${table}`);
  return Number(result.rows[0]!.count);
}

before(async () => {
  // Guarantees the schema exists and clears whatever an earlier file left.
  await resetDatabase();
  await query('TRUNCATE TABLE customers, products, stock_movements, users RESTART IDENTITY CASCADE');
});

after(async () => {
  await closeDatabase();
});

describe('migrate', () => {
  it('is idempotent — a second run applies nothing and still exits 0', async () => {
    const first = runScript('migrate.ts');
    assert.equal(first.status, 0, first.stderr);

    const second = runScript('migrate.ts');
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /up to date|no pending/i);
  });

  it('records every applied file in schema_migrations', async () => {
    const result = await query<{ filename: string }>(
      'SELECT filename FROM schema_migrations ORDER BY filename',
    );

    assert.ok(result.rows.length >= 2, 'both migrations should be recorded');
    assert.equal(result.rows[0]!.filename, '001_init.sql');
  });

  it('created every table the application uses', async () => {
    const expected = [
      'customers',
      'customer_follow_ups',
      'products',
      'sales_challan_items',
      'sales_challans',
      'schema_migrations',
      'stock_movements',
      'users',
    ];

    const result = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const actual = result.rows.map((row) => row.table_name);

    for (const table of expected) {
      assert.ok(actual.includes(table), `missing table: ${table}`);
    }
  });
});

describe('seed', () => {
  it('populates users, customers, products and challans', async () => {
    const result = runScript('seed.ts');
    assert.equal(result.status, 0, result.stderr);

    assert.equal(await countOf('users'), 4);
    assert.equal(await countOf('customers'), 7);
    assert.equal(await countOf('products'), 10);
    // One challan per lifecycle state, 3 + 2 + 1 line items between them.
    assert.equal(await countOf('sales_challans'), 3);
    assert.equal(await countOf('sales_challan_items'), 6);
  });

  it('creates opening stock through the ledger, so the two reconcile', async () => {
    const mismatched = await query<{ id: string }>(
      `SELECT p.id
         FROM products p
         LEFT JOIN (
           SELECT product_id,
                  sum(CASE WHEN movement_type = 'IN' THEN quantity ELSE -quantity END) AS total
             FROM stock_movements GROUP BY product_id
         ) m ON m.product_id = p.id
        WHERE p.current_stock <> COALESCE(m.total, 0)`,
    );

    assert.equal(mismatched.rowCount, 0, 'every product must equal the sum of its movements');
  });

  it('is idempotent — running it twice duplicates nothing', async () => {
    const result = runScript('seed.ts');
    assert.equal(result.status, 0, result.stderr);

    assert.equal(await countOf('users'), 4);
    assert.equal(await countOf('customers'), 7);
    assert.equal(await countOf('products'), 10);
    assert.equal(await countOf('sales_challans'), 3);
    assert.equal(await countOf('sales_challan_items'), 6);
    // The critical one: 9 opening-stock entries plus the 3 OUT rows written by
    // the seeded confirmation, and not one more. A second run that re-confirmed
    // that challan would deduct its stock twice and leave current_stock
    // permanently below the ledger — the one thing this project must not do.
    assert.equal(await countOf('stock_movements'), 12);
  });

  it('leaves stock and the ledger reconciled after a second run', async () => {
    const mismatched = await query<{ id: string }>(
      `SELECT p.id
         FROM products p
         LEFT JOIN (
           SELECT product_id,
                  sum(CASE WHEN movement_type = 'IN' THEN quantity ELSE -quantity END) AS total
             FROM stock_movements GROUP BY product_id
         ) m ON m.product_id = p.id
        WHERE p.current_stock <> COALESCE(m.total, 0)`,
    );

    assert.equal(mismatched.rowCount, 0, 'a re-run must not have deducted stock again');
  });

  it('stores only bcrypt hashes, never a plaintext password', async () => {
    const result = await query<{ password_hash: string }>('SELECT password_hash FROM users');

    assert.equal(result.rows.length, 4);
    for (const row of result.rows) {
      assert.match(row.password_hash, /^\$2[aby]\$\d{2}\$/, 'not a bcrypt hash');
      assert.ok(!row.password_hash.includes('@1234'), 'a plaintext password reached the database');
    }
  });

  it('refuses to run against NODE_ENV=production without an explicit opt-in', async () => {
    const result = runScript('seed.ts', { NODE_ENV: 'production', ALLOW_PRODUCTION_SEED: 'false' });

    assert.equal(result.status, 1, 'it must exit non-zero');
    assert.match(`${result.stdout}${result.stderr}`, /refusing to seed/i);
  });
});
