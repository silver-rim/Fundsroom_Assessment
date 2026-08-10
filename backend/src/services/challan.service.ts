/**
 * Sales challan business rules.
 *
 * The three rules that define this module:
 *
 *   1. A DRAFT never touches stock. It is a proposal, freely editable.
 *   2. CONFIRMING deducts stock for every line ATOMICALLY — all of them or none
 *      — and writes one OUT movement per line.
 *   3. Line items carry a SNAPSHOT of the product (name, SKU, unit price), so a
 *      later rename or price change cannot rewrite a document that has already
 *      been dispatched.
 */
import { withTransaction } from '../config/db';
import type { PoolClient } from 'pg';
import * as challanRepository from '../repositories/challan.repository';
import * as customerRepository from '../repositories/customer.repository';
import * as productRepository from '../repositories/product.repository';
import * as stockMovementRepository from '../repositories/stockMovement.repository';
import type { Challan, ChallanSummary, NewChallanItem } from '../repositories/challan.repository';
import type { LockedProduct } from '../repositories/product.repository';
import { ConflictError, ERROR_CODES, NotFoundError } from '../utils/AppError';
import type { ErrorDetail } from '../utils/AppError';
import { buildPaginationMeta } from '../utils/pagination';
import type { PaginationMeta } from '../utils/httpResponse';
import type {
  CreateChallanInput,
  ListChallansQuery,
  UpdateChallanInput,
} from '../validators/challan.validator';

export interface PaginatedChallans {
  challans: ChallanSummary[];
  pagination: PaginationMeta;
}

interface RequestedItem {
  productId: number;
  quantity: number;
}

export async function listChallans(filters: ListChallansQuery): Promise<PaginatedChallans> {
  const { challans, total } = await challanRepository.findAll(filters);

  return {
    challans,
    pagination: buildPaginationMeta(filters.page, filters.limit, total),
  };
}

export async function getChallan(id: number): Promise<Challan> {
  const challan = await challanRepository.findById(id);
  if (!challan) throw new NotFoundError('Challan');
  return challan;
}

export async function listCustomerChallans(
  customerId: number,
  page: number,
  limit: number,
): Promise<PaginatedChallans> {
  const customer = await customerRepository.findById(customerId);
  if (!customer) throw new NotFoundError('Customer');

  const { challans, total } = await challanRepository.findByCustomer(customerId, page, limit);

  return { challans, pagination: buildPaginationMeta(page, limit, total) };
}

/**
 * Validates the customer a challan is being raised for.
 *
 * A soft-deleted customer is a 404 — it no longer exists as far as the API is
 * concerned. An INACTIVE customer is a 409: the record exists, but the business
 * has marked the account dormant and goods should not be dispatched to it.
 * A LEAD is allowed: a first order is exactly how a lead becomes a customer.
 */
async function assertCustomerUsable(customerId: number): Promise<void> {
  const customer = await customerRepository.findById(customerId);

  if (!customer) throw new NotFoundError('Customer');

  if (customer.status === 'INACTIVE') {
    throw new ConflictError(
      `${customer.businessName} is marked inactive. Reactivate the customer before raising a challan.`,
      ERROR_CODES.INVALID_STATE,
      [{ field: 'body.customerId', message: 'This customer is inactive' }],
    );
  }
}

/**
 * Turns requested {productId, quantity} pairs into snapshot-bearing line items.
 *
 * Prices and names come from the products table — never from the request — so a
 * caller cannot decide what something sold for. Missing or deactivated products
 * are reported together rather than one per round trip.
 */
