/**
 * Stock movement business rules.
 *
 * This module owns the single most important guarantee in the system:
 *
 *     stock can never go negative, and products.current_stock always equals
 *     the sum of its movements.
 *
 * Both are upheld by doing the read, the check, the write and the ledger entry
 * inside ONE transaction, with the product row locked for its duration.
 */
import { withTransaction } from '../config/db';
import * as productRepository from '../repositories/product.repository';
import * as stockMovementRepository from '../repositories/stockMovement.repository';
import type { StockMovement } from '../repositories/stockMovement.repository';
import { ConflictError, ERROR_CODES, NotFoundError } from '../utils/AppError';
import { buildPaginationMeta } from '../utils/pagination';
import type { PaginationMeta } from '../utils/httpResponse';
import type {
  CreateStockMovementInput,
  ListStockMovementsQuery,
} from '../validators/product.validator';

export interface PaginatedMovements {
  movements: StockMovement[];
  pagination: PaginationMeta;
}

export async function listMovements(
  filters: ListStockMovementsQuery,
): Promise<PaginatedMovements> {
  const { movements, total } = await stockMovementRepository.findAll(filters);

  return {
    movements,
    pagination: buildPaginationMeta(filters.page, filters.limit, total),
  };
}

/**
 * Records a manual IN or OUT movement.
 *
 * The sequence inside the transaction matters:
 *
 *   1. SELECT … FOR UPDATE — takes a row lock on the product. Any other
 *      transaction touching the same product now waits here.
 *   2. Compute the new balance from the value just read under that lock.
 *   3. Reject an OUT that would go below zero, with a message naming the real
 *      numbers so the user knows what to do about it.
 *   4. Write the new stock and append the ledger row together.
 *
 * Without the lock, two simultaneous OUT movements could both read stock = 5,
 * both conclude that removing 4 is fine, and leave the product at -3. The lock
 * serialises them, so the second one reads 1 and is correctly refused.
 *
 * The CHECK (current_stock >= 0) constraint remains the backstop: if this logic
 * were ever wrong, the transaction aborts rather than persisting bad stock.
 */
export async function recordMovement(
  input: CreateStockMovementInput,
  createdBy: number,
): Promise<StockMovement> {
  const movementId = await withTransaction(async (client) => {
    const product = await productRepository.lockById(client, input.productId);

    if (!product) throw new NotFoundError('Product');

    const newBalance =
      input.movementType === 'IN'
        ? product.currentStock + input.quantity
        : product.currentStock - input.quantity;

    if (newBalance < 0) {
      throw new ConflictError(
        `Insufficient stock for ${product.name}. Available: ${product.currentStock}, Requested: ${input.quantity}.`,
        ERROR_CODES.INSUFFICIENT_STOCK,
        [
          {
            field: 'body.quantity',
            message: `Only ${product.currentStock} in stock`,
          },
        ],
      );
    }

    await productRepository.setStock(client, product.id, newBalance);

    return stockMovementRepository.insert(client, {
      productId: product.id,
      movementType: input.movementType,
      quantity: input.quantity,
      reason: input.reason,
      balanceAfter: newBalance,
      referenceType: 'MANUAL',
      referenceId: null,
      createdBy,
    });
  });

  const movement = await stockMovementRepository.findById(movementId);
  if (!movement) throw new NotFoundError('Stock movement');

  return movement;
}
