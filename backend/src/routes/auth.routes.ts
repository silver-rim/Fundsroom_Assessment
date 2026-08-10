import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { loginSchema } from '../validators/auth.validator';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

/** POST /api/auth/login - public. Exchanges credentials for a JWT. */
router.post('/login', validate({ body: loginSchema }), asyncHandler(authController.login));

/** GET /api/auth/me - any authenticated role. Rehydrates a session. */
router.get('/me', authenticate, asyncHandler(authController.me));

export default router;
