/**
 * All SQL behind GET /api/dashboard/summary.
 *
 * Every number on the dashboard is an aggregate computed here, at request time.
 * Nothing is cached, denormalised into a counters table, or stored — the numbers
 * cannot drift from the data they describe, which is the whole point of showing
 * them to an operations team.
 *
 * The six statements are independent and are issued in parallel. They are NOT
 * wrapped in one transaction: a shared snapshot would only matter if the numbers
 * were compared against each other arithmetically, and they are not — each tile
 * stands alone. Six short reads on the pool are cheaper than holding a
 * transaction open for the duration.
 */
import { query } from '../config/db';
import type { ChallanStatus, MovementType } from '../types/domain';

export interface CustomerCounters {
  total: number;
  active: number;
  leads: number;
  /** Non-deleted customers whose follow_up_date is today or already past. */
  followUpsDue: number;
}

export interface ProductCounters {
  total: number;
  /** current_stock <= min_stock_alert — the same rule the product list uses. */
  lowStock: number;
  /** current_stock = 0. A subset of lowStock, never a separate population. */
  outOfStock: number;
  inactive: number;
}

export interface ChallanCounters {
  total: number;
  draft: number;
  confirmed: number;
  cancelled: number;
  confirmedThisMonth: number;
  /** Decimal string, like every other money value in the API. */
  valueThisMonth: string;
}

export interface LowStockProduct {
  id: number;
  name: string;
  sku: string;
  currentStock: number;
  minStockAlert: number;
}

export interface RecentChallan {
  id: number;
  challanNumber: string;
  customerName: string;
  status: ChallanStatus;
  totalAmount: string;
  createdAt: string;
}

export interface RecentMovement {
  id: number;
  productId: number;
  productName: string;
  movementType: MovementType;
  quantity: number;
  balanceAfter: number;
  createdAt: string;
}

export interface DashboardSummary {
  customers: CustomerCounters;
  products: ProductCounters;
  challans: ChallanCounters;
  lowStockProducts: LowStockProduct[];
  recentChallans: RecentChallan[];
  recentMovements: RecentMovement[];
}

/** How many rows each "recent" / "needs attention" list carries. */
const LIST_LIMIT = 5;

// count(*) FILTER (WHERE …) computes every counter in ONE table pass instead of
// one query per status. Note the `::int` casts: PostgreSQL returns count() as
// BIGINT, which `pg` hands back as a string to protect precision. These counts
// are far below 2^31, so the cast is safe and keeps the JSON numeric.

async function fetchCustomerCounters(): Promise<CustomerCounters> {
  const result = await query<{
    total: number;
    active: number;
    leads: number;
    follow_ups_due: number;
  }>(
    `SELECT count(*)::int                                             AS total,
            count(*) FILTER (WHERE status = 'ACTIVE')::int            AS active,
            count(*) FILTER (WHERE status = 'LEAD')::int              AS leads,
            count(*) FILTER (WHERE follow_up_date IS NOT NULL
                               AND follow_up_date <= CURRENT_DATE)::int AS follow_ups_due
       FROM customers
      WHERE deleted_at IS NULL`,
  );

  const row = result.rows[0];

  return {
    total: row?.total ?? 0,
    active: row?.active ?? 0,
    leads: row?.leads ?? 0,
    followUpsDue: row?.follow_ups_due ?? 0,
  };
}

async function fetchProductCounters(): Promise<ProductCounters> {
  const result = await query<{
    total: number;
    low_stock: number;
    out_of_stock: number;
    inactive: number;
  }>(
    `SELECT count(*)::int                                                  AS total,
            count(*) FILTER (WHERE is_active
                               AND current_stock <= min_stock_alert)::int  AS low_stock,
            count(*) FILTER (WHERE is_active AND current_stock = 0)::int   AS out_of_stock,
            count(*) FILTER (WHERE NOT is_active)::int                     AS inactive
       FROM products`,
  );

  const row = result.rows[0];

  return {
    total: row?.total ?? 0,
    lowStock: row?.low_stock ?? 0,
    outOfStock: row?.out_of_stock ?? 0,
    inactive: row?.inactive ?? 0,
  };
}

