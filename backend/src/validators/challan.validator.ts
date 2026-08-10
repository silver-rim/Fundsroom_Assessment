/**
 * Sales challan request schemas.
 *
 * Note what the client is NOT allowed to send: prices. A challan line carries
 * only a product id and a quantity. Names, SKUs and unit prices are read from
 * the products table server-side, so a caller cannot dictate what something
 * sold for.
 */
import { z } from 'zod';
import { CHALLAN_STATUSES } from '../types/domain';
import {
  dateStringSchema,
  emptyStringToUndefined,
  paginationQuerySchema,
  searchSchema,
  sortOrderSchema,
} from './common.validator';

const challanItemSchema = z.object({
  productId: z.coerce
    .number({ required_error: 'Product is required' })
    .int()
    .positive('Select a valid product'),
  quantity: z.coerce
    .number({ required_error: 'Quantity is required' })
    .int('Quantity must be a whole number')
    .positive('Quantity must be greater than zero')
    .max(1_000_000, 'Quantity cannot exceed 1,000,000'),
});

/**
 * Line items.
 *
 * Duplicate products are rejected rather than merged: the database has a
 * UNIQUE (challan_id, product_id) constraint, and silently summing two lines
 * would hide a data-entry mistake the user should see.
 */
const itemsSchema = z
  .array(challanItemSchema)
  .min(1, 'Add at least one product')
  .max(100, 'A challan cannot have more than 100 line items')
  .superRefine((items, ctx) => {
    const seen = new Map<number, number>();

    items.forEach((item, index) => {
      const firstIndex = seen.get(item.productId);

      if (firstIndex !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'productId'],
          message: `This product is already on line ${firstIndex + 1}. Combine the quantities instead.`,
        });
      } else {
        seen.set(item.productId, index);
      }
    });
  });

const notesSchema = emptyStringToUndefined(
  z.string().trim().max(1000, 'Notes cannot exceed 1000 characters').optional(),
);

/** POST /api/challans */
export const createChallanSchema = z.object({
  customerId: z.coerce
    .number({ required_error: 'Customer is required' })
    .int()
    .positive('Select a valid customer'),
  items: itemsSchema,
  notes: notesSchema,
  /**
   * "Save & confirm" in one call. Creation and stock deduction then share a
   * single transaction, so an insufficient-stock failure leaves no draft
   * behind — nothing at all is written.
   */
  confirmImmediately: z.boolean().default(false),
});

/** PUT /api/challans/:id — replaces a draft's customer, items and notes. */
export const updateChallanSchema = z.object({
  customerId: z.coerce.number().int().positive('Select a valid customer'),
  items: itemsSchema,
  notes: notesSchema,
});

/** POST /api/challans/:id/cancel */
export const cancelChallanSchema = z.object({
  reason: emptyStringToUndefined(
    z.string().trim().max(255, 'Reason cannot exceed 255 characters').optional(),
  ),
});

/** GET /api/challans */
export const listChallansQuerySchema = paginationQuerySchema
  .extend({
    /** Matches the challan number. */
    search: searchSchema,
    status: z.enum(CHALLAN_STATUSES).optional(),
    customerId: z.coerce.number().int().positive().optional(),
    createdBy: z.coerce.number().int().positive().optional(),
    dateFrom: emptyStringToUndefined(dateStringSchema.optional()),
    dateTo: emptyStringToUndefined(dateStringSchema.optional()),
    sortBy: z.enum(['createdAt', 'challanNumber', 'totalAmount', 'status']).default('createdAt'),
    sortOrder: sortOrderSchema,
  })
  .refine((query) => !query.dateFrom || !query.dateTo || query.dateFrom <= query.dateTo, {
    message: 'dateFrom must be on or before dateTo',
    path: ['dateFrom'],
  });

export type CreateChallanInput = z.infer<typeof createChallanSchema>;
export type UpdateChallanInput = z.infer<typeof updateChallanSchema>;
export type CancelChallanInput = z.infer<typeof cancelChallanSchema>;
export type ListChallansQuery = z.infer<typeof listChallansQuerySchema>;
