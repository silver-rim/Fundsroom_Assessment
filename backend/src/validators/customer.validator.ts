/**
 * Customer request schemas.
 *
 * Rules mirror the CHECK constraints in 001_init.sql, so the application
 * rejects bad input with a readable field-level message before the database
 * would reject it with a constraint name. The database remains the backstop.
 */
import { z } from 'zod';
import { CUSTOMER_STATUSES, CUSTOMER_TYPES } from '../types/domain';
import {
  dateStringSchema,
  emptyStringToUndefined,
  paginationQuerySchema,
  searchSchema,
  sortOrderSchema,
} from './common.validator';

/** 15-character GSTIN. Format only — no checksum, no government lookup. */
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const nameSchema = z
  .string({ required_error: 'Customer name is required' })
  .trim()
  .min(2, 'Customer name must be at least 2 characters')
  .max(120, 'Customer name cannot exceed 120 characters');

/**
 * Mobile number. Punctuation people naturally type — spaces, +, -, brackets —
 * is stripped before validation, so "+91 98765 43210" is accepted and stored as
 * digits, matching the `mobile ~ '^[0-9]{10,15}$'` constraint.
 */
const mobileSchema = z
  .string({ required_error: 'Mobile number is required' })
  .transform((value) => value.replace(/[\s+\-()]/g, ''))
  .refine((value) => /^[0-9]{10,15}$/.test(value), 'Enter a valid mobile number (10 to 15 digits)');

const emailSchema = z
  .string({ required_error: 'Email is required' })
  .trim()
  .max(254, 'Email is too long')
  .email('Enter a valid email address')
  .transform((value) => value.toLowerCase());

const businessNameSchema = z
  .string({ required_error: 'Business name is required' })
  .trim()
  .min(2, 'Business name must be at least 2 characters')
  .max(150, 'Business name cannot exceed 150 characters');

const gstNumberSchema = emptyStringToUndefined(
  z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => GSTIN_PATTERN.test(value), 'Enter a valid 15-character GST number')
    .optional(),
);

const addressSchema = z
  .string({ required_error: 'Address is required' })
  .trim()
  .min(5, 'Address must be at least 5 characters')
  .max(500, 'Address cannot exceed 500 characters');

const notesSchema = emptyStringToUndefined(
  z.string().trim().max(2000, 'Notes cannot exceed 2000 characters').optional(),
);

const customerTypeSchema = z.enum(CUSTOMER_TYPES, {
  errorMap: () => ({ message: `Customer type must be one of: ${CUSTOMER_TYPES.join(', ')}` }),
});

const statusSchema = z.enum(CUSTOMER_STATUSES, {
  errorMap: () => ({ message: `Status must be one of: ${CUSTOMER_STATUSES.join(', ')}` }),
});

/** POST /api/customers */
export const createCustomerSchema = z.object({
  name: nameSchema,
  mobile: mobileSchema,
  email: emailSchema,
  businessName: businessNameSchema,
  gstNumber: gstNumberSchema,
  customerType: customerTypeSchema,
  address: addressSchema,
  status: statusSchema.default('LEAD'),
  followUpDate: emptyStringToUndefined(dateStringSchema.optional()),
  notes: notesSchema,
});

/**
 * PUT /api/customers/:id — a full replacement, so every required field must be
 * present. The edit form always submits the complete record, and PUT that
 * silently keeps unsent fields is neither PUT nor PATCH.
 */
export const updateCustomerSchema = createCustomerSchema.extend({
  status: statusSchema,
});

/** GET /api/customers */
export const listCustomersQuerySchema = paginationQuerySchema.extend({
  search: searchSchema,
  status: statusSchema.optional(),
  customerType: customerTypeSchema.optional(),
  /** Finds customers whose follow-up is due on or before this date. */
  followUpBefore: dateStringSchema.optional(),
  sortBy: z.enum(['createdAt', 'name', 'businessName', 'followUpDate']).default('createdAt'),
  sortOrder: sortOrderSchema,
});

/** POST /api/customers/:id/follow-ups */
export const createFollowUpSchema = z.object({
  note: z
    .string({ required_error: 'Note is required' })
    .trim()
    .min(1, 'Note is required')
    .max(2000, 'Note cannot exceed 2000 characters'),
  /** When present, the customer's follow-up date is moved to match. */
  nextFollowUpDate: emptyStringToUndefined(dateStringSchema.optional()),
});

/** GET /api/customers/:id/follow-ups */
export const listFollowUpsQuerySchema = paginationQuerySchema;

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>;
export type ListFollowUpsQuery = z.infer<typeof listFollowUpsQuerySchema>;
