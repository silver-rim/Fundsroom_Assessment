import { apiClient } from './client';
import type { ApiSuccess } from '../types/api';
import type { AuthUser, LoginResponse } from '../types/auth';

/** POST /api/auth/login */
export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await apiClient.post<ApiSuccess<LoginResponse>>('/auth/login', {
    email,
    password,
  });
  return response.data.data;
}

/** GET /api/auth/me — rehydrates a session from a stored token. */
export async function getMe(): Promise<AuthUser> {
  const response = await apiClient.get<ApiSuccess<AuthUser>>('/auth/me');
  return response.data.data;
}
