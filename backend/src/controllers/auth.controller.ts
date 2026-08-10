/**
 * Auth HTTP layer.
 *
 * Reads validated input, calls one service method, picks the status code.
 * No business logic and no try/catch — a rejected promise is forwarded to the
 * central error handler by asyncHandler.
 */
import type { Request, Response } from 'express';
import * as authService from '../services/auth.service';
import { sendSuccess } from '../utils/httpResponse';
import type { LoginInput } from '../validators/auth.validator';

/** POST /api/auth/login - public. */
export async function login(req: Request, res: Response): Promise<void> {
  const input = req.validated.body as LoginInput;
  const result = await authService.login(input);

  sendSuccess(res, result);
}

/** GET /api/auth/me - any authenticated role. */
export async function me(req: Request, res: Response): Promise<void> {
  // Guaranteed by the authenticate middleware on this route.
  const userId = req.user!.id;
  const user = await authService.getProfile(userId);

  sendSuccess(res, user);
}
