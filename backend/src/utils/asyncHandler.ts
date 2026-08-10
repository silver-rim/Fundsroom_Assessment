/**
 * Wraps an async route handler so a rejected promise reaches the central error
 * handler instead of hanging the request.
 *
 * Express 5 forwards async rejections on its own, but wrapping is kept for two
 * reasons: it is explicit at every call site, and it keeps the code correct if
 * the project is ever pinned back to Express 4.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export function asyncHandler(handler: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
