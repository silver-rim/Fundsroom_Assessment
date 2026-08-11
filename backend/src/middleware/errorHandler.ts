/**
 * Central error handler — the single place that converts a thrown error into an
 * HTTP response.
 *
 * Contract (docs/ARCHITECTURE.md section 7):
 *   1. AppError            -> its own status / code / message / details
 *   2. ZodError            -> 422 with per-field details
 *   3. Known Postgres codes-> translated, never leaked
 *   4. Anything else       -> 500 with a fixed generic message
 *
 * Stack traces are logged server-side and are attached to the response body
 * only when NODE_ENV is not 'production'.
 */
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import {
  AppError,
  ERROR_CODES,
  type ErrorCode,
  type ErrorDetail,
  isAppError,
} from '../utils/AppError';
import type { ErrorBody } from '../utils/httpResponse';

/** Shape of the driver-level error thrown by `pg`. */
interface PostgresError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

function isPostgresError(error: unknown): error is PostgresError {
  return error instanceof Error && typeof (error as PostgresError).code === 'string';
}

/**
 * An error thrown by Express or body-parser, which follow the `http-errors`
 * shape: a numeric `status`/`statusCode` and `expose: true` when the message is
 * safe to show a client.
 */
interface HttpishError extends Error {
  status?: number;
  statusCode?: number;
  expose?: boolean;
  type?: string;
}

function clientErrorStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;

  const { status, statusCode } = error as HttpishError;
  const value = typeof status === 'number' ? status : statusCode;

  return typeof value === 'number' && value >= 400 && value < 500 ? value : null;
}

/**
 * Maps a body-parser / Express rejection onto our own vocabulary.
 *
 * These errors also carry a string `code` ('ETOOLARGE'), which is exactly what
 * `isPostgresError` looks for — so without this branch an oversized body was
 * mistaken for a database error and answered 500 instead of 413.
 */
function translateHttpError(error: HttpishError, status: number): AppError {
  switch (status) {
    case 413:
      return new AppError(
        413,
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        'Request body is too large. The limit is 100 kB.',
      );
    case 415:
      return new AppError(
        415,
        ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
        'Unsupported content type. Send application/json.',
      );
    default:
      return new AppError(
        status,
        status === 404 ? ERROR_CODES.NOT_FOUND : ERROR_CODES.BAD_REQUEST,
        // `expose` is http-errors' own signal that the message was written for
        // a client. When it is not set, fall back to something generic.
        error.expose && error.message ? error.message : 'The request could not be processed.',
      );
  }
}

/** Maps a unique-constraint name to the specific error code the API promises. */
const UNIQUE_CONSTRAINT_ERRORS: Record<string, { code: ErrorCode; message: string }> = {
  uq_users_email_lower: {
    code: ERROR_CODES.DUPLICATE_EMAIL,
    message: 'A user with this email address already exists.',
  },
  // Partial unique index over live rows only — see migration 002.
  uq_customers_mobile_active: {
    code: ERROR_CODES.DUPLICATE_MOBILE,
    message: 'A customer with this mobile number already exists.',
  },
  products_sku_key: {
    code: ERROR_CODES.DUPLICATE_SKU,
    message: 'A product with this SKU already exists.',
  },
};

function translatePostgresError(error: PostgresError): AppError {
  switch (error.code) {
    // unique_violation
    case '23505': {
      const known = error.constraint ? UNIQUE_CONSTRAINT_ERRORS[error.constraint] : undefined;
      return new AppError(
        409,
        known?.code ?? ERROR_CODES.CONFLICT,
        known?.message ?? 'A record with these details already exists.',
      );
    }
    // foreign_key_violation
    case '23503':
      return new AppError(
        409,
        ERROR_CODES.CONFLICT,
        'This operation references a record that does not exist, or would remove a record that is still in use.',
      );
    // not_null_violation
    case '23502':
      return new AppError(422, ERROR_CODES.VALIDATION_ERROR, 'A required field was missing.');
    // check_violation - the database rejected a value the service should have caught first
    case '23514':
      return new AppError(
        422,
        ERROR_CODES.VALIDATION_ERROR,
        'A submitted value is outside the range this field allows.',
      );
    // connection failures
    case 'ECONNREFUSED':
    case '57P01':
    case '08006':
    case '08003':
      return new AppError(
        503,
        ERROR_CODES.SERVICE_UNAVAILABLE,
        'The database is temporarily unavailable. Please try again shortly.',
      );
    default:
      return new AppError(500, ERROR_CODES.INTERNAL_ERROR, 'An unexpected error occurred.');
  }
}

function zodToDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(body)',
    message: issue.message,
  }));
}

function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof ZodError) {
    return new AppError(
      422,
      ERROR_CODES.VALIDATION_ERROR,
      'Request validation failed.',
      zodToDetails(error),
    );
  }

  // Body parser rejects malformed JSON with a SyntaxError carrying `status: 400`.
  if (error instanceof SyntaxError && 'body' in error) {
    return new AppError(400, ERROR_CODES.BAD_REQUEST, 'Request body is not valid JSON.');
  }

  // Must come BEFORE the Postgres check: these errors carry a string `code`
  // too, and would otherwise be misread as a database failure.
  const httpStatus = clientErrorStatus(error);
  if (httpStatus !== null) return translateHttpError(error as HttpishError, httpStatus);

  if (isPostgresError(error)) return translatePostgresError(error);

  return new AppError(500, ERROR_CODES.INTERNAL_ERROR, 'An unexpected error occurred.');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express identifies
// an error handler by its four-parameter signature; `next` must stay declared.
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const appError = toAppError(error);

  const logMeta = {
    method: req.method,
    path: req.originalUrl,
    statusCode: appError.statusCode,
    code: appError.code,
  };

  // 5xx means we have a bug or an outage: log the whole thing.
  // 4xx is the client being told "no", which is normal traffic.
  if (appError.statusCode >= 500) {
    logger.error(appError.message, {
      ...logMeta,
      stack: error instanceof Error ? error.stack : undefined,
    });
  } else {
    logger.warn(appError.message, logMeta);
  }

  // If headers are already sent the response is mid-flight; hand it to Express
  // to destroy the socket rather than trying to write a second time.
  if (res.headersSent) {
    next(error);
    return;
  }

  const body: ErrorBody = {
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
      ...(!env.isProduction && error instanceof Error && error.stack
        ? { stack: error.stack }
        : {}),
    },
  };

  res.status(appError.statusCode).json(body);
}
