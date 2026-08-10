import { Router } from 'express';
import * as userController from '../controllers/user.controller';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { USER_READ } from '../config/permissions';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

/** GET /api/users - Admin only. Who has access to the portal. */
router.get('/', authenticate, authorize(USER_READ), asyncHandler(userController.listUsers));

export default router;
