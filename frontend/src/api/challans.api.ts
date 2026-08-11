import { ApiError, apiClient } from './client';
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

/**
 * GET /api/challans/:id/pdf — downloads the challan as a PDF.
 *
 * Fetched rather than linked. The endpoint is authenticated and the token lives
 * in localStorage, so an `<a href>` would arrive without one and be rejected;
 * the bytes have to come back through the client that attaches the header.
 *
 * The response is a Blob, which the shared error interceptor cannot read a JSON
 * envelope out of — so a failure arrives with the right status but a generic
 * message. Restoring a useful one is this function's job.
 */
export async function downloadChallanPdf(id: number, challanNumber: string): Promise<void> {
  let blob: Blob;

  try {
    const response = await apiClient.get<Blob>(`/challans/${id}/pdf`, { responseType: 'blob' });
    blob = response.data;
  } catch (caught) {
    if (caught instanceof ApiError && caught.code === 'UNKNOWN_ERROR' && caught.status > 0) {
      throw new ApiError(
        caught.status === 404
          ? 'That challan no longer exists.'
          : caught.status === 403
            ? 'You do not have permission to download this challan.'
            : 'The PDF could not be generated. Please try again.',
        caught.status,
        caught.code,
      );
    }
    throw caught;
  }

  const objectUrl = URL.createObjectURL(blob);

  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `${challanNumber}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Not revoked synchronously: some browsers cancel a download whose object
    // URL disappears in the same tick as the click that started it.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  }
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
