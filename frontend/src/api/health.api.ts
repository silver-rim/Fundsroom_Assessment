import { apiClient } from './client';
import type { ApiSuccess, HealthStatus } from '../types/api';

/**
 * GET /api/health
 *
 * The endpoint answers 503 when the database is unreachable, and axios rejects
 * on 503 — so a degraded backend arrives at the caller as an ApiError and
 * renders as an error state. That is what we want: a database outage should
 * look like a failure, not like a healthy page with one red field.
 */
export async function getHealth(): Promise<HealthStatus> {
  const response = await apiClient.get<ApiSuccess<HealthStatus>>('/health');
  return response.data.data;
}
