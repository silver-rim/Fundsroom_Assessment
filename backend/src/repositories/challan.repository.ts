/**
 * All SQL touching `sales_challans` and `sales_challan_items`.
 *
 * Most write functions take a PoolClient rather than using the pool directly:
 * challan creation and confirmation are multi-statement operations that must
 * succeed or fail as a unit, so the service owns the transaction and passes its
 * client down.
 */
import type { PoolClient } from 'pg';
import { query } from '../config/db';
import { offsetFor, resolveSortColumn, resolveSortDirection } from '../utils/pagination';
import { likeContains } from '../utils/sql';
import type { ChallanStatus } from '../types/domain';
import type { ListChallansQuery } from '../validators/challan.validator';

export interface UserRef {
  id: number;
  name: string;
}

export interface ChallanCustomer {
  id: number;
  name: string;
  businessName: string;
  mobile: string;
  gstNumber: string | null;
}

/** A line item. The snapshot fields are frozen copies, not joins. */
export interface ChallanItem {
  id: number;
  productId: number;
  /** Snapshot — the product's name at the moment of sale. */
  productName: string;
  /** Snapshot — the SKU at the moment of sale. */
  productSku: string;
  /** Snapshot — the unit price at the moment of sale. */
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  /** Live stock, joined in for the UI only. Never part of the snapshot. */
  availableStock?: number;
}

export interface ChallanSummary {
  id: number;
  challanNumber: string;
  customer: ChallanCustomer;
  status: ChallanStatus;
  totalQuantity: number;
  totalAmount: string;
  notes: string | null;
  itemCount: number;
  createdBy: UserRef | null;
  confirmedBy: UserRef | null;
  cancelledBy: UserRef | null;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
}

export interface Challan extends ChallanSummary {
  items: ChallanItem[];
}

interface ChallanRow {
  id: string;
  challan_number: string;
  status: ChallanStatus;
  total_quantity: number;
  total_amount: string;
  notes: string | null;
  item_count: string;
  customer_id: string;
  customer_name: string;
  customer_business_name: string;
  customer_mobile: string;
  customer_gst_number: string | null;
  created_by: string | null;
  created_by_name: string | null;
  confirmed_by: string | null;
  confirmed_by_name: string | null;
  cancelled_by: string | null;
  cancelled_by_name: string | null;
  created_at: Date;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
  updated_at: Date;
}

interface ItemRow {
  id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  unit_price: string;
  quantity: number;
  line_total: string;
  available_stock: number | null;
}

const SORT_COLUMNS = {
  createdAt: 'ch.created_at',
  challanNumber: 'ch.challan_number',
  totalAmount: 'ch.total_amount',
  status: 'ch.status',
} as const;

const SELECT_COLUMNS = `
  ch.id, ch.challan_number, ch.status, ch.total_quantity, ch.total_amount, ch.notes,
  (SELECT count(*) FROM sales_challan_items i WHERE i.challan_id = ch.id) AS item_count,
  ch.customer_id, cu.name AS customer_name, cu.business_name AS customer_business_name,
  cu.mobile AS customer_mobile, cu.gst_number AS customer_gst_number,
  ch.created_by,   cb.name AS created_by_name,
  ch.confirmed_by, fb.name AS confirmed_by_name,
  ch.cancelled_by, xb.name AS cancelled_by_name,
  ch.created_at, ch.confirmed_at, ch.cancelled_at, ch.updated_at
`;

const FROM_CLAUSE = `
  FROM sales_challans ch
  JOIN customers cu ON cu.id = ch.customer_id
  LEFT JOIN users cb ON cb.id = ch.created_by
  LEFT JOIN users fb ON fb.id = ch.confirmed_by
  LEFT JOIN users xb ON xb.id = ch.cancelled_by
`;

function userRef(id: string | null, name: string | null): UserRef | null {
  return id && name ? { id: Number(id), name } : null;
}

function toSummary(row: ChallanRow): ChallanSummary {
  return {
    id: Number(row.id),
    challanNumber: row.challan_number,
    customer: {
      id: Number(row.customer_id),
      name: row.customer_name,
      businessName: row.customer_business_name,
      mobile: row.customer_mobile,
      gstNumber: row.customer_gst_number,
    },
    status: row.status,
    totalQuantity: row.total_quantity,
    totalAmount: row.total_amount,
    notes: row.notes,
    itemCount: Number(row.item_count),
    createdBy: userRef(row.created_by, row.created_by_name),
    confirmedBy: userRef(row.confirmed_by, row.confirmed_by_name),
    cancelledBy: userRef(row.cancelled_by, row.cancelled_by_name),
    createdAt: row.created_at.toISOString(),
    confirmedAt: row.confirmed_at ? row.confirmed_at.toISOString() : null,
    cancelledAt: row.cancelled_at ? row.cancelled_at.toISOString() : null,
    updatedAt: row.updated_at.toISOString(),
  };
}

