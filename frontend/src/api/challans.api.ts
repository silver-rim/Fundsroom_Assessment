import { apiClient } from './client';
import type { ApiSuccess, PaginationMeta } from '../types/api';
import type { Challan, ChallanListParams, ChallanPayload, ChallanSummary } from '../types/challan';
import type { Paginated } from './customers.api';

const EMPTY_PAGINATION: PaginationMeta = { page: 1, limit: 20, total: 0, totalPages: 0 };

function toQuery<T extends object>(params: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    ),
  );
}

/** GET /api/challans */
export async function listChallans(
  params: ChallanListParams,
): Promise<Paginated<ChallanSummary>> {
  const response = await apiClient.get<ApiSuccess<ChallanSummary[]>>('/challans', {
    params: toQuery(params),
  });

  return { items: response.data.data, pagination: response.data.pagination ?? EMPTY_PAGINATION };
}

/** GET /api/challans/:id */
export async function getChallan(id: number): Promise<Challan> {
  const response = await apiClient.get<ApiSuccess<Challan>>(`/challans/${id}`);
  return response.data.data;
}

/** POST /api/challans */
export async function createChallan(payload: ChallanPayload): Promise<Challan> {
  const response = await apiClient.post<ApiSuccess<Challan>>('/challans', payload);
  return response.data.data;
}

/** PUT /api/challans/:id — drafts only. */
export async function updateChallan(id: number, payload: ChallanPayload): Promise<Challan> {
  const response = await apiClient.put<ApiSuccess<Challan>>(`/challans/${id}`, payload);
  return response.data.data;
}

/** POST /api/challans/:id/confirm — deducts stock. */
export async function confirmChallan(id: number): Promise<Challan> {
  const response = await apiClient.post<ApiSuccess<Challan>>(`/challans/${id}/confirm`);
  return response.data.data;
}

/** POST /api/challans/:id/cancel — drafts only. */
export async function cancelChallan(id: number, reason?: string): Promise<Challan> {
  const response = await apiClient.post<ApiSuccess<Challan>>(`/challans/${id}/cancel`, {
    ...(reason ? { reason } : {}),
  });
  return response.data.data;
}

/** GET /api/customers/:id/challans */
export async function listCustomerChallans(
  customerId: number,
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<ChallanSummary>> {
  const response = await apiClient.get<ApiSuccess<ChallanSummary[]>>(
    `/customers/${customerId}/challans`,
    { params: toQuery(params) },
  );

  return { items: response.data.data, pagination: response.data.pagination ?? EMPTY_PAGINATION };
}
