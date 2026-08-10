/**
 * Customer CRM business rules.
 */
import { withTransaction } from '../config/db';
import * as customerRepository from '../repositories/customer.repository';
import type { Customer, FollowUp } from '../repositories/customer.repository';
import { ConflictError, ERROR_CODES, NotFoundError } from '../utils/AppError';
import { buildPaginationMeta } from '../utils/pagination';
import type { PaginationMeta } from '../utils/httpResponse';
import type {
  CreateCustomerInput,
  CreateFollowUpInput,
  ListCustomersQuery,
  ListFollowUpsQuery,
  UpdateCustomerInput,
} from '../validators/customer.validator';

export interface PaginatedCustomers {
  customers: Customer[];
  pagination: PaginationMeta;
}

export interface PaginatedFollowUps {
  followUps: FollowUp[];
  pagination: PaginationMeta;
}

export async function listCustomers(filters: ListCustomersQuery): Promise<PaginatedCustomers> {
  const { customers, total } = await customerRepository.findAll(filters);

  return {
    customers,
    pagination: buildPaginationMeta(filters.page, filters.limit, total),
  };
}

export async function getCustomer(id: number): Promise<Customer> {
  const customer = await customerRepository.findById(id);
  if (!customer) throw new NotFoundError('Customer');
  return customer;
}

/**
 * The mobile number is checked here so the caller gets a readable message
 * naming the field. The UNIQUE constraint on customers.mobile still stands
 * behind it and would catch a race between two simultaneous creates — the
 * error handler maps that to the same 409 code.
 */
export async function createCustomer(
  input: CreateCustomerInput,
  createdBy: number,
): Promise<Customer> {
  if (await customerRepository.mobileExists(input.mobile)) {
    throw new ConflictError(
      'A customer with this mobile number already exists.',
      ERROR_CODES.DUPLICATE_MOBILE,
      [{ field: 'body.mobile', message: 'This mobile number is already registered' }],
    );
  }

  return customerRepository.create(input, createdBy);
}

export async function updateCustomer(
  id: number,
  input: UpdateCustomerInput,
): Promise<Customer> {
  const existing = await customerRepository.findById(id);
  if (!existing) throw new NotFoundError('Customer');

  // Excludes this customer, so saving a record without changing its number is
  // not treated as a duplicate of itself.
  if (await customerRepository.mobileExists(input.mobile, id)) {
    throw new ConflictError(
      'Another customer is already using this mobile number.',
      ERROR_CODES.DUPLICATE_MOBILE,
      [{ field: 'body.mobile', message: 'This mobile number belongs to another customer' }],
    );
  }

  const updated = await customerRepository.update(id, input);
  if (!updated) throw new NotFoundError('Customer');

  return updated;
}

export async function deleteCustomer(id: number): Promise<void> {
  const deleted = await customerRepository.softDelete(id);
  if (!deleted) throw new NotFoundError('Customer');
}

export async function listFollowUps(
  customerId: number,
  filters: ListFollowUpsQuery,
): Promise<PaginatedFollowUps> {
  // Confirms the customer exists (and is not soft-deleted) so a bad id returns
  // 404 rather than an empty list that looks like "no follow-ups yet".
  await getCustomer(customerId);

  const { followUps, total } = await customerRepository.findFollowUps(
    customerId,
    filters.page,
    filters.limit,
  );

  return {
    followUps,
    pagination: buildPaginationMeta(filters.page, filters.limit, total),
  };
}

/**
 * Adds a follow-up note.
 *
 * When the note carries a next follow-up date, the customer's own
 * `follow_up_date` is moved to match — in the SAME transaction, so the CRM list
 * and the note history can never disagree about when the next call is due
 * (rule SVC9 in docs/DATABASE_DESIGN.md).
 */
export async function addFollowUp(
  customerId: number,
  input: CreateFollowUpInput,
  createdBy: number,
): Promise<FollowUp> {
  await getCustomer(customerId);

  const followUpId = await withTransaction(async (client) => {
    const id = await customerRepository.createFollowUp(
      client,
      customerId,
      input.note,
      input.nextFollowUpDate ?? null,
      createdBy,
    );

    if (input.nextFollowUpDate) {
      await customerRepository.setFollowUpDate(client, customerId, input.nextFollowUpDate);
    }

    return id;
  });

  const followUp = await customerRepository.findFollowUpById(followUpId);
  if (!followUp) throw new NotFoundError('Follow-up');

  return followUp;
}
