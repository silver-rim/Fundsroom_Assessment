import type { Request, Response } from 'express';
import * as customerService from '../services/customer.service';
import * as challanService from '../services/challan.service';
import { sendPaginated, sendSuccess } from '../utils/httpResponse';
import type { IdParam } from '../validators/common.validator';
import type {
  CreateCustomerInput,
  CreateFollowUpInput,
  ListCustomersQuery,
  ListFollowUpsQuery,
  UpdateCustomerInput,
} from '../validators/customer.validator';

/** GET /api/customers */
export async function listCustomers(req: Request, res: Response): Promise<void> {
  const filters = req.validated.query as ListCustomersQuery;
  const { customers, pagination } = await customerService.listCustomers(filters);

  sendPaginated(res, customers, pagination);
}

/** GET /api/customers/:id */
export async function getCustomer(req: Request, res: Response): Promise<void> {
  const { id } = req.validated.params as IdParam;
  const customer = await customerService.getCustomer(id);

  sendSuccess(res, customer);
}

/** POST /api/customers */
export async function createCustomer(req: Request, res: Response): Promise<void> {
  const input = req.validated.body as CreateCustomerInput;
  const customer = await customerService.createCustomer(input, req.user!.id);

  sendSuccess(res, customer, 201);
}

/** PUT /api/customers/:id */
export async function updateCustomer(req: Request, res: Response): Promise<void> {
  const { id } = req.validated.params as IdParam;
  const input = req.validated.body as UpdateCustomerInput;
  const customer = await customerService.updateCustomer(id, input);

  sendSuccess(res, customer);
}

/** DELETE /api/customers/:id */
export async function deleteCustomer(req: Request, res: Response): Promise<void> {
  const { id } = req.validated.params as IdParam;
  await customerService.deleteCustomer(id);

  // 204: the deletion succeeded and there is nothing meaningful to return.
  res.status(204).send();
}

/** GET /api/customers/:id/follow-ups */
export async function listFollowUps(req: Request, res: Response): Promise<void> {
  const { id } = req.validated.params as IdParam;
  const filters = req.validated.query as ListFollowUpsQuery;
  const { followUps, pagination } = await customerService.listFollowUps(id, filters);

  sendPaginated(res, followUps, pagination);
}

/**
 * GET /api/customers/:id/challans
 *
 * Planned in Phase 0, deferred until Phase 5 because challans did not exist yet.
 */
export async function listCustomerChallans(req: Request, res: Response): Promise<void> {
  const { id } = req.validated.params as IdParam;
  const { page, limit } = req.validated.query as ListFollowUpsQuery;
  const { challans, pagination } = await challanService.listCustomerChallans(id, page, limit);

  sendPaginated(res, challans, pagination);
}

/** POST /api/customers/:id/follow-ups */
export async function addFollowUp(req: Request, res: Response): Promise<void> {
  const { id } = req.validated.params as IdParam;
  const input = req.validated.body as CreateFollowUpInput;
  const followUp = await customerService.addFollowUp(id, input, req.user!.id);

  sendSuccess(res, followUp, 201);
}
