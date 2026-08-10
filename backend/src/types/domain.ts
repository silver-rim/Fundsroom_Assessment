/**
 * Domain enumerations.
 *
 * Each value set is declared once, here, as a readonly tuple. The tuple feeds
 * both the TypeScript union type and (from Phase 2 onwards) the Zod schema, so
 * the API, the application and the database CHECK constraints cannot drift
 * apart. Values match `docs/DATABASE_DESIGN.md` exactly.
 */

export const ROLES = ['ADMIN', 'SALES', 'WAREHOUSE', 'ACCOUNTS'] as const;
export type Role = (typeof ROLES)[number];

export const CUSTOMER_TYPES = ['RETAIL', 'WHOLESALE', 'DISTRIBUTOR'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const CUSTOMER_STATUSES = ['LEAD', 'ACTIVE', 'INACTIVE'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const MOVEMENT_TYPES = ['IN', 'OUT'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_REFERENCE_TYPES = ['MANUAL', 'SALES_CHALLAN'] as const;
export type MovementReferenceType = (typeof MOVEMENT_REFERENCE_TYPES)[number];

export const CHALLAN_STATUSES = ['DRAFT', 'CONFIRMED', 'CANCELLED'] as const;
export type ChallanStatus = (typeof CHALLAN_STATUSES)[number];

/** Authenticated principal attached to a request by the auth middleware (Phase 2). */
export interface AuthenticatedUser {
  id: number;
  role: Role;
}
