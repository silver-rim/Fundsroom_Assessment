/**
 * Proves who the caller is.
 *
 * Reads a bearer token, verifies it, and attaches `{ id, role }` to the
 * request. Every route except POST /api/auth/login and GET /api/health sits
 * behind this.
 *
 * The role is taken from the token rather than re-read from the database on
 * every request. That keeps the API stateless and avoids a query per call; the
 * documented trade-off is that changing or deactivating a user's role takes
 * effect at their next login, not instantly. See docs/AUTHENTICATION.md.
 */
import type { RequestHandler } from 'express';
import { verifyToken } from '../utils/jwt';
import { UnauthenticatedError } from '../utils/AppError';

const BEARER_PREFIX = 'Bearer ';

export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith(BEARER_PREFIX)) {
    next(
      new UnauthenticatedError(
        'Authentication required. Provide an Authorization: Bearer <token> header.',
      ),
    );
    return;
  }

  const token = header.slice(BEARER_PREFIX.length).trim();

  if (token.length === 0) {
    next(new UnauthenticatedError('Authentication required.'));
    return;
  }

  try {
    const payload = verifyToken(token);
    req.user = { id: Number(payload.sub), role: payload.role };
    next();
  } catch (error) {
    next(error);
  }
};
