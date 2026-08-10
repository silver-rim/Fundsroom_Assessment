import type { Request, Response } from 'express';
import * as stockMovementService from '../services/stockMovement.service';
import { sendPaginated, sendSuccess } from '../utils/httpResponse';
import type {
  CreateStockMovementInput,
  ListStockMovementsQuery,
} from '../validators/product.validator';

/** GET /api/stock-movements — the global inventory ledger. */
export async function listMovements(req: Request, res: Response): Promise<void> {
  const filters = req.validated.query as ListStockMovementsQuery;
  const { movements, pagination } = await stockMovementService.listMovements(filters);

  sendPaginated(res, movements, pagination);
}

/** POST /api/stock-movements — record a manual IN or OUT. */
export async function createMovement(req: Request, res: Response): Promise<void> {
  const input = req.validated.body as CreateStockMovementInput;
  const movement = await stockMovementService.recordMovement(input, req.user!.id);

  sendSuccess(res, movement, 201);
}
