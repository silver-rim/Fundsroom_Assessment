import { Router } from 'express';
import { getHealth } from '../controllers/health.controller';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

/** GET /api/health - public. No authentication, so uptime monitors can reach it. */
router.get('/', asyncHandler(getHealth));

export default router;
