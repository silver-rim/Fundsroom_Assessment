/**
 * Migration runner.
 *
 * Reads every .sql file in ./migrations in filename order, skips the ones
 * already recorded in schema_migrations, and applies the rest — each inside its
 * own transaction, together with its bookkeeping row. A migration therefore
 * either lands completely and is recorded, or lands not at all.
 *
 * Forward-only by design: there are no down-migrations. Undoing something means
 * writing a new numbered file, which is what actually happens in production.
 *
 *   npm run migrate        (development, via tsx)
 *   npm run migrate:prod   (after `npm run build`)
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pool, withTransaction } from '../config/db';
import { logger } from '../utils/logger';

// Resolved relative to this file, so it works both from src/ under tsx and from
// dist/ after the build (scripts/copy-assets.mjs copies the .sql files across).
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

async function ensureBookkeepingTable(): Promise<void> {
  // Created here rather than in 001_init.sql: the applied-migrations list has to
  // be readable on a completely empty database, before any migration has run.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         SERIAL PRIMARY KEY,
      filename   TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations',
  );
  return new Set(result.rows.map((row) => row.filename));
}

async function applyMigration(filename: string): Promise<void> {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');

  await withTransaction(async (client) => {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
  });
}

export async function runMigrations(): Promise<void> {
  await ensureBookkeepingTable();

  const applied = await getAppliedMigrations();
  const pending = listMigrationFiles().filter((file) => !applied.has(file));

  if (pending.length === 0) {
    logger.info('Database is up to date - no pending migrations', {
      applied: applied.size,
    });
    return;
  }

  logger.info(`Applying ${pending.length} migration(s)`, { pending });

  for (const filename of pending) {
    const startedAt = Date.now();
    await applyMigration(filename);
    logger.info(`Applied ${filename}`, { durationMs: Date.now() - startedAt });
  }

  logger.info('Migrations complete', { applied: applied.size + pending.length });
}

async function main(): Promise<void> {
  try {
    await runMigrations();
    await pool.end();
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed - the database was left unchanged by the failing file', {
      error: error instanceof Error ? error.message : String(error),
    });
    await pool.end().catch(() => undefined);
    process.exit(1);
  }
}

void main();
