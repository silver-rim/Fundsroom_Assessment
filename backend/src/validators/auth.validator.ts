/**
 * Auth request schemas.
 *
 * The inferred types are the DTOs, so validation and typing cannot drift apart.
 */
import { z } from 'zod';

export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .min(1, 'Email is required')
    .max(254, 'Email is too long')
    .email('Enter a valid email address')
    .transform((value) => value.toLowerCase()),

  // Deliberately only checked for presence and a sane length. Enforcing
  // complexity rules on a LOGIN form tells an attacker what passwords look
  // like, and rejects legitimate users whose password predates any rule change.
  // Strength rules belong on password creation, not password entry.
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required')
    .max(128, 'Password is too long'),
});

export type LoginInput = z.infer<typeof loginSchema>;
