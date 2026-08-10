/**
 * All SQL touching `stock_movements`.
 *
 * The table is append-only: there is no update and no delete here, by design.
 * A correction is a new movement in the opposite direction with its own reason,
 * which keeps the ledger a truthful record of what actually happened.
 */
import type { PoolClient } from 'pg';
import { query } from '../config/db';
import { offsetFor } from '../utils/pagination';
import type { MovementReferenceType, MovementType } from '../types/domain';
import type { ListStockMovementsQuery } from '../validators/product.validator';

export interface StockMovement {
  id: number;
  productId: number;
  productName: string;
  productSku: string;
  movementType: MovementType;
  quantity: number;
  reason: string;
  /** Stock level immediately after this movement — the ledger's running balance. */
  balanceAfter: number;
  referenceType: MovementReferenceType;
  referenceId: number | null;
  createdBy: { id: number; name: string } | null;
  createdAt: string;
}

interface MovementRow {
  id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  movement_type: MovementType;
  quantity: number;
  reason: string;
  balance_after: number;
  reference_type: MovementReferenceType;
  reference_id: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
}

const SELECT_COLUMNS = `
  m.id, m.product_id, p.name AS product_name, p.sku AS product_sku,
  m.movement_type, m.quantity, m.reason, m.balance_after,
  m.reference_type, m.reference_id,
  m.created_by, u.name AS created_by_name, m.created_at
`;

function toMovement(row: MovementRow): StockMovement {
  return {
    id: Number(row.id),
    productId: Number(row.product_id),
    productName: row.product_name,
    productSku: row.product_sku,
    movementType: row.movement_type,
    quantity: row.quantity,
    reason: row.reason,
    balanceAfter: row.balance_after,
    referenceType: row.reference_type,
    referenceId: row.reference_id === null ? null : Number(row.reference_id),
    createdBy:
      row.created_by && row.created_by_name
        ? { id: Number(row.created_by), name: row.created_by_name }
        : null,
    createdAt: row.created_at.toISOString(),
  };
}

function buildFilters(filters: ListStockMovementsQuery): { where: string; params: unknown[] } {
  const conditions: string[] = ['TRUE'];
  const params: unknown[] = [];

  if (filters.productId) {
    params.push(filters.productId);
    conditions.push(`m.product_id = $${params.length}`);
  }

  if (filters.movementType) {
    params.push(filters.movementType);
    conditions.push(`m.movement_type = $${params.length}`);
  }

  if (filters.referenceType) {
    params.push(filters.referenceType);
    conditions.push(`m.reference_type = $${params.length}`);
  }

  if (filters.createdBy) {
    params.push(filters.createdBy);
    conditions.push(`m.created_by = $${params.length}`);
  }

  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`m.created_at >= $${params.length}::date`);
  }

  if (filters.dateTo) {
    // +1 day so the upper bound includes everything that happened ON dateTo,
    // not just the instant of its midnight.
    params.push(filters.dateTo);
    conditions.push(`m.created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  return { where: conditions.join(' AND '), params };
}

export async function findAll(
  filters: ListStockMovementsQuery,
): Promise<{ movements: StockMovement[]; total: number }> {
  const { where, params } = buildFilters(filters);

  const countResult = await query<{ total: string }>(
    `SELECT count(*) AS total
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
      WHERE ${where}`,
    params,
  );
  const total = Number(countResult.rows[0]?.total ?? 0);

  const result = await query<MovementRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
       LEFT JOIN users u ON u.id = m.created_by
      WHERE ${where}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, offsetFor(filters.page, filters.limit)],
  );

  return { movements: result.rows.map(toMovement), total };
}

export async function findById(id: number): Promise<StockMovement | null> {
  const result = await query<MovementRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
       LEFT JOIN users u ON u.id = m.created_by
      WHERE m.id = $1`,
    [id],
  );

  const row = result.rows[0];
  return row ? toMovement(row) : null;
}

export interface NewMovement {
  productId: number;
  movementType: MovementType;
  quantity: number;
  reason: string;
  balanceAfter: number;
  referenceType: MovementReferenceType;
  referenceId: number | null;
  createdBy: number;
}

/** Appends one movement. Always called inside the caller's transaction. */
export async function insert(client: PoolClient, movement: NewMovement): Promise<number> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO stock_movements
       (product_id, movement_type, quantity, reason, balance_after,
        reference_type, reference_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      movement.productId,
      movement.movementType,
      movement.quantity,
      movement.reason,
      movement.balanceAfter,
      movement.referenceType,
      movement.referenceId,
      movement.createdBy,
    ],
  );

  return Number(result.rows[0]?.id);
}