async function fetchChallanCounters(): Promise<ChallanCounters> {
  // "This month" is the calendar month of the database server's clock, matched
  // against confirmed_at rather than created_at: a challan drafted in July and
  // confirmed in August is August's dispatch, because that is when the goods
  // actually left. Cancelled and draft challans contribute nothing to the value.
  const result = await query<{
    total: number;
    draft: number;
    confirmed: number;
    cancelled: number;
    confirmed_this_month: number;
    value_this_month: string;
  }>(
    `SELECT count(*)::int                                        AS total,
            count(*) FILTER (WHERE status = 'DRAFT')::int        AS draft,
            count(*) FILTER (WHERE status = 'CONFIRMED')::int    AS confirmed,
            count(*) FILTER (WHERE status = 'CANCELLED')::int    AS cancelled,
            count(*) FILTER (WHERE status = 'CONFIRMED'
                               AND confirmed_at >= date_trunc('month', now()))::int
                                                                 AS confirmed_this_month,
            -- ::numeric(14,2) before ::text so an empty month reads "0.00" like
            -- every other money value, rather than the bare "0" that COALESCE's
            -- integer literal would otherwise produce.
            COALESCE(sum(total_amount) FILTER (WHERE status = 'CONFIRMED'
                               AND confirmed_at >= date_trunc('month', now())), 0)
              ::numeric(14,2)::text                              AS value_this_month
       FROM sales_challans`,
  );

  const row = result.rows[0];

  return {
    total: row?.total ?? 0,
    draft: row?.draft ?? 0,
    confirmed: row?.confirmed ?? 0,
    cancelled: row?.cancelled ?? 0,
    confirmedThisMonth: row?.confirmed_this_month ?? 0,
    valueThisMonth: row?.value_this_month ?? '0.00',
  };
}

async function fetchLowStockProducts(): Promise<LowStockProduct[]> {
  // Ordered by how far below the threshold each product sits, so the product in
  // the most trouble is first — not merely the one with the smallest number.
  const result = await query<{
    id: string;
    name: string;
    sku: string;
    current_stock: number;
    min_stock_alert: number;
  }>(
    `SELECT id, name, sku, current_stock, min_stock_alert
       FROM products
      WHERE is_active AND current_stock <= min_stock_alert
      ORDER BY (current_stock - min_stock_alert) ASC, current_stock ASC, name ASC
      LIMIT $1`,
    [LIST_LIMIT],
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    sku: row.sku,
    currentStock: row.current_stock,
    minStockAlert: row.min_stock_alert,
  }));
}

async function fetchRecentChallans(): Promise<RecentChallan[]> {
  const result = await query<{
    id: string;
    challan_number: string;
    customer_name: string;
    status: ChallanStatus;
    total_amount: string;
    created_at: Date;
  }>(
    `SELECT c.id, c.challan_number, cu.business_name AS customer_name,
            c.status, c.total_amount, c.created_at
       FROM sales_challans c
       JOIN customers cu ON cu.id = c.customer_id
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT $1`,
    [LIST_LIMIT],
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    challanNumber: row.challan_number,
    customerName: row.customer_name,
    status: row.status,
    totalAmount: row.total_amount,
    createdAt: row.created_at.toISOString(),
  }));
}

async function fetchRecentMovements(): Promise<RecentMovement[]> {
  const result = await query<{
    id: string;
    product_id: string;
    product_name: string;
    movement_type: MovementType;
    quantity: number;
    balance_after: number;
    created_at: Date;
  }>(
    `SELECT m.id, m.product_id, p.name AS product_name,
            m.movement_type, m.quantity, m.balance_after, m.created_at
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $1`,
    [LIST_LIMIT],
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    productId: Number(row.product_id),
    productName: row.product_name,
    movementType: row.movement_type,
    quantity: row.quantity,
    balanceAfter: row.balance_after,
    createdAt: row.created_at.toISOString(),
  }));
}

/** Everything the dashboard needs, in one round of parallel reads. */
export async function fetchSummary(): Promise<DashboardSummary> {
  const [customers, products, challans, lowStockProducts, recentChallans, recentMovements] =
    await Promise.all([
      fetchCustomerCounters(),
      fetchProductCounters(),
      fetchChallanCounters(),
      fetchLowStockProducts(),
      fetchRecentChallans(),
      fetchRecentMovements(),
    ]);

  return { customers, products, challans, lowStockProducts, recentChallans, recentMovements };
}
