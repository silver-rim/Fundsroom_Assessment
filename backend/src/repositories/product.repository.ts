/**
 * All SQL touching `products`.
 *
 * `current_stock` is never written by this module's create/update paths — it
 * moves only through `adjustStock`, which the stock-movement service calls
 * inside a transaction after locking the row. That is what keeps the products
 * table and the movement ledger in agreement.
 */
import type { PoolClient } from 'pg';
import { query } from '../config/db';
import { offsetFor, resolveSortColumn, resolveSortDirection } from '../utils/pagination';
import { likeContains } from '../utils/sql';
import type {
  CreateProductInput,
  ListProductsQuery,
  UpdateProductInput,
} from '../validators/product.validator';

export interface ProductCreatedBy {
  id: number;
  name: string;
}

export interface Product {
  id: number;
  name: string;
  sku: string;
  category: string;
  /** Decimal string — never a float. */
  unitPrice: string;
  currentStock: number;
  minStockAlert: number;
  location: string;
  isActive: boolean;
  /** Derived in SQL: current_stock <= min_stock_alert. Never stored. */
  isLowStock: boolean;
  createdBy: ProductCreatedBy | null;
  createdAt: string;
  updatedAt: string;
}

/** Minimal shape returned by the locking read used during stock changes. */
export interface LockedProduct {
  id: number;
  name: string;
  sku: string;
  unitPrice: string;
  currentStock: number;
  isActive: boolean;
}

interface ProductRow {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit_price: string;
  current_stock: number;
  min_stock_alert: number;
  location: string;
  is_active: boolean;
  is_low_stock: boolean;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
  updated_at: Date;
}

const SORT_COLUMNS = {
  createdAt: 'p.created_at',
  name: 'lower(p.name)',
  sku: 'p.sku',
  category: 'lower(p.category)',
  unitPrice: 'p.unit_price',
  currentStock: 'p.current_stock',
} as const;

const SELECT_COLUMNS = `
  p.id, p.name, p.sku, p.category, p.unit_price, p.current_stock,
  p.min_stock_alert, p.location, p.is_active,
  (p.current_stock <= p.min_stock_alert) AS is_low_stock,
  p.created_by, u.name AS created_by_name, p.created_at, p.updated_at
`;

function toProduct(row: ProductRow): Product {
  return {
    id: Number(row.id),
    name: row.name,
    sku: row.sku,
    category: row.category,
    unitPrice: row.unit_price,
    currentStock: row.current_stock,
    minStockAlert: row.min_stock_alert,
    location: row.location,
    isActive: row.is_active,
    isLowStock: row.is_low_stock,
    createdBy:
      row.created_by && row.created_by_name
        ? { id: Number(row.created_by), name: row.created_by_name }
        : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function buildFilters(filters: ListProductsQuery): { where: string; params: unknown[] } {
  const conditions: string[] = ['TRUE'];
  const params: unknown[] = [];

  if (filters.search) {
    params.push(likeContains(filters.search));
    const p = `$${params.length}`;
    conditions.push(
      `(lower(p.name) LIKE ${p} OR lower(p.sku) LIKE ${p} OR lower(p.category) LIKE ${p})`,
    );
  }

  if (filters.category) {
    params.push(filters.category.toLowerCase());
    conditions.push(`lower(p.category) = $${params.length}`);
  }

  if (filters.lowStock) {
    // Compares two columns, so no index can serve it. Acceptable at this scale;
    // noted as a limitation in docs/INVENTORY_MODULE.md.
    conditions.push('p.current_stock <= p.min_stock_alert');
  }

  if (filters.isActive !== 'all') {
    params.push(filters.isActive === 'true');
    conditions.push(`p.is_active = $${params.length}`);
  }

  return { where: conditions.join(' AND '), params };
}

export async function findAll(
  filters: ListProductsQuery,
): Promise<{ products: Product[]; total: number }> {
  const { where, params } = buildFilters(filters);

  const countResult = await query<{ total: string }>(
    `SELECT count(*) AS total FROM products p WHERE ${where}`,
    params,
  );
  const total = Number(countResult.rows[0]?.total ?? 0);

  const sortColumn = resolveSortColumn(SORT_COLUMNS, filters.sortBy, 'createdAt');
  const sortDirection = resolveSortDirection(filters.sortOrder);

  const result = await query<ProductRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM products p
       LEFT JOIN users u ON u.id = p.created_by
      WHERE ${where}
      ORDER BY ${sortColumn} ${sortDirection}, p.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, offsetFor(filters.page, filters.limit)],
  );

  return { products: result.rows.map(toProduct), total };
}

