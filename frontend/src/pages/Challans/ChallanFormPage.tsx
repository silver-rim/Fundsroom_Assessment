/**
 * Create / edit a sales challan.
 *
 * Dynamic line rows with a customer selector, a product selector, quantities,
 * and live stock availability shown per line. Editing is only reachable for a
 * DRAFT — the API refuses anything else, and the detail page only offers the
 * link for drafts.
 *
 * The client never sends prices. It sends product ids and quantities; names,
 * SKUs and unit prices are read from the products table server-side. The totals
 * shown here are a preview computed from live prices for the user's benefit.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { createChallan, getChallan, updateChallan } from '../../api/challans.api';
import { listCustomers } from '../../api/customers.api';
import { listProducts } from '../../api/products.api';
import { useAuth } from '../../context/AuthContext';
import { Button, LinkButton } from '../../components/ui/Button';
import { SelectField, TextAreaField } from '../../components/ui/Field';
import { ErrorState, InlineSpinner } from '../../components/ui/States';
import { formatCurrency } from '../../utils/format';
import type { Customer } from '../../types/customer';
import type { Product } from '../../types/product';
import styles from './ChallanFormPage.module.css';

interface LineRow {
  /** Stable key for React, independent of the product chosen. */
  key: string;
  productId: string;
  quantity: string;
}

function emptyRow(): LineRow {
  return { key: crypto.randomUUID(), productId: '', quantity: '1' };
}

