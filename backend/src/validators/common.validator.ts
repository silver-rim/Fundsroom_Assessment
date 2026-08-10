/**
 * Schemas reused across every module.
 *
 * Defining pagination, id params and date handling once means every list
 * endpoint behaves identically — same defaults, same limits, same error text.
 */
import { z } from 'zod';

/** `:id` path parameter. Coerced from string, must be a positive integer. */
export const idParamSchema = z.object({
  id: z.coerce
    .number({ invalid_type_error: 'id must be a number' })
    .int('id must be a whole number')
    .positive('id must be a positive number'),
});

export type IdParam = z.infer<typeof idParamSchema>;

/**
 * A calendar date: 'YYYY-MM-DD', kept as a string end to end.
 *
 * The regex alone would accept 2026-02-31, so the value is round-tripped
 * through Date and compared back to catch impossible days.
 */
export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Not a valid calendar date');

/**
 * Treats an empty string as "not provided".
 *
 * HTML forms submit "" for untouched optional inputs. Without this, an empty
 * optional date or GST number would fail validation instead of being stored as
 * NULL, and every form would have to strip its own blanks before submitting.
 */
export function emptyStringToUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema,
  );
}

export const PAGINATION_DEFAULTS = { page: 1, limit: 20, maxLimit: 100 } as const;

/** `?page=&limit=` for every list endpoint. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page must be 1 or greater').default(PAGINATION_DEFAULTS.page),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'limit must be at least 1')
    .max(PAGINATION_DEFAULTS.maxLimit, `limit cannot exceed ${PAGINATION_DEFAULTS.maxLimit}`)
    .default(PAGINATION_DEFAULTS.limit),
});

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

/** Free-text search term, shared by every searchable list. */
export const searchSchema = z.string().trim().max(100, 'Search term is too long').optional();