async function buildItemsWithSnapshots(
  client: PoolClient,
  requested: RequestedItem[],
): Promise<NewChallanItem[]> {
  const productIds = requested.map((item) => item.productId);
  const products = await productRepository.lockByIds(client, productIds);
  const productById = new Map(products.map((product) => [product.id, product]));

  const problems: ErrorDetail[] = [];

  requested.forEach((item, index) => {
    const product = productById.get(item.productId);

    if (!product) {
      problems.push({
        field: `body.items[${index}].productId`,
        message: `Product ${item.productId} does not exist`,
      });
      return;
    }

    if (!product.isActive) {
      problems.push({
        field: `body.items[${index}].productId`,
        message: `${product.name} is deactivated and cannot be sold`,
      });
    }
  });

  if (problems.length > 0) {
    throw new ConflictError(
      'One or more products on this challan cannot be used.',
      ERROR_CODES.INVALID_STATE,
      problems,
    );
  }

  return requested.map((item) => {
    const product = productById.get(item.productId) as LockedProduct;

    return {
      productId: product.id,
      productName: product.name, // snapshot
      productSku: product.sku, // snapshot
      unitPrice: product.unitPrice, // snapshot
      quantity: item.quantity,
    };
  });
}

/**
 * Deducts stock for every line and writes the ledger entries.
 *
 * Called only from inside a transaction that already holds locks on the product
 * rows. The sequence is deliberate:
 *
 *   1. Check EVERY line first and collect ALL shortfalls.
 *   2. Only if none failed, apply the deductions.
 *
 * Checking-then-applying line by line would leave the first few products
 * decremented when the fourth one fails. Because everything runs in one
 * transaction the rollback would undo that anyway — but collecting all the
 * failures first also means the user is told about every problem at once
 * instead of discovering them one confirmation attempt at a time.
 */
async function deductStockForChallan(
  client: PoolClient,
  challanId: number,
  userId: number,
  challanNumber: string,
): Promise<void> {
  const items = await challanRepository.findItemsForConfirmation(client, challanId);

  if (items.length === 0) {
    throw new ConflictError(
      'This challan has no products. Add at least one before confirming.',
      ERROR_CODES.INVALID_STATE,
    );
  }

  // Locked in ascending id order (see productRepository.lockByIds), so two
  // concurrent confirmations acquire the same rows in the same sequence and
  // cannot deadlock by grabbing them in opposite orders.
  const products = await productRepository.lockByIds(
    client,
    items.map((item) => item.productId),
  );
  const productById = new Map(products.map((product) => [product.id, product]));

  // ---- Pass 1: verify every line -------------------------------------------
  const shortfalls: ErrorDetail[] = [];
  let firstShortfallMessage = '';

  items.forEach((item, index) => {
    const product = productById.get(item.productId);

    if (!product) {
      shortfalls.push({
        field: `items[${index}].productId`,
        message: `Product ${item.productId} no longer exists`,
      });
      return;
    }

    if (product.currentStock < item.quantity) {
      const message = `Insufficient stock for ${product.name}. Available: ${product.currentStock}, Requested: ${item.quantity}.`;
      if (!firstShortfallMessage) firstShortfallMessage = message;

      shortfalls.push({
        field: `items[${index}].quantity`,
        message: `${product.name} (${product.sku}) — available ${product.currentStock}, requested ${item.quantity}`,
      });
    }
  });

  if (shortfalls.length > 0) {
    // Throwing rolls the whole transaction back: no stock moved, no movement
    // rows written, the challan stays a DRAFT.
    throw new ConflictError(
      firstShortfallMessage || 'One or more products on this challan are unavailable.',
      ERROR_CODES.INSUFFICIENT_STOCK,
      shortfalls,
    );
  }

  // ---- Pass 2: apply ---------------------------------------------------------
  for (const item of items) {
    const product = productById.get(item.productId) as LockedProduct;
    const newBalance = product.currentStock - item.quantity;

    await productRepository.setStock(client, product.id, newBalance);

    await stockMovementRepository.insert(client, {
      productId: product.id,
      movementType: 'OUT',
      quantity: item.quantity,
      reason: `Sales challan ${challanNumber}`,
      balanceAfter: newBalance,
      referenceType: 'SALES_CHALLAN',
      referenceId: challanId,
      createdBy: userId,
    });

    // Refresh the snapshot from the row we just locked, so the document records
    // the name and price as they were at the moment of sale — which is the
    // moment of confirmation, not the moment the draft was typed.
    await challanRepository.refreshItemSnapshot(
      client,
      item.id,
      product.name,
      product.sku,
      product.unitPrice,
    );
  }

  await challanRepository.recalculateTotals(client, challanId);
}

