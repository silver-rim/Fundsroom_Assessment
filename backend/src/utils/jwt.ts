/**
 * JWT signing and verification.
 *
 * HS256 with the secret from the environment. The payload carries only the user
 * id and role — no name or email. The client already has those from the login
 * response, and a smaller token leaks less if it is ever exposed. A JWT is
 * signed, not encrypted: anything put in it is readable by anyone holding it.
 */
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { ERROR_CODES, UnauthenticatedError } from './AppError';
import { ROLES, type Role } from '../types/domain';

export interface TokenPayload {
  /** User id. Standard JWT "subject" claim, so it is a string on the wire. */
  sub: string;
  role: Role;
  iat: number;
  exp: number;
}

export interface IssuedToken {
  token: string;
  /** Lifetime in seconds, derived from the token itself rather than re-parsed. */
  expiresInSeconds: number;
}

const ISSUER = 'mini-erp-crm';

export function signToken(userId: number, role: Role): IssuedToken {
  const token = jwt.sign({ role }, env.JWT_SECRET, {
    subject: String(userId),
    issuer: ISSUER,
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN,
  } as SignOptions);

  // Read the lifetime back off the signed token instead of re-interpreting the
  // "8h" string, so the number reported to the client is always the real one.
  const decoded = jwt.decode(token) as TokenPayload | null;
  const expiresInSeconds = decoded ? decoded.exp - decoded.iat : 0;

  return { token, expiresInSeconds };
}

/**
 * Verifies a token and returns its payload.
 *
 * Throws UnauthenticatedError — never a raw jsonwebtoken error — so the shape
 * of the failure reaching the client is decided here rather than leaking the
 * library's own messages.
 */
export function verifyToken(token: string): TokenPayload {
  let payload: unknown;

  try {
    payload = jwt.verify(token, env.JWT_SECRET, {
      issuer: ISSUER,
      algorithms: ['HS256'], // pinned: never let the token choose its own algorithm
    });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthenticatedError(
        'Your session has expired. Please sign in again.',
        ERROR_CODES.TOKEN_EXPIRED,
      );
    }
    throw new UnauthenticatedError('Invalid authentication token.');
  }

  // jwt.verify resolves to string | JwtPayload; a token we issued is always an
  // object with these claims. Anything else is malformed regardless of signature.
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as TokenPayload).sub !== 'string' ||
    !ROLES.includes((payload as TokenPayload).role)
  ) {
    throw new UnauthenticatedError('Invalid authentication token.');
  }

  return payload as TokenPayload;
}
