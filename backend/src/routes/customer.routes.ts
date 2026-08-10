/**
 * Customer CRM routes.
 *
 * Middleware order is always: authenticate -> authorize -> validate -> handler.
 * Identity, then permission, then input shape — an unauthorised caller is
 * rejected before their payload is parsed.
 */
import { Router } from 'express';
import * as customerController from '../controllers/customer.controller';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import {
  CUSTOMER_DELETE,
  CUSTOMER_READ,
  CUSTOMER_WRITE,
  FOLLOW_UP_READ,
  FOLLOW_UP_WRITE,
} from '../config/permissions';
import { idParamSchema } from '../validators/common.validator';
import {
  createCustomerSchema,
  createFollowUpSchema,
  listCustomersQuerySchema,
  listFollowUpsQuerySchema,
  updateCustomerSchema,
} from '../validators/customer.validator';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

// Every route below requires a signed-in user.
router.use(authenticate);

router.get(
  '/',
  authorize(CUSTOMER_READ),
  validate({ query: listCustomersQuerySchema }),
  asyncHandler(customerController.listCustomers),
);

router.post(
  '/',
  authorize(CUSTOMER_WRITE),
  validate({ body: createCustomerSchema }),
  asyncHandler(customerController.createCustomer),
);

router.get(
  '/:id',
  authorize(CUSTOMER_READ),
  validate({ params: idParamSchema }),
  asyncHandler(customerController.getCustomer),
);

router.put(
  '/:id',
  authorize(CUSTOMER_WRITE),
  validate({ params: idParamSchema, body: updateCustomerSchema }),
  asyncHandler(customerController.updateCustomer),
);

router.delete(
  '/:id',
  authorize(CUSTOMER_DELETE),
  validate({ params: idParamSchema }),
  asyncHandler(customerController.deleteCustomer),
);

router.get(
  '/:id/follow-ups',
  authorize(FOLLOW_UP_READ),
  validate({ params: idParamSchema, query: listFollowUpsQuerySchema }),
  asyncHandler(customerController.listFollowUps),
);

router.post(
  '/:id/follow-ups',
  authorize(FOLLOW_UP_WRITE),
  validate({ params: idParamSchema, body: createFollowUpSchema }),
  asyncHandler(customerController.addFollowUp),
);

export default router;
