import { Router } from 'express';
import * as challanController from '../controllers/challan.controller';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import {
  CHALLAN_CANCEL,
  CHALLAN_CONFIRM,
  CHALLAN_READ,
  CHALLAN_WRITE,
} from '../config/permissions';
import { idParamSchema } from '../validators/common.validator';
import {
  cancelChallanSchema,
  createChallanSchema,
  listChallansQuerySchema,
  updateChallanSchema,
} from '../validators/challan.validator';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  authorize(CHALLAN_READ),
  validate({ query: listChallansQuerySchema }),
  asyncHandler(challanController.listChallans),
);

router.post(
  '/',
  authorize(CHALLAN_WRITE),
  validate({ body: createChallanSchema }),
  asyncHandler(challanController.createChallan),
);

router.get(
  '/:id',
  authorize(CHALLAN_READ),
  validate({ params: idParamSchema }),
  asyncHandler(challanController.getChallan),
);

router.put(
  '/:id',
  authorize(CHALLAN_WRITE),
  validate({ params: idParamSchema, body: updateChallanSchema }),
  asyncHandler(challanController.updateChallan),
);

/** Warehouse can confirm too: confirmation is the moment goods leave the building. */
router.post(
  '/:id/confirm',
  authorize(CHALLAN_CONFIRM),
  validate({ params: idParamSchema }),
  asyncHandler(challanController.confirmChallan),
);

router.post(
  '/:id/cancel',
  authorize(CHALLAN_CANCEL),
  validate({ params: idParamSchema, body: cancelChallanSchema }),
  asyncHandler(challanController.cancelChallan),
);

export default router;
