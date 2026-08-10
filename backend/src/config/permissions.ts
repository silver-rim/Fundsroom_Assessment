/**
 * The permission matrix, in executable form.
 *
 * docs/AUTHENTICATION.md documents these rules in prose; this file is what
 * actually enforces them. Routes reference a named group rather than listing
 * roles inline, so a policy change happens once, here — and so the matrix in
 * the documentation can be checked against real code instead of a promise.
 *
 * ADMIN appears in every group deliberately: "Admin has full access" is a
 * policy decision, and writing it out makes that explicit at each line rather
 * than hiding it in a special case inside the authorize middleware.
 */
import { ROLES, type Role } from '../types/domain';

/** Every authenticated role. Used for read-only endpoints open to all staff. */
export const ALL_ROLES: readonly Role[] = ROLES;

// ---- Customers ---------------------------------------------------------------
/** Warehouse and Accounts can look, but not touch. */
export const CUSTOMER_READ: readonly Role[] = ROLES;
export const CUSTOMER_WRITE: readonly Role[] = ['ADMIN', 'SALES'];
/** Deletion is the one irreversible-feeling action, so it stays with Admin. */
export const CUSTOMER_DELETE: readonly Role[] = ['ADMIN'];

// ---- CRM follow-ups ----------------------------------------------------------
/** Warehouse has no reason to work the sales pipeline. */
export const FOLLOW_UP_READ: readonly Role[] = ['ADMIN', 'SALES', 'ACCOUNTS'];
export const FOLLOW_UP_WRITE: readonly Role[] = ['ADMIN', 'SALES'];

// ---- Products ----------------------------------------------------------------
/** Sales must see what is available before promising a delivery. */
export const PRODUCT_READ: readonly Role[] = ROLES;
export const PRODUCT_WRITE: readonly Role[] = ['ADMIN', 'WAREHOUSE'];

// ---- Stock movements ---------------------------------------------------------
export const STOCK_READ: readonly Role[] = ROLES;
/** Only the warehouse adjusts a stock figure by hand. */
export const STOCK_WRITE: readonly Role[] = ['ADMIN', 'WAREHOUSE'];

// ---- Sales challans ----------------------------------------------------------
export const CHALLAN_READ: readonly Role[] = ROLES;
export const CHALLAN_WRITE: readonly Role[] = ['ADMIN', 'SALES'];
/** Confirmation is the moment goods physically leave, which is a warehouse act. */
export const CHALLAN_CONFIRM: readonly Role[] = ['ADMIN', 'SALES', 'WAREHOUSE'];
export const CHALLAN_CANCEL: readonly Role[] = ['ADMIN', 'SALES'];

// ---- User administration -----------------------------------------------------
export const USER_READ: readonly Role[] = ['ADMIN'];
