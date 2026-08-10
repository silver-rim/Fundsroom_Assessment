import { apiClient } from './client';
import type { ApiSuccess, PaginationMeta } from '../types/api';
import type {
  MovementListParams,
  Product,
  ProductListParams,
  ProductPayload,
  StockMovement,
} from '../types/product';
import type { Paginated } from './customers.api';

const EMPTY_PAGINATION: PaginationMeta = { page: 1, limit: 20, total: 0, totalPages: 0 };

function toQuery<T extends object>(params: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    ),
  );
}

/** GET /api/products */
export async function listProducts(params: ProductListParams): Promise<Paginated<Product>> {
  const response = await apiClient.get<ApiSuccess<Product[]>>('/products', {
    params: toQuery(params),
  });

  return { items: response.data.data, pagination: response.data.pagination ?? EMPTY_PAGINATION };
}

/** GET /api/products/categories */
export async function listCategories(): Promise<string[]> {
  const response = await apiClient.get<ApiSuccess<string[]>>('/products/categories');
  return response.data.data;
}

/** GET /api/products/:id */
export async function getProduct(id: number): Promise<Product> {
  const response = await apiClient.get<ApiSuccess<Product>>(`/products/${id}`);
  return response.data.data;
}

/** POST /api/products */
export async function createProduct(payload: ProductPayload): Promise<Product> {
  const response = await apiClient.post<ApiSuccess<Product>>('/products', payload);
  return response.data.data;
}

/** PUT /api/products/:id — stock is not among the editable fields. */
export async function updateProduct(id: number, payload: ProductPayload): Promise<Product> {
  const response = await apiClient.put<ApiSuccess<Product>>(`/products/${id}`, payload);
  return response.data.data;
}

/** PATCH /api/products/:id/status */
export async function setProductStatus(id: number, isActive: boolean): Promise<Product> {
  const response = await apiClient.patch<ApiSuccess<Product>>(`/products/${id}/status`, {
    isActive,
  });
  return response.data.data;
}

/** GET /api/products/:id/movements */
export async function listProductMovements(
  productId: number,
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<StockMovement>> {
  const response = await apiClient.get<ApiSuccess<StockMovement[]>>(
    `/products/${productId}/movements`,
    { params: toQuery(params) },
  );

  return { items: response.data.data, pagination: response.data.pagination ?? EMPTY_PAGINATION };
}

/** GET /api/stock-movements — the global ledger. */
export async function listStockMovements(
  params: MovementListParams,
): Promise<Paginated<StockMovement>> {
  const response = await apiClient.get<ApiSuccess<StockMovement[]>>('/stock-movements', {
    params: toQuery(params),
  });

  return { items: response.data.data, pagination: response.data.pagination ?? EMPTY_PAGINATION };
}

/** POST /api/stock-movements */
export async function recordStockMovement(payload: {
  productId: number;
  movementType: 'IN' | 'OUT';
  quantity: number;
  reason: string;
}): Promise<StockMovement> {
  const response = await apiClient.post<ApiSuccess<StockMovement>>('/stock-movements', payload);
  return response.data.data;
}
