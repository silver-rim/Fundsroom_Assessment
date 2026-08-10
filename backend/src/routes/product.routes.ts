import { Router } from 'express';
import * as productController from '../controllers/product.controller';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { PRODUCT_READ, PRODUCT_WRITE, STOCK_READ } from '../config/permissions';
import { idParamSchema } from '../validators/common.validator';
import {
  createProductSchema,
  listProductsQuerySchema,
  listStockMovementsQuerySchema,
  updateProductSchema,
  updateProductStatusSchema,
} from '../validators/product.validator';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.use(authenticate);

// Declared before '/:id' so the literal path is not captured as an id.
router.get(
  '/categories',
  authorize(PRODUCT_READ),
  asyncHandler(productController.listCategories),
);

router.get(
  '/',
  authorize(PRODUCT_READ),
  validate({ query: listProductsQuerySchema }),
  asyncHandler(productController.listProducts),
);

router.post(
  '/',
  authorize(PRODUCT_WRITE),
  validate({ body: createProductSchema }),
  asyncHandler(productController.createProduct),
);

router.get(
  '/:id',
  authorize(PRODUCT_READ),
  validate({ params: idParamSchema }),
  asyncHandler(productController.getProduct),
);

router.put(
  '/:id',
  authorize(PRODUCT_WRITE),
  validate({ params: idParamSchema, body: updateProductSchema }),
  asyncHandler(productController.updateProduct),
);

router.patch(
  '/:id/status',
  authorize(PRODUCT_WRITE),
  validate({ params: idParamSchema, body: updateProductStatusSchema }),
  asyncHandler(productController.updateProductStatus),
);

router.get(
  '/:id/movements',
  authorize(STOCK_READ),
  validate({ params: idParamSchema, query: listStockMovementsQuerySchema }),
  asyncHandler(productController.listProductMovements),
);

export default router;
