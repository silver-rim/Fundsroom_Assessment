/**
 * Express request augmentation.
 *
 * Two properties are added to every request:
 *
 *   `user`      - set by the authenticate middleware. Optional, because it is
 *                 absent on public routes; middleware and controllers behind
 *                 `authenticate` can rely on it being present.
 *
 *   `validated` - set by the validate middleware. Express 5 exposes `req.query`
 *                 through a getter with no setter, so parsed values cannot be
 *                 written back onto req.body/query/params. Keeping them in one
 *                 dedicated bag also makes it obvious at a glance whether a
 *                 handler is reading raw input or validated input.
 */
import type { AuthenticatedUser } from './domain';

export interface ValidatedRequestData {
  body: unknown;
  params: unknown;
  query: unknown;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      validated: ValidatedRequestData;
    }
  }
}