/**
 * Creates a challan, optionally confirming it in the same transaction.
 *
 * With `confirmImmediately`, an insufficient-stock failure rolls back the
 * creation too — the user does not end up with a half-finished draft they did
 * not ask for.
 */
export async function createChallan(
  input: CreateChallanInput,
  userId: number,
): Promise<Challan> {
  await assertCustomerUsable(input.customerId);

  const challanId = await withTransaction(async (client) => {
    const items = await buildItemsWithSnapshots(client, input.items);

    const challanNumber = await challanRepository.nextChallanNumber(client);
    const id = await challanRepository.insertChallan(
      client,
      challanNumber,
      input.customerId,
      input.notes ?? null,
      userId,
    );

    await challanRepository.replaceItems(client, id, items);
    await challanRepository.recalculateTotals(client, id);

    if (input.confirmImmediately) {
      await deductStockForChallan(client, id, userId, challanNumber);
      await challanRepository.markConfirmed(client, id, userId);
    }

    return id;
  });

  return getChallan(challanId);
}

/** Replaces a draft's customer, items and notes. Only legal while DRAFT. */
export async function updateChallan(
  id: number,
  input: UpdateChallanInput,
): Promise<Challan> {
  await assertCustomerUsable(input.customerId);

  await withTransaction(async (client) => {
    const existing = await challanRepository.lockById(client, id);
    if (!existing) throw new NotFoundError('Challan');

    if (existing.status !== 'DRAFT') {
      throw new ConflictError(
        `Challan ${existing.challanNumber} is ${existing.status.toLowerCase()} and can no longer be edited.`,
        ERROR_CODES.INVALID_STATE,
      );
    }

    const items = await buildItemsWithSnapshots(client, input.items);

    await challanRepository.updateHeader(client, id, input.customerId, input.notes ?? null);
    await challanRepository.replaceItems(client, id, items);
    await challanRepository.recalculateTotals(client, id);
  });

  return getChallan(id);
}

/**
 * DRAFT → CONFIRMED. The critical operation.
 *
 * Everything below happens in ONE transaction: the challan row is locked, every
 * product row is locked, all lines are verified, then stock is deducted, ledger
 * rows are written, snapshots are refreshed and the status is set. Any failure
 * anywhere rolls back the lot.
 */
export async function confirmChallan(id: number, userId: number): Promise<Challan> {
  await withTransaction(async (client) => {
    const challan = await challanRepository.lockById(client, id);
    if (!challan) throw new NotFoundError('Challan');

    if (challan.status !== 'DRAFT') {
      throw new ConflictError(
        challan.status === 'CONFIRMED'
          ? `Challan ${challan.challanNumber} has already been confirmed.`
          : `Challan ${challan.challanNumber} was cancelled and cannot be confirmed.`,
        ERROR_CODES.INVALID_STATE,
      );
    }

    await deductStockForChallan(client, id, userId, challan.challanNumber);
    await challanRepository.markConfirmed(client, id, userId);
  });

  return getChallan(id);
}

/**
 * DRAFT → CANCELLED. No stock is touched, because a draft never reserved any.
 *
 * A CONFIRMED challan cannot be cancelled (assumption A9): the goods have
 * already left, so reversing it means putting stock back, which is a returns
 * flow with its own IN movements and its own paperwork. Silently adding stock
 * back here would let anyone inflate inventory by confirming and cancelling.
 */
export async function cancelChallan(
  id: number,
  userId: number,
  reason: string | null,
): Promise<Challan> {
  await withTransaction(async (client) => {
    const challan = await challanRepository.lockById(client, id);
    if (!challan) throw new NotFoundError('Challan');

    if (challan.status === 'CANCELLED') {
      throw new ConflictError(
        `Challan ${challan.challanNumber} is already cancelled.`,
        ERROR_CODES.INVALID_STATE,
      );
    }

    if (challan.status === 'CONFIRMED') {
      throw new ConflictError(
        `Challan ${challan.challanNumber} is confirmed and its stock has already been dispatched. ` +
          'Record a stock return instead of cancelling.',
        ERROR_CODES.INVALID_STATE,
      );
    }

    await challanRepository.markCancelled(client, id, userId, reason);
  });

  return getChallan(id);
}
