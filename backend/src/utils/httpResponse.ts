/**
 * Response envelope helpers.
 *
 * Every endpoint answers in one of these shapes, so the frontend needs exactly
 * one function to read a success and one to read an error. See
 * docs/API_PLAN.md section 1.
 */
import type { Response } from 'express';
import type { ErrorCode, ErrorDetail } from './AppError';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SuccessBody<T> {
  success: true;
  data: T;
  pagination?: PaginationMeta;
}

export interface ErrorBody {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
    /** Present only when NODE_ENV !== 'production'. Never sent to real clients. */
    stack?: string;
  };
}

/** `{ success: true, data }` with the given status (200 by default). */
export function sendSuccess<T>(res: Response, data: T, statusCode = 200): Response {
  const body: SuccessBody<T> = { success: true, data };
  return res.status(statusCode).json(body);
}

/** `{ success: true, data: [...], pagination }` for list endpoints. */
export function sendPaginated<T>(
  res: Response,
  data: T[],
  pagination: PaginationMeta,
  statusCode = 200,
): Response {
  const body: SuccessBody<T[]> = { success: true, data, pagination };
  return res.status(statusCode).json(body);
}
