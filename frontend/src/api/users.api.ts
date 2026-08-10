import { apiClient } from './client';
import type { ApiSuccess } from '../types/api';
import type { AuthUser } from '../types/auth';

/** GET /api/users — Admin only. Answers 403 for every other role. */
export async function listUsers(): Promise<AuthUser[]> {
  const response = await apiClient.get<ApiSuccess<AuthUser[]>>('/users');
  return response.data.data;
}
