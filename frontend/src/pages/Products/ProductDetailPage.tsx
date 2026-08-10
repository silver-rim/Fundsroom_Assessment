/**
 * Product detail: full record, stock movement form, and the movement ledger.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import {
  getProduct,
  listProductMovements,
  recordStockMovement,
  setProductStatus,
} from '../../api/products.api';
import { useAuth } from '../../context/AuthContext';
import { Button, LinkButton } from '../../components/ui/Button';
import { SelectField, TextField } from '../../components/ui/Field';
import { EmptyState, ErrorState, InlineSpinner, SuccessBanner } from '../../components/ui/States';
import { formatCurrency, formatDateTime } from '../../utils/format';
import {
  MOVEMENT_REFERENCE_LABELS,
  stockLevel,
  type MovementType,
  type Product,
  type StockMovement,
} from '../../types/product';
import styles from './ProductDetailPage.module.css';

const MOVEMENT_OPTIONS = [
  { value: 'IN', label: 'Stock in (receive)' },
  { value: 'OUT', label: 'Stock out (issue / write off)' },
];

export default function ProductDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const productId = Number(id);
  const navigate = useNavigate();
  const location = useLocation();
  const { hasRole } = useAuth();

  const canEdit = hasRole('ADMIN', 'WAREHOUSE');

  const [product, setProduct] = useState<Product | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const [flash, setFlash] = useState<string | null>(
    (location.state as { flash?: string } | null)?.flash ?? null,
  );

  const [movementType, setMovementType] = useState<MovementType>('IN');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [movementErrors, setMovementErrors] = useState<Record<string, string>>({});
  const [movementError, setMovementError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [record, history] = await Promise.all([
        getProduct(productId),
        listProductMovements(productId, { limit: 50 }),
      ]);
      setProduct(record);
      setMovements(history.items);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught : new ApiError('Failed to load product', 0, 'UNKNOWN'),
      );
    } finally {
      setIsLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (flash) navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash]);

  async function handleRecordMovement(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMovementError(null);

    const errors: Record<string, string> = {};
    if (!/^\d+$/.test(quantity.trim()) || Number(quantity) <= 0)
      errors.quantity = 'Enter a whole number greater than zero';
    if (reason.trim().length < 3) errors.reason = 'Reason must be at least 3 characters';

    setMovementErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsSaving(true);

    try {
      const movement = await recordStockMovement({
        productId,
        movementType,
        quantity: Number(quantity),
        reason: reason.trim(),
      });

      setQuantity('');
      setReason('');
      setFlash(
        `${movementType === 'IN' ? 'Received' : 'Issued'} ${movement.quantity} units. New balance: ${movement.balanceAfter}.`,
      );
      await load();
    } catch (caught) {
      if (caught instanceof ApiError) {
        // Insufficient stock arrives as a 409 with a message naming the real
        // numbers — surface it as-is rather than a generic failure.
        setMovementError(caught.message);
        if (caught.details.length > 0) {
          const mapped: Record<string, string> = {};
          for (const detail of caught.details) {
            mapped[detail.field.replace(/^body\./, '')] = detail.message;
          }
          setMovementErrors(mapped);
        }
      } else {
        setMovementError('Could not record the movement. Please try again.');
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleStatus(): Promise<void> {
    if (!product) return;

    setIsTogglingStatus(true);

    try {
      const updated = await setProductStatus(productId, !product.isActive);
      setProduct(updated);
      setFlash(updated.isActive ? 'Product reactivated.' : 'Product deactivated.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError('Failed', 0, 'UNKNOWN'));
    } finally {
      setIsTogglingStatus(false);
    }
  }

  if (isLoading) return <InlineSpinner label="Loading product…" />;
  if (error) return <ErrorState error={error} onRetry={() => void load()} />;
  if (!product) return <ErrorState error={new Error('Product not found')} />;

  const level = stockLevel(product);

  const details: Array<{ label: string; value: string }> = [
    { label: 'SKU', value: product.sku },
    { label: 'Category', value: product.category },
    { label: 'Unit price', value: formatCurrency(product.unitPrice) },
    { label: 'Location', value: product.location },
    { label: 'Minimum stock alert', value: String(product.minStockAlert) },
    { label: 'Added by', value: product.createdBy?.name ?? '—' },
    { label: 'Created', value: formatDateTime(product.createdAt) },
    { label: 'Last updated', value: formatDateTime(product.updatedAt) },
  ];

  return (
    <>
      {flash && <SuccessBanner message={flash} onDismiss={() => setFlash(null)} />}

      <div className={styles.header}>
        <div>
          <div className={styles.titleRow}>
            <h1>{product.name}</h1>
            <span className={`badge ${level.badgeClass}`}>{level.label}</span>
            {!product.isActive && <span className="badge badge--neutral">Inactive</span>}
          </div>
          <p className={styles.subtitle}>
            {product.sku} &middot; {product.category}
          </p>
        </div>

        <div className={styles.headerActions}>
          <LinkButton to="/products" variant="secondary">
            Back to list
          </LinkButton>
          {canEdit && <LinkButton to={`/products/${product.id}/edit`}>Edit</LinkButton>}
          {canEdit && (
            <Button
              type="button"
              variant={product.isActive ? 'danger' : 'secondary'}
              onClick={handleToggleStatus}
              disabled={isTogglingStatus}
            >
              {isTogglingStatus ? 'Saving…' : product.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>
          )}
        </div>
      </div>

      <div className={styles.stockRow}>
        <div className={`card ${styles.stockCard}`}>
          <span className={styles.stockLabel}>Current stock</span>
          <span className={`${styles.stockValue} ${product.isLowStock ? styles.stockLow : ''}`}>
            {product.currentStock}
          </span>
          {product.isLowStock && (
            <span className={styles.stockHint}>
              At or below the alert level of {product.minStockAlert}
            </span>
          )}
        </div>

        <div className={`card ${styles.stockCard}`}>
          <span className={styles.stockLabel}>Stock value</span>
          <span className={styles.stockValue}>
            {formatCurrency(Number(product.unitPrice) * product.currentStock)}
          </span>
          <span className={styles.stockHint}>At the current unit price</span>
        </div>
      </div>

      <div className={styles.columns}>
        <section className="card">
          <h3 className={styles.sectionTitle}>Product details</h3>
          <dl className={styles.details}>
            {details.map((detail) => (
              <div className={styles.detailRow} key={detail.label}>
                <dt className={styles.detailLabel}>{detail.label}</dt>
                <dd className={styles.detailValue}>{detail.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="card">
          <h3 className={styles.sectionTitle}>Stock movements</h3>

          {canEdit && (
            <form className={styles.movementForm} onSubmit={handleRecordMovement}>
              {movementError && (
                <div className={styles.alert} role="alert">
                  {movementError}
                </div>
              )}

              <SelectField
                id="movementType"
                label="Movement type"
                required
                options={MOVEMENT_OPTIONS}
                value={movementType}
                onChange={(event) => setMovementType(event.target.value as MovementType)}
                disabled={isSaving}
              />

              <TextField
                id="quantity"
                label="Quantity"
                required
                inputMode="numeric"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                error={movementErrors.quantity}
                disabled={isSaving}
              />

              <TextField
                id="reason"
                label="Reason"
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                error={movementErrors.reason}
                hint="e.g. Goods received GRN 4471, Damaged in transit"
                disabled={isSaving}
              />

              <Button type="submit" small disabled={isSaving}>
                {isSaving ? 'Recording…' : 'Record movement'}
              </Button>
            </form>
          )}

          {movements.length === 0 ? (
            <EmptyState
              title="No stock movements yet"
              message="Every change to this product's stock will be listed here."
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Type</th>
                    <th className={styles.numeric}>Qty</th>
                    <th className={styles.numeric}>Balance</th>
                    <th>Reason</th>
                    <th>By</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((movement) => (
                    <tr key={movement.id}>
                      <td>{formatDateTime(movement.createdAt)}</td>
                      <td>
                        <span
                          className={`badge ${
                            movement.movementType === 'IN' ? 'badge--success' : 'badge--warning'
                          }`}
                        >
                          {movement.movementType}
                        </span>
                      </td>
                      <td className={styles.numeric}>
                        {movement.movementType === 'IN' ? '+' : '−'}
                        {movement.quantity}
                      </td>
                      <td className={styles.numeric}>{movement.balanceAfter}</td>
                      <td>{movement.reason}</td>
                      <td>{movement.createdBy?.name ?? '—'}</td>
                      <td>{MOVEMENT_REFERENCE_LABELS[movement.referenceType]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
