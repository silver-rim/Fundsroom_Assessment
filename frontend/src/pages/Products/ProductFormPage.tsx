/**
 * Add / edit product.
 *
 * Note what is NOT here: there is no "current stock" input. Stock is only ever
 * changed by a movement, so that every change carries a reason and an author.
 * On create, an optional opening stock writes an IN movement server-side.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { createProduct, getProduct, updateProduct } from '../../api/products.api';
import { Button, LinkButton } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { ErrorState, InlineSpinner } from '../../components/ui/States';
import type { ProductPayload } from '../../types/product';
import styles from './ProductFormPage.module.css';

interface FormState {
  name: string;
  sku: string;
  category: string;
  unitPrice: string;
  minStockAlert: string;
  location: string;
  openingStock: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  sku: '',
  category: '',
  unitPrice: '',
  minStockAlert: '0',
  location: '',
  openingStock: '0',
};

export default function ProductFormPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;

    setIsLoading(true);
    setLoadError(null);

    try {
      const product = await getProduct(Number(id));
      setForm({
        name: product.name,
        sku: product.sku,
        category: product.category,
        unitPrice: product.unitPrice,
        minStockAlert: String(product.minStockAlert),
        location: product.location,
        openingStock: '0',
      });
    } catch (error) {
      setLoadError(
        error instanceof ApiError ? error : new ApiError('Failed to load product', 0, 'UNKNOWN'),
      );
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  function setValue<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((previous) => ({ ...previous, [key]: value }));
    setFieldErrors((previous) => ({ ...previous, [key]: undefined }));
  }

  function validate(): boolean {
    const errors: Partial<Record<keyof FormState, string>> = {};

    if (form.name.trim().length < 2) errors.name = 'Product name must be at least 2 characters';

    if (!/^[A-Za-z0-9_-]{2,50}$/.test(form.sku.trim()))
      errors.sku = 'SKU must be 2–50 characters: letters, numbers, hyphens, underscores';

    if (form.category.trim().length < 2) errors.category = 'Category must be at least 2 characters';

    if (!/^\d+(\.\d{1,2})?$/.test(form.unitPrice.trim()))
      errors.unitPrice = 'Enter a valid price with up to 2 decimals';

    if (!/^\d+$/.test(form.minStockAlert.trim()))
      errors.minStockAlert = 'Enter a whole number (0 or more)';

    if (form.location.trim().length < 1) errors.location = 'Location is required';

    if (!isEdit && !/^\d+$/.test(form.openingStock.trim()))
      errors.openingStock = 'Enter a whole number (0 or more)';

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

    const payload: ProductPayload = {
      name: form.name.trim(),
      sku: form.sku.trim().toUpperCase(),
      category: form.category.trim(),
      unitPrice: form.unitPrice.trim(),
      minStockAlert: Number(form.minStockAlert),
      location: form.location.trim(),
      ...(isEdit ? {} : { openingStock: Number(form.openingStock) }),
    };

    setIsSubmitting(true);

    try {
      const saved = isEdit
        ? await updateProduct(Number(id), payload)
        : await createProduct(payload);

      navigate(`/products/${saved.id}`, {
        replace: true,
        state: { flash: isEdit ? 'Product updated.' : 'Product created.' },
      });
    } catch (error) {
      if (error instanceof ApiError) {
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

  if (isLoading) return <InlineSpinner label="Loading product…" />;
  if (loadError) return <ErrorState error={loadError} onRetry={() => void load()} />;

  return (
    <>
      <div className="page-header">
        <h1>{isEdit ? 'Edit product' : 'Add product'}</h1>
        <p>
          {isEdit
            ? 'Update the product details. Stock is changed through movements, not here.'
            : 'Create a product. Fields marked * are required.'}
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
            label="Product name"
            required
            value={form.name}
            onChange={(event) => setValue('name', event.target.value)}
            error={fieldErrors.name}
            disabled={isSubmitting}
            autoFocus
          />

          <TextField
            id="sku"
            label="SKU / code"
            required
            value={form.sku}
            onChange={(event) => setValue('sku', event.target.value.toUpperCase())}
            error={fieldErrors.sku}
            hint="Stored in upper case, e.g. CW-25-100M"
            disabled={isSubmitting}
          />

          <TextField
            id="category"
            label="Category"
            required
            value={form.category}
            onChange={(event) => setValue('category', event.target.value)}
            error={fieldErrors.category}
            hint="Free text, e.g. Electrical, Switchgear, Consumables"
            disabled={isSubmitting}
          />

          <TextField
            id="unitPrice"
            label="Unit price (₹)"
            required
            inputMode="decimal"
            value={form.unitPrice}
            onChange={(event) => setValue('unitPrice', event.target.value)}
            error={fieldErrors.unitPrice}
            hint="Up to 2 decimals"
            disabled={isSubmitting}
          />

          <TextField
            id="minStockAlert"
            label="Minimum stock alert"
            required
            inputMode="numeric"
            value={form.minStockAlert}
            onChange={(event) => setValue('minStockAlert', event.target.value)}
            error={fieldErrors.minStockAlert}
            hint="Flagged as low stock at or below this level"
            disabled={isSubmitting}
          />

          <TextField
            id="location"
            label="Location / warehouse"
            required
            value={form.location}
            onChange={(event) => setValue('location', event.target.value)}
            error={fieldErrors.location}
            hint="e.g. Main Warehouse / Rack A-12"
            disabled={isSubmitting}
          />

          {!isEdit && (
            <TextField
              id="openingStock"
              label="Opening stock"
              inputMode="numeric"
              value={form.openingStock}
              onChange={(event) => setValue('openingStock', event.target.value)}
              error={fieldErrors.openingStock}
              hint="Recorded as an IN movement so the ledger balances from day one"
              disabled={isSubmitting}
            />
          )}
        </div>

        {isEdit && (
          <p className={styles.note}>
            Current stock cannot be edited here. Use <strong>Record movement</strong> on the product
            page so the change is logged with a reason and an author.
          </p>
        )}

        <div className={styles.actions}>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create product'}
          </Button>
          <LinkButton to={isEdit ? `/products/${id}` : '/products'} variant="secondary">
            Cancel
          </LinkButton>
        </div>
      </form>
    </>
  );
}
