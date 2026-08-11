/**
 * Application error hierarchy.
 *
 * Services throw these; the central error handler is the only place that turns
 * them into an HTTP response. An `AppError` is "operational" — an expected
 * failure whose message was written for a human and is safe to return to the
 * client. Anything that is NOT an AppError is treated as a bug and answered
 * with a generic 500.
 *
 * Status code policy is documented in docs/ARCHITECTURE.md section 7.
 */

export const ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  CONFLICT: 'CONFLICT',
  DUPLICATE_EMAIL: 'DUPLICATE_EMAIL',
  DUPLICATE_MOBILE: 'DUPLICATE_MOBILE',
  DUPLICATE_SKU: 'DUPLICATE_SKU',
  INVALID_STATE: 'INVALID_STATE',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** A single field-level problem, returned in `error.details`. */
export interface ErrorDetail {
  field: string;
  message: string;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: ErrorDetail[];
  /** Distinguishes an expected failure from a programming bug. */
  readonly isOperational = true;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    if (details && details.length > 0) this.details = details;
    Error.captureStackTrace(this, new.target);
  }
}

/** 400 - the request is malformed enough that it cannot even be validated. */
export class BadRequestError extends AppError {
  constructor(message = 'Malformed request.', details?: ErrorDetail[]) {
    super(400, ERROR_CODES.BAD_REQUEST, message, details);
  }
}

/** 422 - well-formed request that fails schema or semantic validation. */
export class ValidationError extends AppError {
  constructor(message = 'Request validation failed.', details?: ErrorDetail[]) {
    super(422, ERROR_CODES.VALIDATION_ERROR, message, details);
  }
}

/** 401 - not authenticated, or authentication was rejected. */
export class UnauthenticatedError extends AppError {
  constructor(
    message = 'Authentication is required to access this resource.',
    code: ErrorCode = ERROR_CODES.UNAUTHENTICATED,
  ) {
    super(401, code, message);
  }
}

/** 403 - authenticated, but this role may not perform the action. */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(403, ERROR_CODES.FORBIDDEN, message);
  }
}

/** 404 - the resource does not exist, or has been soft-deleted. */
export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(404, ERROR_CODES.NOT_FOUND, `${resource} not found.`);
  }
}

/** 409 - uniqueness or state conflict, including insufficient stock. */
export class ConflictError extends AppError {
  constructor(
    message: string,
    code: ErrorCode = ERROR_CODES.CONFLICT,
    details?: ErrorDetail[],
  ) {
    super(409, code, message, details);
  }
}

/** 503 - a dependency (the database) is unavailable. */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable.') {
    super(503, ERROR_CODES.SERVICE_UNAVAILABLE, message);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
