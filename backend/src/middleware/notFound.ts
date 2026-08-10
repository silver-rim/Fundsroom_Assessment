/**
 * Catches any request that matched no route and turns it into a 404 in the
 * standard error envelope, so even a typo'd URL returns something the frontend
 * can parse instead of Express's default HTML page.
 *
 * Mounted after all routes and before the error handler.
 */
import type { NextFunction, Request, Response } from 'express';
import { AppError, ERROR_CODES } from '../utils/AppError';

export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(
    new AppError(
      404,
      ERROR_CODES.NOT_FOUND,
      `Route ${req.method} ${req.originalUrl} does not exist.`,
    ),
  );
}
