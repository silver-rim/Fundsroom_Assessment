import type { Request, Response } from 'express';
import * as dashboardService from '../services/dashboard.service';
import { sendSuccess } from '../utils/httpResponse';

/** GET /api/dashboard/summary — live counters and recent activity. */
export async function getSummary(_req: Request, res: Response): Promise<void> {
  const summary = await dashboardService.getSummary();

  sendSuccess(res, summary);
}
