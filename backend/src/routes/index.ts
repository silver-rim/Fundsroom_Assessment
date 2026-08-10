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
import authRoutes from './auth.routes';
import userRoutes from './user.routes';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);

export default router;
