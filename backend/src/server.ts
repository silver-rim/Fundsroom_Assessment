/**
 * Process entry point.
 *
 * Verifies the database is reachable before accepting traffic, then listens.
 * Handles graceful shutdown so in-flight requests finish and the connection
 * pool is drained when the platform sends SIGTERM during a redeploy.
 */
import type { Server } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { checkDatabaseConnection, closePool } from './config/db';
import { logger } from './utils/logger';

async function start(): Promise<void> {
  // Fail fast and loudly: a server that boots without a database only produces
  // confusing 500s on the first real request.
  try {
    const { latencyMs } = await checkDatabaseConnection();
    logger.info('Database connection established', { latencyMs });
  } catch (error) {
    logger.error('Could not connect to the database - aborting startup', {
      error: error instanceof Error ? error.message : String(error),
      hint: 'Check DATABASE_URL and DATABASE_SSL in backend/.env',
    });
    process.exit(1);
  }

  const app = createApp();

  const server: Server = app.listen(env.PORT, () => {
    logger.info('API server started', {
      port: env.PORT,
      environment: env.NODE_ENV,
      corsOrigins: env.corsOrigins,
    });
  });

  const shutdown = (signal: string): void => {
    logger.info(`${signal} received - shutting down gracefully`);

    server.close(() => {
      void closePool()
        .then(() => {
          logger.info('Shutdown complete');
          process.exit(0);
        })
        .catch(() => process.exit(1));
    });

    // Do not let a hung connection block a redeploy forever.
    setTimeout(() => {
      logger.error('Graceful shutdown timed out - forcing exit');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // A rejection nobody handled means the process is in an unknown state.
  // Log it with the stack and let the platform restart a clean one.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', {
      reason: reason instanceof Error ? reason.stack : String(reason),
    });
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.stack ?? error.message });
    process.exit(1);
  });
}

void start();
