/**
 * Express application assembly.
 *
 * Kept separate from server.ts so the app can be imported and exercised without
 * binding a port. Middleware order matters and is deliberate:
 *
 *   security headers -> CORS -> body parsing -> request logging
 *     -> routes -> 404 -> central error handler
 */
import express, { type Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { logger } from './utils/logger';
import apiRoutes from './routes';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import { ForbiddenError } from './utils/AppError';

export function createApp(): Application {
  const app = express();

  // Render (and most PaaS platforms) terminate TLS at a proxy. Trusting the
  // first hop makes req.ip and req.protocol report the real client values.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());

  app.use(
    cors({
      origin(origin, callback) {
        // A missing Origin header means a same-origin or non-browser caller
        // (curl, Postman, a health probe) — those are not what CORS guards.
        if (!origin || env.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        logger.warn('Blocked a cross-origin request', { origin });
        // Must be an AppError, not a bare Error: the central handler treats an
        // unrecognised Error as a bug and answers 500. A rejected origin is the
        // policy working, so it has to surface as 403.
        callback(new ForbiddenError('This origin is not allowed by the CORS policy.'));
      },
      credentials: false,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  // 100 kB is far more than any endpoint in this API needs and puts a ceiling
  // on how much memory an unauthenticated caller can make the process allocate.
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  app.use(
    morgan(env.isProduction ? 'combined' : 'dev', {
      stream: { write: (message) => logger.info(message.trim()) },
      // The health endpoint is polled constantly; logging it buries real traffic.
      skip: (req) => req.originalUrl === '/api/health',
    }),
  );

  // A bare GET / is useful for confirming a deploy is live at all.
  app.get('/', (_req, res) => {
    res.json({
      success: true,
      data: {
        name: 'Mini ERP + CRM Operations Portal API',
        version: '1.0.0',
        docs: '/api/health',
      },
    });
  });

  app.use('/api', apiRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
