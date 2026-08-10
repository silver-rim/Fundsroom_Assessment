/**
 * Password hashing.
 *
 * `bcryptjs` is a pure-JavaScript bcrypt implementation. It is used instead of
 * the native `bcrypt` package so that `npm install` needs no C++ toolchain —
 * which matters on Windows development machines and on free-tier build
 * containers. The hash format is standard bcrypt and is interchangeable.
 *
 * A plaintext password is never logged, stored, or returned from any function
 * in this module.
 */
import bcrypt from 'bcryptjs';
import { env } from '../config/env';

export async function hashPassword(plainText: string): Promise<string> {
  return bcrypt.hash(plainText, env.BCRYPT_SALT_ROUNDS);
}

export async function verifyPassword(plainText: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainText, hash);
}