export async function findById(id: number): Promise<Product | null> {
  const result = await query<ProductRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM products p
       LEFT JOIN users u ON u.id = p.created_by
      WHERE p.id = $1`,
    [id],
  );

  const row = result.rows[0];
  return row ? toProduct(row) : null;
}

export async function skuExists(sku: string, excludeId?: number): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM products WHERE sku = $1 AND ($2::bigint IS NULL OR id <> $2)
     ) AS exists`,
    [sku, excludeId ?? null],
  );

  return result.rows[0]?.exists ?? false;
}

/** All distinct categories, for the filter dropdown. */
export async function findCategories(): Promise<string[]> {
  const result = await query<{ category: string }>(
    'SELECT DISTINCT category FROM products ORDER BY category',
  );
  return result.rows.map((row) => row.category);
}

/**
 * Inserts a product with zero stock.
 *
 * Opening stock is deliberately NOT set here. The service adds it through a
 * stock movement in the same transaction, so stock never appears from nowhere
 * and the ledger balances from the product's first moment.
 */
export async function create(
  client: PoolClient,
  input: CreateProductInput,
  createdBy: number,
): Promise<number> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO products (name, sku, category, unit_price, min_stock_alert, location, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      input.name,
      input.sku,
      input.category,
      input.unitPrice,
      input.minStockAlert,
      input.location,
      createdBy,
    ],
  );

  return Number(result.rows[0]?.id);
}

export async function update(id: number, input: UpdateProductInput): Promise<Product | null> {
  const result = await query(
    `UPDATE products
        SET name = $2, sku = $3, category = $4, unit_price = $5,
            min_stock_alert = $6, location = $7
      WHERE id = $1`,
    [id, input.name, input.sku, input.category, input.unitPrice, input.minStockAlert, input.location],
  );

  if (result.rowCount === 0) return null;
  return findById(id);
}

export async function setActive(id: number, isActive: boolean): Promise<Product | null> {
  const result = await query('UPDATE products SET is_active = $2 WHERE id = $1', [id, isActive]);

  if (result.rowCount === 0) return null;
  return findById(id);
}

/**
 * Reads a product row and holds a row-level lock until the transaction ends.
 *
 * This is what makes the check-then-update in the stock service safe: two
 * simultaneous OUT movements against the same product are serialised, so they
 * cannot both read the same starting balance and each subtract from it.
 */
export async function lockById(client: PoolClient, id: number): Promise<LockedProduct | null> {
  const result = await client.query<{
    id: string;
    name: string;
    sku: string;
    unit_price: string;
    current_stock: number;
    is_active: boolean;
  }>(
    `SELECT id, name, sku, unit_price, current_stock, is_active
       FROM products WHERE id = $1 FOR UPDATE`,
    [id],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: Number(row.id),
    name: row.name,
    sku: row.sku,
    unitPrice: row.unit_price,
    currentStock: row.current_stock,
    isActive: row.is_active,
  };
}

/**
 * Locks several products at once, ordered by id.
 *
 * The consistent ordering matters: two transactions locking the same set in
 * different orders would deadlock. Used by the challan confirmation in Phase 5.
 */
export async function lockByIds(client: PoolClient, ids: number[]): Promise<LockedProduct[]> {
  if (ids.length === 0) return [];

  const result = await client.query<{
    id: string;
    name: string;
    sku: string;
    unit_price: string;
    current_stock: number;
    is_active: boolean;
  }>(
    `SELECT id, name, sku, unit_price, current_stock, is_active
       FROM products WHERE id = ANY($1::bigint[])
      ORDER BY id
        FOR UPDATE`,
    [ids],
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    sku: row.sku,
    unitPrice: row.unit_price,
    currentStock: row.current_stock,
    isActive: row.is_active,
  }));
}

/**
 * Writes a new stock balance. Caller must already hold the row lock and have
 * verified the value is not negative; the CHECK constraint is the backstop.
 */
export async function setStock(
  client: PoolClient,
  id: number,
  newStock: number,
): Promise<void> {
  await client.query('UPDATE products SET current_stock = $2 WHERE id = $1', [id, newStock]);
}
