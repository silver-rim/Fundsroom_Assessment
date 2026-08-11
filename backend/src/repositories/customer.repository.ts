/**
 * All SQL touching `customers` and `customer_follow_ups`.
 *
 * Every statement is parameterised. The only value ever interpolated into SQL
 * text is a sort column, and that comes from a whitelist map — never from the
 * request. Soft-deleted rows (`deleted_at IS NOT NULL`) are invisible to every
 * read here, so a deleted customer behaves exactly like one that never existed.
 */
import type { PoolClient } from 'pg';
import { query } from '../config/db';
import { offsetFor, resolveSortColumn, resolveSortDirection } from '../utils/pagination';
import { likeContains } from '../utils/sql';
import type { CustomerStatus, CustomerType } from '../types/domain';
import type {
  CreateCustomerInput,
  ListCustomersQuery,
  UpdateCustomerInput,
} from '../validators/customer.validator';

export interface CustomerCreatedBy {
  id: number;
  name: string;
}

export interface Customer {
  id: number;
  name: string;
  mobile: string;
  email: string;
  businessName: string;
  gstNumber: string | null;
  customerType: CustomerType;
  address: string;
  status: CustomerStatus;
  followUpDate: string | null;
  notes: string | null;
  createdBy: CustomerCreatedBy | null;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUp {
  id: number;
  customerId: number;
  note: string;
  nextFollowUpDate: string | null;
  createdBy: CustomerCreatedBy | null;
  createdAt: string;
}

interface CustomerRow {
  id: string;
  name: string;
  mobile: string;
  email: string;
  business_name: string;
  gst_number: string | null;
  customer_type: CustomerType;
  address: string;
  status: CustomerStatus;
  follow_up_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
  updated_at: Date;
}

interface FollowUpRow {
  id: string;
  customer_id: string;
  note: string;
  next_follow_up_date: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
}

/** Sort keys the API accepts, mapped to the columns they really mean. */
const SORT_COLUMNS = {
  createdAt: 'c.created_at',
  name: 'lower(c.name)',
  businessName: 'lower(c.business_name)',
  followUpDate: 'c.follow_up_date',
} as const;

const SELECT_COLUMNS = `
  c.id, c.name, c.mobile, c.email, c.business_name, c.gst_number,
  c.customer_type, c.address, c.status, c.follow_up_date, c.notes,
  c.created_by, u.name AS created_by_name, c.created_at, c.updated_at
`;

function toCustomer(row: CustomerRow): Customer {
  return {
    id: Number(row.id),
    name: row.name,
    mobile: row.mobile,
    email: row.email,
    businessName: row.business_name,
    gstNumber: row.gst_number,
    customerType: row.customer_type,
    address: row.address,
    status: row.status,
    followUpDate: row.follow_up_date,
    notes: row.notes,
    createdBy:
      row.created_by && row.created_by_name
        ? { id: Number(row.created_by), name: row.created_by_name }
        : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toFollowUp(row: FollowUpRow): FollowUp {
  return {
    id: Number(row.id),
    customerId: Number(row.customer_id),
    note: row.note,
    nextFollowUpDate: row.next_follow_up_date,
    createdBy:
      row.created_by && row.created_by_name
        ? { id: Number(row.created_by), name: row.created_by_name }
        : null,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Builds the shared WHERE clause for list and count.
 *
 * Both queries must filter identically or the pagination total will disagree
 * with the rows returned, so the clause is produced once and used by both.
 */
function buildFilters(filters: ListCustomersQuery): { where: string; params: unknown[] } {
  const conditions: string[] = ['c.deleted_at IS NULL'];
  const params: unknown[] = [];

  if (filters.search) {
    params.push(likeContains(filters.search));
    const p = `$${params.length}`;
    conditions.push(
      `(lower(c.name) LIKE ${p} OR lower(c.business_name) LIKE ${p} ` +
        `OR c.mobile LIKE ${p} OR lower(c.email) LIKE ${p})`,
    );
  }

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`c.status = $${params.length}`);
  }

  if (filters.customerType) {
    params.push(filters.customerType);
    conditions.push(`c.customer_type = $${params.length}`);
  }

  if (filters.followUpBefore) {
    params.push(filters.followUpBefore);
    conditions.push(`c.follow_up_date IS NOT NULL AND c.follow_up_date <= $${params.length}::date`);
  }

  return { where: conditions.join(' AND '), params };
}

export async function findAll(
  filters: ListCustomersQuery,
): Promise<{ customers: Customer[]; total: number }> {
  const { where, params } = buildFilters(filters);

  const countResult = await query<{ total: string }>(
    `SELECT count(*) AS total FROM customers c WHERE ${where}`,
    params,
  );
  const total = Number(countResult.rows[0]?.total ?? 0);

  const sortColumn = resolveSortColumn(SORT_COLUMNS, filters.sortBy, 'createdAt');
  const sortDirection = resolveSortDirection(filters.sortOrder);

  const listParams = [...params, filters.limit, offsetFor(filters.page, filters.limit)];

  const result = await query<CustomerRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM customers c
       LEFT JOIN users u ON u.id = c.created_by
      WHERE ${where}
      -- NULLS LAST keeps customers with no follow-up date at the bottom when
      -- sorting by it, instead of burying the ones that actually need a call.
      ORDER BY ${sortColumn} ${sortDirection} NULLS LAST, c.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    listParams,
  );

  return { customers: result.rows.map(toCustomer), total };
}

export async function findById(id: number): Promise<Customer | null> {
  const result = await query<CustomerRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM customers c
       LEFT JOIN users u ON u.id = c.created_by
      WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [id],
  );

  const row = result.rows[0];
  return row ? toCustomer(row) : null;
}

/** True when another live customer already uses this mobile number. */
export async function mobileExists(mobile: string, excludeId?: number): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM customers
        WHERE mobile = $1 AND deleted_at IS NULL AND ($2::bigint IS NULL OR id <> $2)
     ) AS exists`,
    [mobile, excludeId ?? null],
  );

  return result.rows[0]?.exists ?? false;
}

export async function create(input: CreateCustomerInput, createdBy: number): Promise<Customer> {
  const result = await query<{ id: string }>(
    `INSERT INTO customers
       (name, mobile, email, business_name, gst_number, customer_type,
        address, status, follow_up_date, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      input.name,
      input.mobile,
      input.email,
      input.businessName,
      input.gstNumber ?? null,
      input.customerType,
      input.address,
      input.status,
      input.followUpDate ?? null,
      input.notes ?? null,
      createdBy,
    ],
  );

  const id = Number(result.rows[0]?.id);
  const customer = await findById(id);
  if (!customer) throw new Error(`Customer ${id} vanished immediately after insert`);

  return customer;
}

