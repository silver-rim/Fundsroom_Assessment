/**
 * Shapes returned by the backend, mirroring docs/API_PLAN.md section 1.
 * Kept in one file so a contract change is a single, visible edit.
 */

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  pagination?: PaginationMeta;
}

export interface ApiErrorDetail {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
  };
}

/** Payload of GET /api/health. */
export interface HealthStatus {
  status: 'ok' | 'degraded';
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  database: {
    status: 'up' | 'down';
    latencyMs: number | null;
  };
}
