/**
 * Health check.
 *
 * Reports process liveness and database reachability. Render polls this to
 * decide whether a deploy succeeded, and the frontend's System Status card uses
 * it to prove the whole chain (browser -> API -> PostgreSQL) is wired up.
 */
import type { Request, Response } from 'express';
import { checkDatabaseConnection } from '../config/db';
import { env } from '../config/env';
import { sendSuccess } from '../utils/httpResponse';

export async function getHealth(_req: Request, res: Response): Promise<void> {
  let database: { status: 'up' | 'down'; latencyMs: number | null } = {
    status: 'down',
    latencyMs: null,
  };

  try {
    const result = await checkDatabaseConnection();
    database = { status: 'up', latencyMs: result.latencyMs };
  } catch {
    // Deliberately swallowed: the endpoint's job is to REPORT that the database
    // is down, not to fail with a 500. The driver error is not exposed because
    // it can contain the connection string's host and username.
    database = { status: 'down', latencyMs: null };
  }

  const isHealthy = database.status === 'up';

  sendSuccess(
    res,
    {
      status: isHealthy ? 'ok' : 'degraded',
      environment: env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      database,
    },
    isHealthy ? 200 : 503,
  );
}