function toItem(row: ItemRow): ChallanItem {
  const item: ChallanItem = {
    id: Number(row.id),
    productId: Number(row.product_id),
    productName: row.product_name,
    productSku: row.product_sku,
    unitPrice: row.unit_price,
    quantity: row.quantity,
    lineTotal: row.line_total,
  };

  if (row.available_stock !== null) item.availableStock = row.available_stock;

  return item;
}

function buildFilters(filters: ListChallansQuery): { where: string; params: unknown[] } {
  const conditions: string[] = ['TRUE'];
  const params: unknown[] = [];

  if (filters.search) {
    params.push(likeContains(filters.search));
    const p = `$${params.length}`;
    conditions.push(
      `(lower(ch.challan_number) LIKE ${p} OR lower(cu.business_name) LIKE ${p} OR lower(cu.name) LIKE ${p})`,
    );
  }

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`ch.status = $${params.length}`);
  }

  if (filters.customerId) {
    params.push(filters.customerId);
    conditions.push(`ch.customer_id = $${params.length}`);
  }

  if (filters.createdBy) {
    params.push(filters.createdBy);
    conditions.push(`ch.created_by = $${params.length}`);
  }

  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`ch.created_at >= $${params.length}::date`);
  }

  if (filters.dateTo) {
    // +1 day so anything recorded during the end date is included.
    params.push(filters.dateTo);
    conditions.push(`ch.created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  return { where: conditions.join(' AND '), params };
}

export async function findAll(
  filters: ListChallansQuery,
): Promise<{ challans: ChallanSummary[]; total: number }> {
  const { where, params } = buildFilters(filters);

  const countResult = await query<{ total: string }>(
    `SELECT count(*) AS total
       FROM sales_challans ch
       JOIN customers cu ON cu.id = ch.customer_id
      WHERE ${where}`,
    params,
  );
  const total = Number(countResult.rows[0]?.total ?? 0);

  const sortColumn = resolveSortColumn(SORT_COLUMNS, filters.sortBy, 'createdAt');
  const sortDirection = resolveSortDirection(filters.sortOrder);

  const result = await query<ChallanRow>(
    `SELECT ${SELECT_COLUMNS} ${FROM_CLAUSE}
      WHERE ${where}
      ORDER BY ${sortColumn} ${sortDirection}, ch.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, offsetFor(filters.page, filters.limit)],
  );

  return { challans: result.rows.map(toSummary), total };
}

/**
 * Loads a challan with its line items.
 *
 * `available_stock` is joined from the live product row for the UI, so a draft
 * can warn before confirmation. It is presentation data only — the snapshot
 * columns are what the document is made of.
 */
export async function findById(id: number): Promise<Challan | null> {
  const headerResult = await query<ChallanRow>(
    `SELECT ${SELECT_COLUMNS} ${FROM_CLAUSE} WHERE ch.id = $1`,
    [id],
  );

  const headerRow = headerResult.rows[0];
  if (!headerRow) return null;

  const itemsResult = await query<ItemRow>(
    `SELECT i.id, i.product_id, i.product_name, i.product_sku, i.unit_price,
            i.quantity, i.line_total, p.current_stock AS available_stock
       FROM sales_challan_items i
       LEFT JOIN products p ON p.id = i.product_id
      WHERE i.challan_id = $1
      ORDER BY i.id`,
    [id],
  );

  return { ...toSummary(headerRow), items: itemsResult.rows.map(toItem) };
}

/** Minimal locked view used during confirmation and cancellation. */
export interface LockedChallan {
  id: number;
  challanNumber: string;
  status: ChallanStatus;
}

export async function lockById(
  client: PoolClient,
  id: number,
): Promise<LockedChallan | null> {
  const result = await client.query<{ id: string; challan_number: string; status: ChallanStatus }>(
    'SELECT id, challan_number, status FROM sales_challans WHERE id = $1 FOR UPDATE',
    [id],
  );

  const row = result.rows[0];
  if (!row) return null;

  return { id: Number(row.id), challanNumber: row.challan_number, status: row.status };
}

/**
 * Generates the next challan number.
 *
 * `nextval` is atomic and never blocks, so two users creating a challan at the
 * same instant always receive different numbers. A `SELECT max(...) + 1` would
 * race and produce duplicates under exactly the load where it matters.
 */
export async function nextChallanNumber(client: PoolClient): Promise<string> {
  const result = await client.query<{ challan_number: string }>(
    `SELECT 'CH-' || to_char(now(), 'YYYY') || '-' ||
            lpad(nextval('challan_number_seq')::text, 6, '0') AS challan_number`,
  );

  const number = result.rows[0]?.challan_number;
  if (!number) throw new Error('Failed to generate a challan number');

  return number;
}

