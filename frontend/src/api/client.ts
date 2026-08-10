/**
 * The single HTTP client.
 *
 * No component or page imports axios directly — they call typed functions in
 * the `*.api.ts` modules beside this file, which use this instance. That keeps
 * the base URL, the auth header, error normalisation and session-expiry
 * handling in exactly one place.
 */
import axios, { AxiosError, type AxiosInstance } from 'axios';
import { config } from '../config/env';
import type { ApiErrorBody, ApiErrorDetail } from '../types/api';

/** localStorage key holding the JWT. Read here and by AuthContext (Phase 2). */
export const AUTH_TOKEN_KEY = 'mini-erp-crm.token';

/**
 * A failed request, normalised.
 *
 * Every rejection out of this module is an ApiError, so callers never have to
 * inspect an AxiosError, guess at `error.response?.data?.error?.message`, or
 * handle a network failure differently from a 4xx.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetail[];

  constructor(message: string, status: number, code: string, details: ApiErrorDetail[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when the failure is a field-level validation problem. */
  get isValidationError(): boolean {
    return this.status === 422 || this.details.length > 0;
  }
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: config.apiBaseUrl,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

// ---- Request: attach the bearer token ---------------------------------------
apiClient.interceptors.request.use((request) => {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (token) {
    request.headers.set('Authorization', `Bearer ${token}`);
  }
  return request;
});

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    (value as { success: unknown }).success === false &&
    'error' in value
  );
}

// ---- Response: normalise every failure, handle expired sessions -------------
apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (!(error instanceof AxiosError)) {
      return Promise.reject(
        new ApiError('An unexpected error occurred.', 0, 'UNKNOWN_ERROR'),
      );
    }

    // No response at all: the server is unreachable, CORS rejected the request,
    // or the client timed out. This is the message users actually need.
    if (!error.response) {
      const isTimeout = error.code === 'ECONNABORTED';
      return Promise.reject(
        new ApiError(
          isTimeout
            ? 'The server took too long to respond. Please try again.'
            : 'Cannot reach the server. Check your connection and that the API is running.',
          0,
          isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
        ),
      );
    }

    const { status, data } = error.response;

    const body = isApiErrorBody(data) ? data.error : undefined;
    const apiError = new ApiError(
      body?.message ?? 'An unexpected error occurred.',
      status,
      body?.code ?? 'UNKNOWN_ERROR',
      body?.details ?? [],
    );

    // An expired or invalid token means the session is over. Clear it and send
    // the user to the login screen — but never bounce them off the login screen
    // itself, which would turn a wrong password into a page reload.
    if (status === 401 && window.location.pathname !== '/login') {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      window.location.assign('/login');
    }

    return Promise.reject(apiError);
  },
);
