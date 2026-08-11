import { apiClient } from './client';
import type { ApiSuccess } from '../types/api';
import type { DashboardSummary } from '../types/dashboard';

/** GET /api/dashboard/summary — every counter recomputed server-side per call. */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const response = await apiClient.get<ApiSuccess<DashboardSummary>>('/dashboard/summary');
  return response.data.data;
}
