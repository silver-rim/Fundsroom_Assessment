/**
 * Decides whether the caller's role may perform this action.
 *
 * Always mounted after `authenticate`. Role groups come from
 * config/permissions.ts so routes read as policy rather than as role lists:
 *
 *     router.post('/', authenticate, authorize(CUSTOMER_WRITE), ...)
 *
 * This is the real access control. The frontend hides what a role cannot use,
 * but that is a courtesy to the user — it is not a security boundary, because
 * anyone can call the API directly.
 */
import type { RequestHandler } from 'express';
import type { Role } from '../types/domain';
import { ForbiddenError, UnauthenticatedError } from '../utils/AppError';

export function authorize(allowedRoles: readonly Role[]): RequestHandler {
  return (req, _res, next) => {
    // Defensive: reaching here without a user means the route forgot
    // `authenticate`. Answering 401 is both correct and a loud signal in tests.
    if (!req.user) {
      next(new UnauthenticatedError());
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      // The message names the requirement but not the caller's own role or any
      // detail about the resource — enough to be actionable, not enough to map
      // out the permission model from outside.
      next(
        new ForbiddenError(
          `You do not have permission to perform this action. Required role: ${allowedRoles.join(' or ')}.`,
        ),
      );
      return;
    }

    next();
  };
}
