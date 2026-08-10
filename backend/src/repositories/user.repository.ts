/**
 * All SQL touching the `users` table.
 *
 * Two distinct row shapes are returned on purpose:
 *   - `UserWithCredentials` includes the password hash and is used only by the
 *     login path.
 *   - `PublicUser` never contains the hash, and is what every other caller and
 *     every API response uses.
 *
 * Keeping them separate means a response object physically cannot carry a
 * password hash, rather than relying on someone remembering to delete it.
 */
import type { PoolClient } from 'pg';
import { query } from '../config/db';
import type { Role } from '../types/domain';

export interface PublicUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface UserWithCredentials extends PublicUser {
  passwordHash: string;
}

/** Raw row shape. `pg` returns BIGSERIAL as a string to avoid precision loss. */
interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  is_active: boolean;
  created_at: Date;
}

const PUBLIC_COLUMNS = 'id, name, email, role, is_active, created_at';

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Looks a user up for authentication, including the password hash.
 *
 * Matched on `lower(email)` so the lookup uses the uq_users_email_lower index
 * and sign-in is case-insensitive.
 */
export async function findByEmailWithCredentials(
  email: string,
): Promise<UserWithCredentials | null> {
  const result = await query<UserRow>(
    `SELECT ${PUBLIC_COLUMNS}, password_hash
       FROM users
      WHERE lower(email) = lower($1)`,
    [email],
  );

  const row = result.rows[0];
  if (!row) return null;

  return { ...toPublicUser(row), passwordHash: row.password_hash };
}

export async function findById(id: number): Promise<PublicUser | null> {
  const result = await query<UserRow>(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`,
    [id],
  );

  const row = result.rows[0];
  return row ? toPublicUser(row) : null;
}

/** Every employee account, for the Admin-only user list. */
export async function findAll(client?: PoolClient): Promise<PublicUser[]> {
  const sql = `SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY id`;
  const result = client ? await client.query<UserRow>(sql) : await query<UserRow>(sql);
  return result.rows.map(toPublicUser);
}
