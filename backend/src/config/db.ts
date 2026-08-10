/**
 * PostgreSQL connection pool and transaction helper.
 *
 * Every SQL statement in the application goes through `query` or through a
 * `PoolClient` handed out by `withTransaction`. Repositories accept an optional
 * client so a service can run several repository calls inside one transaction —
 * which is exactly what the sales-challan confirmation flow needs.
 */
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { env } from './env';
import { logger } from '../utils/logger';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // Managed Postgres providers (Neon, Render, Supabase) terminate TLS with a
  // certificate chain Node does not ship a root for. Verification is therefore
  // relaxed for those hosts; the connection is still encrypted. A local
  // instance runs without TLS entirely.
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// A pooled connection can die between checkouts (idle timeout on the provider's
// side, for instance). Without this listener that surfaces as an unhandled
// 'error' event and takes the process down.
pool.on('error', (error: Error) => {
  logger.error('Unexpected error on an idle database client', { error: error.message });
});

/** Runs a parameterised query on a pooled connection. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as unknown[]);
}

/**
 * Runs `fn` inside a single database transaction.
 *
 * BEGIN -> fn -> COMMIT, or ROLLBACK if `fn` throws anything at all. The client
 * is always released back to the pool, including on failure.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // The original error is the useful one; a failed rollback usually means
      // the connection itself is gone. Record it and rethrow the original.
      logger.error('Transaction rollback failed', {
        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      });
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Verifies the database is reachable. Used at boot and by GET /api/health. */
export async function checkDatabaseConnection(): Promise<{ ok: boolean; latencyMs: number }> {
  const startedAt = Date.now();
  await query('SELECT 1');
  return { ok: true, latencyMs: Date.now() - startedAt };
}

/** Closes the pool during graceful shutdown. */
export async function closePool(): Promise<void> {
  await pool.end();
}
