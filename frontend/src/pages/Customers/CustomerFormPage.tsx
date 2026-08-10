/**
 * Add / edit customer.
 *
 * One component serves both: the presence of an `:id` route param decides
 * whether it loads an existing record and PUTs, or starts blank and POSTs.
 * Keeping them together means the two forms cannot drift apart in fields,
 * validation or layout.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { createCustomer, getCustomer, updateCustomer } from '../../api/customers.api';
import { Button, LinkButton } from '../../components/ui/Button';
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field';
import { ErrorState, InlineSpinner } from '../../components/ui/States';
import {
  CUSTOMER_STATUSES,
  CUSTOMER_STATUS_LABELS,
  CUSTOMER_TYPES,
  CUSTOMER_TYPE_LABELS,
  type CustomerPayload,
  type CustomerStatus,
  type CustomerType,
} from '../../types/customer';
import styles from './CustomerFormPage.module.css';

type FormState = {
  name: string;
  mobile: string;
  email: string;
  businessName: string;
  gstNumber: string;
  customerType: CustomerType | '';
  address: string;
  status: CustomerStatus;
  followUpDate: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  mobile: '',
  email: '',
  businessName: '',
  gstNumber: '',
  customerType: '',
  address: '',
  status: 'LEAD',
  followUpDate: '',
  notes: '',
};

const TYPE_OPTIONS = CUSTOMER_TYPES.map((value) => ({
  value,
  label: CUSTOMER_TYPE_LABELS[value],
}));

const STATUS_OPTIONS = CUSTOMER_STATUSES.map((value) => ({
  value,
  label: CUSTOMER_STATUS_LABELS[value],
}));

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export default function CustomerFormPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadCustomer = useCallback(async () => {
    if (!id) return;

    setIsLoading(true);
    setLoadError(null);

    try {
      const customer = await getCustomer(Number(id));
      setForm({
        name: customer.name,
        mobile: customer.mobile,
        email: customer.email,
        businessName: customer.businessName,
        gstNumber: customer.gstNumber ?? '',
        customerType: customer.customerType,
        address: customer.address,
        status: customer.status,
        followUpDate: customer.followUpDate ?? '',
        notes: customer.notes ?? '',
      });
    } catch (error) {
      setLoadError(
        error instanceof ApiError ? error : new ApiError('Failed to load customer', 0, 'UNKNOWN'),
      );
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadCustomer();
  }, [loadCustomer]);

  function setValue<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((previous) => ({ ...previous, [key]: value }));
    setFieldErrors((previous) => ({ ...previous, [key]: undefined }));
  }

  /** Mirrors the backend Zod schema. The server validates again regardless. */
  function validate(): boolean {
    const errors: Partial<Record<keyof FormState, string>> = {};

    if (form.name.trim().length < 2) errors.name = 'Customer name must be at least 2 characters';

    const digits = form.mobile.replace(/[\s+\-()]/g, '');
    if (!/^[0-9]{10,15}$/.test(digits))
      errors.mobile = 'Enter a valid mobile number (10 to 15 digits)';

    if (!/^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/.test(form.email.trim()))
      errors.email = 'Enter a valid email address';

    if (form.businessName.trim().length < 2)
      errors.businessName = 'Business name must be at least 2 characters';

    if (form.gstNumber.trim() && !GSTIN_PATTERN.test(form.gstNumber.trim().toUpperCase()))
      errors.gstNumber = 'Enter a valid 15-character GST number';

    if (!form.customerType) errors.customerType = 'Select a customer type';

    if (form.address.trim().length < 5) errors.address = 'Address must be at least 5 characters';

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    if (!validate()) {
      setFormError('Please correct the highlighted fields.');
      return;
    }

    const payload: CustomerPayload = {
      name: form.name.trim(),
      mobile: form.mobile.trim(),
      email: form.email.trim(),
      businessName: form.businessName.trim(),
      customerType: form.customerType as CustomerType,
      address: form.address.trim(),
      status: form.status,
      // Optional fields are omitted rather than sent empty, so the API stores
      // NULL instead of failing an enum/format check on "".
      ...(form.gstNumber.trim() ? { gstNumber: form.gstNumber.trim().toUpperCase() } : {}),
      ...(form.followUpDate ? { followUpDate: form.followUpDate } : {}),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    };

    setIsSubmitting(true);

    try {
      const saved = isEdit
        ? await updateCustomer(Number(id), payload)
        : await createCustomer(payload);

      navigate(`/customers/${saved.id}`, {
        replace: true,
        state: { flash: isEdit ? 'Customer updated.' : 'Customer created.' },
      });
    } catch (error) {
      if (error instanceof ApiError) {
        // Map server-side field errors ("body.mobile") back onto the inputs.
        if (error.details.length > 0) {
          const mapped: Partial<Record<keyof FormState, string>> = {};
          for (const detail of error.details) {
            const key = detail.field.replace(/^body\./, '') as keyof FormState;
            mapped[key] = detail.message;
          }
          setFieldErrors(mapped);
        }
        setFormError(error.message);
      } else {
        setFormError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) return <InlineSpinner label="Loading customer…" />;
  if (loadError) return <ErrorState error={loadError} onRetry={() => void loadCustomer()} />;

  return (
    <>
      <div className="page-header">
        <h1>{isEdit ? 'Edit customer' : 'Add customer'}</h1>
        <p>
          {isEdit
            ? 'Update the customer record. All fields are saved together.'
            : 'Create a new customer or lead. Fields marked * are required.'}
        </p>
      </div>

      <form className={`card ${styles.form}`} onSubmit={handleSubmit} noValidate>
        {formError && (
          <div className={styles.alert} role="alert">
            {formError}
          </div>
        )}

        <div className={styles.grid}>
          <TextField
            id="name"
            label="Customer name"
            required
            value={form.name}
            onChange={(event) => setValue('name', event.target.value)}
            error={fieldErrors.name}
            disabled={isSubmitting}
            autoFocus
          />

          <TextField
            id="businessName"
            label="Business name"
            required
            value={form.businessName}
            onChange={(event) => setValue('businessName', event.target.value)}
            error={fieldErrors.businessName}
            disabled={isSubmitting}
          />

          <TextField
            id="mobile"
            label="Mobile number"
            required
            inputMode="tel"
            value={form.mobile}
            onChange={(event) => setValue('mobile', event.target.value)}
            error={fieldErrors.mobile}
            hint="10–15 digits. Spaces, + and - are fine."
            disabled={isSubmitting}
          />

          <TextField
            id="email"
            label="Email"
            required
            type="email"
            value={form.email}
            onChange={(event) => setValue('email', event.target.value)}
            error={fieldErrors.email}
            disabled={isSubmitting}
          />

          <SelectField
            id="customerType"
            label="Customer type"
            required
            options={TYPE_OPTIONS}
            placeholder="Select a type…"
            value={form.customerType}
            onChange={(event) => setValue('customerType', event.target.value as CustomerType)}
            error={fieldErrors.customerType}
            disabled={isSubmitting}
          />

          <SelectField
            id="status"
            label="Status"
            required
            options={STATUS_OPTIONS}
            value={form.status}
            onChange={(event) => setValue('status', event.target.value as CustomerStatus)}
            error={fieldErrors.status}
            disabled={isSubmitting}
          />

          <TextField
            id="gstNumber"
            label="GST number"
            value={form.gstNumber}
            onChange={(event) => setValue('gstNumber', event.target.value.toUpperCase())}
            error={fieldErrors.gstNumber}
            hint="Optional. 15 characters, e.g. 24AAACS1234F1Z5"
            disabled={isSubmitting}
          />

          <TextField
            id="followUpDate"
            label="Next follow-up date"
            type="date"
            value={form.followUpDate}
            onChange={(event) => setValue('followUpDate', event.target.value)}
            error={fieldErrors.followUpDate}
            hint="Optional."
            disabled={isSubmitting}
          />
        </div>

        <TextAreaField
          id="address"
          label="Address"
          required
          rows={3}
          value={form.address}
          onChange={(event) => setValue('address', event.target.value)}
          error={fieldErrors.address}
          disabled={isSubmitting}
        />

        <TextAreaField
          id="notes"
          label="Notes"
          rows={3}
          value={form.notes}
          onChange={(event) => setValue('notes', event.target.value)}
          error={fieldErrors.notes}
          hint="Optional. Standing notes about this account."
          disabled={isSubmitting}
        />

        <div className={styles.actions}>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create customer'}
          </Button>
          <LinkButton to={isEdit ? `/customers/${id}` : '/customers'} variant="secondary">
            Cancel
          </LinkButton>
        </div>
      </form>
    </>
  );
}
