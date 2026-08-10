/**
 * Product and stock-movement request schemas.
 */
import { z } from 'zod';
import { MOVEMENT_REFERENCE_TYPES, MOVEMENT_TYPES } from '../types/domain';
import {
  dateStringSchema,
  emptyStringToUndefined,
  paginationQuerySchema,
  searchSchema,
  sortOrderSchema,
} from './common.validator';

const nameSchema = z
  .string({ required_error: 'Product name is required' })
  .trim()
  .min(2, 'Product name must be at least 2 characters')
  .max(150, 'Product name cannot exceed 150 characters');

/** Stored upper-cased so `cw-25` and `CW-25` cannot both exist. */
const skuSchema = z
  .string({ required_error: 'SKU is required' })
  .trim()
  .transform((value) => value.toUpperCase())
  .refine(
    (value) => /^[A-Za-z0-9_-]{2,50}$/.test(value),
    'SKU must be 2–50 characters, using only letters, numbers, hyphens and underscores',
  );

const categorySchema = z
  .string({ required_error: 'Category is required' })
  .trim()
  .min(2, 'Category must be at least 2 characters')
  .max(80, 'Category cannot exceed 80 characters');

/**
 * Money. Accepts a number or a decimal string and keeps it as a string all the
 * way to PostgreSQL NUMERIC — converting through a JS float would introduce the
 * rounding error the NUMERIC column exists to avoid.
 */
const priceSchema = z
  .union([z.number(), z.string()])
  .transform((value) => (typeof value === 'number' ? value.toString() : value.trim()))
  .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), 'Enter a valid price with up to 2 decimals')
  .refine((value) => Number(value) <= 99_999_999.99, 'Price is too large');

const quantitySchema = z.coerce
  .number({ invalid_type_error: 'Quantity must be a number' })
  .int('Quantity must be a whole number')
  .min(0, 'Quantity cannot be negative')
  .max(1_000_000, 'Quantity cannot exceed 1,000,000');

const locationSchema = z
  .string({ required_error: 'Location is required' })
  .trim()
  .min(1, 'Location is required')
  .max(100, 'Location cannot exceed 100 characters');

/**
 * Guards `currentStock` against direct edits.
 *
 * Zod strips unknown keys, so simply omitting the field would silently discard
 * it and the caller would think the change had been applied. Declaring it and
 * failing tells them the rule instead. See docs/API_PLAN.md.
 */
const currentStockGuard = z
  .any()
  .optional()
  .refine(
    (value) => value === undefined,
    'currentStock cannot be edited directly. Record a stock movement instead.',
  );

/** POST /api/products */
export const createProductSchema = z.object({
  name: nameSchema,
  sku: skuSchema,
  category: categorySchema,
  unitPrice: priceSchema,
  minStockAlert: quantitySchema.default(0),
  location: locationSchema,
  /** Optional. A non-zero value writes an IN movement in the same transaction. */
  openingStock: quantitySchema.default(0),
  currentStock: currentStockGuard,
});

/** PUT /api/products/:id — full replacement, stock excluded. */
export const updateProductSchema = z.object({
  name: nameSchema,
  sku: skuSchema,
  category: categorySchema,
  unitPrice: priceSchema,
  minStockAlert: quantitySchema,
  location: locationSchema,
  currentStock: currentStockGuard,
});

/** PATCH /api/products/:id/status */
export const updateProductStatusSchema = z.object({
  isActive: z.boolean({ required_error: 'isActive is required' }),
});

/** GET /api/products */
export const listProductsQuerySchema = paginationQuerySchema.extend({
  search: searchSchema,
  category: z.string().trim().max(80).optional(),
  /** Only products at or below their alert threshold. */
  lowStock: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  /** Deactivated products are hidden by default — they cannot be sold. */
  isActive: z.enum(['true', 'false', 'all']).default('true'),
  sortBy: z
    .enum(['createdAt', 'name', 'sku', 'category', 'unitPrice', 'currentStock'])
    .default('createdAt'),
  sortOrder: sortOrderSchema,
});

// ---- Stock movements ---------------------------------------------------------

/** POST /api/stock-movements */
export const createStockMovementSchema = z.object({
  productId: z.coerce
    .number({ required_error: 'Product is required' })
    .int()
    .positive('Select a valid product'),
  movementType: z.enum(MOVEMENT_TYPES, {
    errorMap: () => ({ message: 'Movement type must be IN or OUT' }),
  }),
  quantity: z.coerce
    .number({ required_error: 'Quantity is required' })
    .int('Quantity must be a whole number')
    .positive('Quantity must be greater than zero')
    .max(1_000_000, 'Quantity cannot exceed 1,000,000'),
  /** Mandatory: every stock change must be explainable months later. */
  reason: z
    .string({ required_error: 'Reason is required' })
    .trim()
    .min(3, 'Reason must be at least 3 characters')
    .max(255, 'Reason cannot exceed 255 characters'),
});

/** GET /api/stock-movements */
export const listStockMovementsQuerySchema = paginationQuerySchema
  .extend({
    productId: z.coerce.number().int().positive().optional(),
    movementType: z.enum(MOVEMENT_TYPES).optional(),
    referenceType: z.enum(MOVEMENT_REFERENCE_TYPES).optional(),
    createdBy: z.coerce.number().int().positive().optional(),
    dateFrom: emptyStringToUndefined(dateStringSchema.optional()),
    dateTo: emptyStringToUndefined(dateStringSchema.optional()),
  })
  .refine(
    (query) => !query.dateFrom || !query.dateTo || query.dateFrom <= query.dateTo,
    { message: 'dateFrom must be on or before dateTo', path: ['dateFrom'] },
  );

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type UpdateProductStatusInput = z.infer<typeof updateProductStatusSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
export type CreateStockMovementInput = z.infer<typeof createStockMovementSchema>;
export type ListStockMovementsQuery = z.infer<typeof listStockMovementsQuerySchema>;
