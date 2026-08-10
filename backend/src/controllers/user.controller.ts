import type { Request, Response } from 'express';
import * as userService from '../services/user.service';
import { sendSuccess } from '../utils/httpResponse';

/** GET /api/users - Admin only. */
export async function listUsers(_req: Request, res: Response): Promise<void> {
  const users = await userService.listUsers();
  sendSuccess(res, users);
}