export async function update(id: number, input: UpdateCustomerInput): Promise<Customer | null> {
  const result = await query(
    `UPDATE customers
        SET name = $2, mobile = $3, email = $4, business_name = $5, gst_number = $6,
            customer_type = $7, address = $8, status = $9, follow_up_date = $10, notes = $11
      WHERE id = $1 AND deleted_at IS NULL`,
    [
      id,
      input.name,
      input.mobile,
      input.email,
      input.businessName,
      input.gstNumber ?? null,
      input.customerType,
      input.address,
      input.status,
      input.followUpDate ?? null,
      input.notes ?? null,
    ],
  );

  if (result.rowCount === 0) return null;
  return findById(id);
}

/**
 * Soft delete. The row stays so historical challans keep a valid customer, and
 * every read in this file filters it out.
 */
export async function softDelete(id: number): Promise<boolean> {
  const result = await query(
    `UPDATE customers SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

// ---- Follow-ups --------------------------------------------------------------

export async function findFollowUps(
  customerId: number,
  page: number,
  limit: number,
): Promise<{ followUps: FollowUp[]; total: number }> {
  const countResult = await query<{ total: string }>(
    'SELECT count(*) AS total FROM customer_follow_ups WHERE customer_id = $1',
    [customerId],
  );
  const total = Number(countResult.rows[0]?.total ?? 0);

  const result = await query<FollowUpRow>(
    `SELECT f.id, f.customer_id, f.note, f.next_follow_up_date,
            f.created_by, u.name AS created_by_name, f.created_at
       FROM customer_follow_ups f
       LEFT JOIN users u ON u.id = f.created_by
      WHERE f.customer_id = $1
      ORDER BY f.created_at DESC, f.id DESC
      LIMIT $2 OFFSET $3`,
    [customerId, limit, offsetFor(page, limit)],
  );

  return { followUps: result.rows.map(toFollowUp), total };
}

/** Inserts a follow-up. Takes a client so it can share the service's transaction. */
export async function createFollowUp(
  client: PoolClient,
  customerId: number,
  note: string,
  nextFollowUpDate: string | null,
  createdBy: number,
): Promise<number> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO customer_follow_ups (customer_id, note, next_follow_up_date, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [customerId, note, nextFollowUpDate, createdBy],
  );

  return Number(result.rows[0]?.id);
}

/** Moves the customer's follow-up date, in the caller's transaction. */
export async function setFollowUpDate(
  client: PoolClient,
  customerId: number,
  followUpDate: string,
): Promise<void> {
  await client.query('UPDATE customers SET follow_up_date = $2 WHERE id = $1', [
    customerId,
    followUpDate,
  ]);
}

export async function findFollowUpById(id: number): Promise<FollowUp | null> {
  const result = await query<FollowUpRow>(
    `SELECT f.id, f.customer_id, f.note, f.next_follow_up_date,
            f.created_by, u.name AS created_by_name, f.created_at
       FROM customer_follow_ups f
       LEFT JOIN users u ON u.id = f.created_by
      WHERE f.id = $1`,
    [id],
  );

  const row = result.rows[0];
  return row ? toFollowUp(row) : null;
}
