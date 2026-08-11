import type { Request, Response } from 'express';
import * as challanService from '../services/challan.service';
import { pdfFilename, renderChallanPdf } from '../services/challanPdf.service';
import { sendPaginated, sendSuccess } from '../utils/httpResponse';
import type { IdParam } from '../validators/common.validator';
import type {
  CancelChallanInput,
  CreateChallanInput,
  ListChallansQuery,
  UpdateChallanInput,
} from '../validators/challan.validator';

/** GET /api/challans */
export async function listChallans(req: Request, res: Response): Promise<void> {
  const filters = req.validated.query as ListChallansQuery;
  const { challans, pagination } = await challanService.listChallans(filters);

  sendPaginated(res, challans, pagination);
}

/** GET /api/challans/:id */
export async function getChallan(req: Request, res: Response): Promise<void> {
  const { id } = req.validated.params as IdParam;
  const challan = await challanService.getChallan(id);

  sendSuccess(res, challan);
}

/**
 * GET /api/challans/:id/pdf
 *
 * The only endpoint that does not return the JSON envelope, because the body is
 * the document itself. Errors still do: getChallan throws NotFoundError before
 * a single byte is written, so a missing challan is the same 404 envelope as
 * everywhere else.
 */
export async function downloadChallanPdf(req: Request, res: Response): Promise<void> {
  const { id } = req.validated.params as IdParam;
  const challan = await challanService.getChallan(id);
  const pdf = await renderChallanPdf(challan);

  res.setHeader('Content-Type', 'application/pdf');
  // `attachment` so a browser saves it under the challan number instead of
  // rendering it inline under a URL ending in "/pdf".
  res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename(challan)}"`);
  res.setHeader('Content-Length', pdf.length);
  res.send(pdf);
}

/** POST /api/challans */
export async function createChallan(req: Request, res: Response): Promise<void> {
  const input = req.validated.body as CreateChallanInput;
  const challan = await challanService.createChallan(input, req.user!.id);

  sendSuccess(res, challan, 201);
}

/** PUT /api/challans/:id */
export async function updateChallan(req: Request, res: Response): Promise<void> {
  const { id } = req.validated.params as IdParam;
  const input = req.validated.body as UpdateChallanInput;
  const challan = await challanService.updateChallan(id, input);

  sendSuccess(res, challan);
}

/** POST /api/challans/:id/confirm — deducts stock transactionally. */
export async function confirmChallan(req: Request, res: Response): Promise<void> {
  const { id } = req.validated.params as IdParam;
  const challan = await challanService.confirmChallan(id, req.user!.id);

  sendSuccess(res, challan);
}

/** POST /api/challans/:id/cancel */
export async function cancelChallan(req: Request, res: Response): Promise<void> {
  const { id } = req.validated.params as IdParam;
  const { reason } = req.validated.body as CancelChallanInput;
  const challan = await challanService.cancelChallan(id, req.user!.id, reason ?? null);

  sendSuccess(res, challan);
}
