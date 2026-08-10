import { apiClient } from './client';
import type { ApiSuccess, PaginationMeta } from '../types/api';
import type {
  Customer,
  CustomerListParams,
  CustomerPayload,
  FollowUp,
} from '../types/customer';

export interface Paginated<T> {
  items: T[];
  pagination: PaginationMeta;
}

/**
 * Drops empty values so the query string carries only real filters.
 * Sending `status=` would be rejected by the backend's strict enum.
 */
function toQuery<T extends object>(params: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    ),
  );
}

/** GET /api/customers */
export async function listCustomers(params: CustomerListParams): Promise<Paginated<Customer>> {
  const response = await apiClient.get<ApiSuccess<Customer[]>>('/customers', {
    params: toQuery(params),
  });

  return {
    items: response.data.data,
    pagination: response.data.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 0 },
  };
}

/** GET /api/customers/:id */
export async function getCustomer(id: number): Promise<Customer> {
  const response = await apiClient.get<ApiSuccess<Customer>>(`/customers/${id}`);
  return response.data.data;
}

/** POST /api/customers */
export async function createCustomer(payload: CustomerPayload): Promise<Customer> {
  const response = await apiClient.post<ApiSuccess<Customer>>('/customers', payload);
  return response.data.data;
}

/** PUT /api/customers/:id — full replacement, so the form submits every field. */
export async function updateCustomer(id: number, payload: CustomerPayload): Promise<Customer> {
  const response = await apiClient.put<ApiSuccess<Customer>>(`/customers/${id}`, payload);
  return response.data.data;
}

/** DELETE /api/customers/:id — soft delete, Admin only. */
export async function deleteCustomer(id: number): Promise<void> {
  await apiClient.delete(`/customers/${id}`);
}

/** GET /api/customers/:id/follow-ups */
export async function listFollowUps(
  customerId: number,
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<FollowUp>> {
  const response = await apiClient.get<ApiSuccess<FollowUp[]>>(
    `/customers/${customerId}/follow-ups`,
    { params: toQuery(params) },
  );

  return {
    items: response.data.data,
    pagination: response.data.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 0 },
  };
}

/** POST /api/customers/:id/follow-ups */
export async function addFollowUp(
  customerId: number,
  payload: { note: string; nextFollowUpDate?: string },
): Promise<FollowUp> {
  const response = await apiClient.post<ApiSuccess<FollowUp>>(
    `/customers/${customerId}/follow-ups`,
    payload,
  );
  return response.data.data;
}
