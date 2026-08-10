import type { Request, Response } from 'express';
import * as productService from '../services/product.service';
import * as stockMovementService from '../services/stockMovement.service';
import { sendPaginated, sendSuccess } from '../utils/httpResponse';
import type { IdParam } from '../validators/common.validator';
import type {
  CreateProductInput,
  ListProductsQuery,
  ListStockMovementsQuery,
  UpdateProductInput,
  UpdateProductStatusInput,
} from '../validators/product.validator';

/** GET /api/products */
export async function listProducts(req: Request, res: Response): Promise<void> {
  const filters = req.validated.query as ListProductsQuery;
  const { products, pagination } = await productService.listProducts(filters);

  sendPaginated(res, products, pagination);
}

/** GET /api/products/categories — powers the category filter dropdown. */
export async function listCategories(_req: Request, res: Response): Promise<void> {
  const categories = await productService.listCategories();
  sendSuccess(res, categories);
}

/** GET /api/products/:id */
export async function getProduct(req: Request, res: Response): Promise<void> {
  const { id } = req.validated.params as IdParam;
  const product = await productService.getProduct(id);

  sendSuccess(res, product);
}

/** POST /api/products */
export async function createProduct(req: Request, res: Response): Promise<void> {
  const input = req.validated.body as CreateProductInput;
  const product = await productService.createProduct(input, req.user!.id);

  sendSuccess(res, product, 201);
}

/** PUT /api/products/:id */
export async function updateProduct(req: Request, res: Response): Promise<void> {
  const { id } = req.validated.params as IdParam;
  const input = req.validated.body as UpdateProductInput;
  const product = await productService.updateProduct(id, input);

  sendSuccess(res, product);
}

/** PATCH /api/products/:id/status */
export async function updateProductStatus(req: Request, res: Response): Promise<void> {
  const { id } = req.validated.params as IdParam;
  const { isActive } = req.validated.body as UpdateProductStatusInput;
  const product = await productService.setProductStatus(id, isActive);

  sendSuccess(res, product);
}

/** GET /api/products/:id/movements — this product's ledger. */
export async function listProductMovements(req: Request, res: Response): Promise<void> {
  const { id } = req.validated.params as IdParam;
  const filters = req.validated.query as ListStockMovementsQuery;

  // 404 for an unknown product, rather than an empty list that reads as
  // "this product has never moved".
  await productService.getProduct(id);

  const { movements, pagination } = await stockMovementService.listMovements({
    ...filters,
    productId: id,
  });

  sendPaginated(res, movements, pagination);
}
