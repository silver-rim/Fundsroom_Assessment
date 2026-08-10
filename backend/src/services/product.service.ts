/**
 * Product master business rules.
 */
import { withTransaction } from '../config/db';
import * as productRepository from '../repositories/product.repository';
import * as stockMovementRepository from '../repositories/stockMovement.repository';
import type { Product } from '../repositories/product.repository';
import { ConflictError, ERROR_CODES, NotFoundError } from '../utils/AppError';
import { buildPaginationMeta } from '../utils/pagination';
import type { PaginationMeta } from '../utils/httpResponse';
import type {
  CreateProductInput,
  ListProductsQuery,
  UpdateProductInput,
} from '../validators/product.validator';

export interface PaginatedProducts {
  products: Product[];
  pagination: PaginationMeta;
}

export async function listProducts(filters: ListProductsQuery): Promise<PaginatedProducts> {
  const { products, total } = await productRepository.findAll(filters);

  return {
    products,
    pagination: buildPaginationMeta(filters.page, filters.limit, total),
  };
}

export async function getProduct(id: number): Promise<Product> {
  const product = await productRepository.findById(id);
  if (!product) throw new NotFoundError('Product');
  return product;
}

export async function listCategories(): Promise<string[]> {
  return productRepository.findCategories();
}

/**
 * Creates a product, and its opening stock as a real movement.
 *
 * Both happen in one transaction. If the movement could not be written, the
 * product must not exist either — otherwise the ledger would be missing the
 * stock the product claims to hold, and the two would never reconcile again.
 */
export async function createProduct(
  input: CreateProductInput,
  createdBy: number,
): Promise<Product> {
  if (await productRepository.skuExists(input.sku)) {
    throw new ConflictError(
      'A product with this SKU already exists.',
      ERROR_CODES.DUPLICATE_SKU,
      [{ field: 'body.sku', message: 'This SKU is already in use' }],
    );
  }

  const productId = await withTransaction(async (client) => {
    const id = await productRepository.create(client, input, createdBy);

    if (input.openingStock > 0) {
      await productRepository.setStock(client, id, input.openingStock);
      await stockMovementRepository.insert(client, {
        productId: id,
        movementType: 'IN',
        quantity: input.openingStock,
        reason: 'Opening stock',
        balanceAfter: input.openingStock,
        referenceType: 'MANUAL',
        referenceId: null,
        createdBy,
      });
    }

    return id;
  });

  return getProduct(productId);
}

/**
 * Updates a product's descriptive fields.
 *
 * `currentStock` is not among them — the schema rejects it explicitly. Stock is
 * only ever changed by a movement, so that every change carries a reason, an
 * author and a timestamp.
 */
export async function updateProduct(id: number, input: UpdateProductInput): Promise<Product> {
  const existing = await productRepository.findById(id);
  if (!existing) throw new NotFoundError('Product');

  if (await productRepository.skuExists(input.sku, id)) {
    throw new ConflictError(
      'Another product is already using this SKU.',
      ERROR_CODES.DUPLICATE_SKU,
      [{ field: 'body.sku', message: 'This SKU belongs to another product' }],
    );
  }

  const updated = await productRepository.update(id, input);
  if (!updated) throw new NotFoundError('Product');

  return updated;
}

/**
 * Activates or deactivates a product.
 *
 * Deactivating is the closest thing to deletion the product master offers.
 * A hard delete is impossible in practice: `stock_movements` and
 * `sales_challan_items` both reference products with ON DELETE RESTRICT, so
 * removing one would mean destroying history.
 */
export async function setProductStatus(id: number, isActive: boolean): Promise<Product> {
  const updated = await productRepository.setActive(id, isActive);
  if (!updated) throw new NotFoundError('Product');
  return updated;
}
