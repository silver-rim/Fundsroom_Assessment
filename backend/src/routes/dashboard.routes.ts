import { Router } from 'express';
import * as dashboardController from '../controllers/dashboard.controller';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { DASHBOARD_READ } from '../config/permissions';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.use(authenticate);

// No validate() call: the endpoint takes no body, params or query. Anything the
// caller appends is ignored rather than rejected.
router.get('/summary', authorize(DASHBOARD_READ), asyncHandler(dashboardController.getSummary));

export default router;
