/**
 * Environment configuration.
 *
 * This is the ONLY module in the application that reads `process.env`.
 * Everything else imports the typed, validated `env` object below. If a
 * required variable is missing or malformed the process exits immediately with
 * a readable message, rather than failing later with an obscure runtime error.
 */
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/** Accepts "true"/"false" from a .env file and yields a real boolean. */
const booleanFromString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine(
      (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
      'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    ),
  DATABASE_SSL: booleanFromString.default('false'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  JWT_EXPIRES_IN: z.string().min(1).default('8h'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // Seed-only. Defaults are intentional throwaway development credentials;
  // seed.ts refuses to run against NODE_ENV=production without an explicit opt-in.
  SEED_ADMIN_PASSWORD: z.string().min(8).default('Admin@12345'),
  SEED_SALES_PASSWORD: z.string().min(8).default('Sales@12345'),
  SEED_WAREHOUSE_PASSWORD: z.string().min(8).default('Warehouse@12345'),
  SEED_ACCOUNTS_PASSWORD: z.string().min(8).default('Accounts@12345'),
  ALLOW_PRODUCTION_SEED: booleanFromString.default('false'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  // Written directly to stderr: the logger itself depends on this module.
  process.stderr.write(
    `\nInvalid environment configuration:\n${issues}\n\n` +
      `Copy backend/.env.example to backend/.env and fill in the missing values.\n\n`,
  );
  process.exit(1);
}

export const env = {
  ...parsed.data,
  /** Origins allowed by CORS, split and trimmed once at boot. */
  corsOrigins: parsed.data.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
  isProduction: parsed.data.NODE_ENV === 'production',
  isDevelopment: parsed.data.NODE_ENV === 'development',
} as const;

export type Env = typeof env;
