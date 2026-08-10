/**
 * API router. Everything is mounted under /api by app.ts.
 *
 * Routers are added here as each phase lands:
 *   Phase 2  /auth
 *   Phase 3  /customers
 *   Phase 4  /products, /stock-movements
 *   Phase 5  /challans
 *   Phase 6  /dashboard
 */
import { Router } from 'express';
import healthRoutes from './health.routes';

const router = Router();

router.use('/health', healthRoutes);

export default router;