export default function ChallanFormPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const isEdit = Boolean(id);
  const canConfirm = hasRole('ADMIN', 'SALES', 'WAREHOUSE');

  const [customerId, setCustomerId] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<LineRow[]>([emptyRow()]);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      // Limit 100: enough for a demo dataset. A real deployment would use a
      // searchable async picker rather than loading every record up front.
      const [customerPage, productPage] = await Promise.all([
        listCustomers({ limit: 100, sortBy: 'businessName', sortOrder: 'asc' }),
        listProducts({ limit: 100, isActive: 'true', sortBy: 'name', sortOrder: 'asc' }),
      ]);

      setCustomers(customerPage.items);
      setProducts(productPage.items);

      if (id) {
        const challan = await getChallan(Number(id));
        setCustomerId(String(challan.customer.id));
        setNotes(challan.notes ?? '');
        setRows(
          challan.items.map((item) => ({
            key: crypto.randomUUID(),
            productId: String(item.productId),
            quantity: String(item.quantity),
          })),
        );
      }
    } catch (error) {
      setLoadError(
        error instanceof ApiError ? error : new ApiError('Failed to load', 0, 'UNKNOWN'),
      );
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const customerOptions = useMemo(
    () =>
      customers
        // An inactive customer cannot receive a dispatch — the API rejects it,
        // so it is not offered here either.
        .filter((customer) => customer.status !== 'INACTIVE')
        .map((customer) => ({
          value: String(customer.id),
          label: `${customer.businessName} — ${customer.name}`,
        })),
    [customers],
  );

  const productOptions = useMemo(
    () =>
      products.map((product) => ({
        value: String(product.id),
        label: `${product.name} (${product.sku}) — ${product.currentStock} in stock`,
      })),
    [products],
  );

  function updateRow(key: string, patch: Partial<LineRow>): void {
    setRows((previous) =>
      previous.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
    setFieldErrors({});
  }

  function addRow(): void {
    setRows((previous) => [...previous, emptyRow()]);
  }

  function removeRow(key: string): void {
    setRows((previous) =>
      previous.length === 1 ? previous : previous.filter((row) => row.key !== key),
    );
  }

  /** Preview total from live prices. The server recomputes authoritatively. */
  const previewTotal = rows.reduce((sum, row) => {
    const product = productById.get(Number(row.productId));
    const quantity = Number(row.quantity);
    if (!product || !Number.isFinite(quantity)) return sum;
    return sum + Number(product.unitPrice) * quantity;
  }, 0);

  const previewQuantity = rows.reduce((sum, row) => {
    const quantity = Number(row.quantity);
    return sum + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);

  function validate(): boolean {
    const errors: Record<string, string> = {};

    if (!customerId) errors.customerId = 'Select a customer';

    const filled = rows.filter((row) => row.productId);
    if (filled.length === 0) errors.items = 'Add at least one product';

    const seen = new Set<string>();
    rows.forEach((row, index) => {
      if (!row.productId) {
        errors[`row-${index}-product`] = 'Select a product';
        return;
      }

      if (seen.has(row.productId)) {
        errors[`row-${index}-product`] = 'This product is already on the challan';
      }
      seen.add(row.productId);

      const quantity = Number(row.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        errors[`row-${index}-quantity`] = 'Enter a whole number greater than zero';
      }
    });

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function submit(confirmImmediately: boolean): Promise<void> {
    setFormError(null);

    if (!validate()) {
      setFormError('Please correct the highlighted lines.');
      return;
    }

    const payload = {
      customerId: Number(customerId),
      items: rows
        .filter((row) => row.productId)
        .map((row) => ({ productId: Number(row.productId), quantity: Number(row.quantity) })),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(confirmImmediately ? { confirmImmediately: true } : {}),
    };

    setIsSubmitting(true);

    try {
      const saved = isEdit
        ? await updateChallan(Number(id), payload)
        : await createChallan(payload);

      navigate(`/challans/${saved.id}`, {
        replace: true,
        state: {
          flash: confirmImmediately
            ? `Challan ${saved.challanNumber} confirmed. Stock has been deducted.`
            : isEdit
              ? 'Draft updated.'
              : `Draft ${saved.challanNumber} saved. Stock is not affected until you confirm it.`,
        },
      });
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);

        // Map server line errors — "items[2].quantity" or
        // "body.items[2].productId" — back onto the matching row.
        const mapped: Record<string, string> = {};
        for (const detail of error.details) {
          const match = /items\[(\d+)\]\.(\w+)/.exec(detail.field);
          if (match) {
            const field = match[2] === 'quantity' ? 'quantity' : 'product';
            mapped[`row-${match[1]}-${field}`] = detail.message;
          }
        }
        setFieldErrors(mapped);
      } else {
        setFormError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) return <InlineSpinner label="Loading…" />;
  if (loadError) return <ErrorState error={loadError} onRetry={() => void load()} />;

  return (
    <>
      <div className="page-header">
        <h1>{isEdit ? 'Edit draft challan' : 'New sales challan'}</h1>
        <p>
          Select a customer, add products and quantities. Saving as a draft does not affect stock —
          only confirming does.
        </p>
      </div>

      <form
        className={`card ${styles.form}`}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void submit(false);
        }}
        noValidate
      >
        {formError && (
          <div className={styles.alert} role="alert">
            {formError}
          </div>
        )}

        <SelectField
          id="customerId"
          label="Customer"
          required
          options={customerOptions}
          placeholder="Select a customer…"
          value={customerId}
          onChange={(event) => setCustomerId(event.target.value)}
          error={fieldErrors.customerId}
          disabled={isSubmitting}
        />

        <div>
          <div className={styles.linesHeader}>
            <h3>Products</h3>
            <Button type="button" variant="secondary" small onClick={addRow} disabled={isSubmitting}>
              + Add line
            </Button>
          </div>

          {fieldErrors.items && <div className={styles.lineError}>{fieldErrors.items}</div>}

          <div className={styles.lines}>
            {rows.map((row, index) => {
              const product = productById.get(Number(row.productId));
              const quantity = Number(row.quantity);
              // Warn before the user reaches confirmation and gets a 409.
              const exceedsStock =
                product !== undefined &&
                Number.isFinite(quantity) &&
                quantity > product.currentStock;

              return (
                <div className={styles.line} key={row.key}>
                  <div className={styles.lineProduct}>
                    <SelectField
                      id={`product-${row.key}`}
                      label={`Product ${index + 1}`}
                      options={productOptions}
                      placeholder="Select a product…"
                      value={row.productId}
                      onChange={(event) => updateRow(row.key, { productId: event.target.value })}
                      error={fieldErrors[`row-${index}-product`]}
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className={styles.lineQty}>
                    <label className={styles.qtyLabel} htmlFor={`qty-${row.key}`}>
                      Quantity
                    </label>
                    <input
                      id={`qty-${row.key}`}
                      className={`${styles.qtyInput} ${
                        fieldErrors[`row-${index}-quantity`] ? styles.qtyInputError : ''
                      }`}
                      inputMode="numeric"
                      value={row.quantity}
                      onChange={(event) => updateRow(row.key, { quantity: event.target.value })}
                      disabled={isSubmitting}
                    />
                    {fieldErrors[`row-${index}-quantity`] && (
                      <span className={styles.lineError}>
                        {fieldErrors[`row-${index}-quantity`]}
                      </span>
                    )}
                  </div>

                  <div className={styles.lineInfo}>
                    {product ? (
                      <>
                        <span className={styles.linePrice}>
                          {formatCurrency(product.unitPrice)} each
                        </span>
                        <span className={exceedsStock ? styles.lineWarn : styles.lineStock}>
                          {product.currentStock} in stock
                          {exceedsStock && ' — not enough'}
                        </span>
                        <span className={styles.lineTotal}>
                          {formatCurrency(Number(product.unitPrice) * (quantity || 0))}
                        </span>
                      </>
                    ) : (
                      <span className={styles.lineStock}>—</span>
                    )}
                  </div>

                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => removeRow(row.key)}
                    disabled={rows.length === 1 || isSubmitting}
                    aria-label={`Remove line ${index + 1}`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className={styles.totals}>
          <span>
            Total quantity: <strong>{previewQuantity}</strong>
          </span>
          <span className={styles.grandTotal}>
            Total: <strong>{formatCurrency(previewTotal)}</strong>
          </span>
        </div>

        <TextAreaField
          id="notes"
          label="Notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          hint="Optional. Delivery instructions, reference numbers."
          disabled={isSubmitting}
        />

        <div className={styles.actions}>
          <Button type="submit" variant="secondary" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : isEdit ? 'Save draft' : 'Save as draft'}
          </Button>

          {!isEdit && canConfirm && (
            <Button type="button" onClick={() => void submit(true)} disabled={isSubmitting}>
              {isSubmitting ? 'Working…' : 'Save & confirm (deducts stock)'}
            </Button>
          )}

          <LinkButton to={isEdit ? `/challans/${id}` : '/challans'} variant="secondary">
            Cancel
          </LinkButton>
        </div>
      </form>
    </>
  );
}