export async function insertChallan(
  client: PoolClient,
  challanNumber: string,
  customerId: number,
  notes: string | null,
  createdBy: number,
): Promise<number> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO sales_challans (challan_number, customer_id, notes, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [challanNumber, customerId, notes, createdBy],
  );

  return Number(result.rows[0]?.id);
}

export interface NewChallanItem {
  productId: number;
  productName: string;
  productSku: string;
  unitPrice: string;
  quantity: number;
}

/** Replaces every line item. Used by create and by editing a draft. */
export async function replaceItems(
  client: PoolClient,
  challanId: number,
  items: NewChallanItem[],
): Promise<void> {
  await client.query('DELETE FROM sales_challan_items WHERE challan_id = $1', [challanId]);

  for (const item of items) {
    await client.query(
      `INSERT INTO sales_challan_items
         (challan_id, product_id, product_name, product_sku, unit_price, quantity)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [challanId, item.productId, item.productName, item.productSku, item.unitPrice, item.quantity],
    );
  }
}

/**
 * Recomputes the stored totals from the line items.
 *
 * Derived in SQL from the rows themselves rather than from numbers the service
 * carries around, so the header can never disagree with its own lines.
 */
export async function recalculateTotals(client: PoolClient, challanId: number): Promise<void> {
  await client.query(
    `UPDATE sales_challans ch
        SET total_quantity = COALESCE(t.qty, 0),
            total_amount   = COALESCE(t.amount, 0)
       FROM (SELECT COALESCE(SUM(quantity), 0) AS qty,
                    COALESCE(SUM(line_total), 0) AS amount
               FROM sales_challan_items WHERE challan_id = $1) t
      WHERE ch.id = $1`,
    [challanId],
  );
}

export async function updateHeader(
  client: PoolClient,
  challanId: number,
  customerId: number,
  notes: string | null,
): Promise<void> {
  await client.query(
    'UPDATE sales_challans SET customer_id = $2, notes = $3 WHERE id = $1',
    [challanId, customerId, notes],
  );
}

/** Refreshes one line's snapshot from the live product, at confirmation time. */
export async function refreshItemSnapshot(
  client: PoolClient,
  itemId: number,
  productName: string,
  productSku: string,
  unitPrice: string,
): Promise<void> {
  await client.query(
    `UPDATE sales_challan_items
        SET product_name = $2, product_sku = $3, unit_price = $4
      WHERE id = $1`,
    [itemId, productName, productSku, unitPrice],
  );
}

export interface ItemForConfirmation {
  id: number;
  productId: number;
  quantity: number;
}

export async function findItemsForConfirmation(
  client: PoolClient,
  challanId: number,
): Promise<ItemForConfirmation[]> {
  const result = await client.query<{ id: string; product_id: string; quantity: number }>(
    'SELECT id, product_id, quantity FROM sales_challan_items WHERE challan_id = $1 ORDER BY id',
    [challanId],
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    productId: Number(row.product_id),
    quantity: row.quantity,
  }));
}

export async function markConfirmed(
  client: PoolClient,
  challanId: number,
  userId: number,
): Promise<void> {
  await client.query(
    `UPDATE sales_challans
        SET status = 'CONFIRMED', confirmed_by = $2, confirmed_at = now()
      WHERE id = $1`,
    [challanId, userId],
  );
}

export async function markCancelled(
  client: PoolClient,
  challanId: number,
  userId: number,
  reason: string | null,
): Promise<void> {
  await client.query(
    `UPDATE sales_challans
        SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = now(),
            notes = CASE WHEN $3::text IS NULL THEN notes
                         ELSE COALESCE(notes || E'\\n\\n', '') || 'Cancelled: ' || $3
                    END
      WHERE id = $1`,
    [challanId, userId, reason],
  );
}

/** Challans raised for one customer. */
export async function findByCustomer(
  customerId: number,
  page: number,
  limit: number,
): Promise<{ challans: ChallanSummary[]; total: number }> {
  const countResult = await query<{ total: string }>(
    'SELECT count(*) AS total FROM sales_challans WHERE customer_id = $1',
    [customerId],
  );
  const total = Number(countResult.rows[0]?.total ?? 0);

  const result = await query<ChallanRow>(
    `SELECT ${SELECT_COLUMNS} ${FROM_CLAUSE}
      WHERE ch.customer_id = $1
      ORDER BY ch.created_at DESC, ch.id DESC
      LIMIT $2 OFFSET $3`,
    [customerId, limit, offsetFor(page, limit)],
  );

  return { challans: result.rows.map(toSummary), total };
}
