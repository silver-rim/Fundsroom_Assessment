import { Router } from 'express';
import * as stockMovementController from '../controllers/stockMovement.controller';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { STOCK_READ, STOCK_WRITE } from '../config/permissions';
import {
  createStockMovementSchema,
  listStockMovementsQuerySchema,
} from '../validators/product.validator';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  authorize(STOCK_READ),
  validate({ query: listStockMovementsQuerySchema }),
  asyncHandler(stockMovementController.listMovements),
);

router.post(
  '/',
  authorize(STOCK_WRITE),
  validate({ body: createStockMovementSchema }),
  asyncHandler(stockMovementController.createMovement),
);

export default router;
