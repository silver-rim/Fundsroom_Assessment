/**
 * Authentication business rules.
 *
 * Knows nothing about req/res — it takes input and returns data or throws.
 */
import * as userRepository from '../repositories/user.repository';
import type { PublicUser } from '../repositories/user.repository';
import { verifyPassword } from '../utils/password';
import { signToken } from '../utils/jwt';
import { ERROR_CODES, NotFoundError, UnauthenticatedError } from '../utils/AppError';
import { logger } from '../utils/logger';
import type { LoginInput } from '../validators/auth.validator';

export interface LoginResult {
  token: string;
  expiresIn: number;
  user: PublicUser;
}

/**
 * A valid bcrypt hash of a value nobody can supply.
 *
 * When the email does not exist we still run a bcrypt comparison against this,
 * so a request for an unknown account costs the same time as one for a known
 * account. Without it, response timing alone reveals which emails are
 * registered — the identical error message would not be enough to prevent
 * account enumeration.
 */
const DUMMY_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.DzC0Cy0N0FQ8vC5mS6qUOxHYPZ3W';

/**
 * Exchanges credentials for a JWT.
 *
 * Unknown email, wrong password and deactivated account all produce the exact
 * same 401 response. Telling the caller which one it was would let anyone
 * discover valid company email addresses, and would tell an attacker who has
 * guessed a real address that they only need the password.
 */
export async function login(input: LoginInput): Promise<LoginResult> {
  const user = await userRepository.findByEmailWithCredentials(input.email);

  const passwordMatches = await verifyPassword(
    input.password,
    user?.passwordHash ?? DUMMY_HASH,
  );

  if (!user || !passwordMatches || !user.isActive) {
    // Logged with the reason for operators, who legitimately need to tell a
    // locked-out colleague from an attack. The client still sees one message.
    logger.warn('Failed login attempt', {
      email: input.email,
      reason: !user ? 'unknown_email' : !passwordMatches ? 'bad_password' : 'inactive_account',
    });

    throw new UnauthenticatedError(
      'Invalid email or password.',
      ERROR_CODES.INVALID_CREDENTIALS,
    );
  }

  const { token, expiresInSeconds } = signToken(user.id, user.role);

  logger.info('User signed in', { userId: user.id, role: user.role });

  // Destructured so the password hash cannot ride along into the response.
  const { passwordHash: _passwordHash, ...publicUser } = user;

  return { token, expiresIn: expiresInSeconds, user: publicUser };
}

/**
 * Resolves the token holder's current profile.
 *
 * Read from the database rather than from the token, so the frontend rehydrates
 * a session with current data — and so a token naming a deleted user fails
 * cleanly instead of producing a phantom session.
 */
export async function getProfile(userId: number): Promise<PublicUser> {
  const user = await userRepository.findById(userId);

  if (!user) throw new NotFoundError('User');

  if (!user.isActive) {
    throw new UnauthenticatedError('This account has been deactivated.');
  }

  return user;
}
