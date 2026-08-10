/**
 * Challan detail — reads like the delivery note it represents.
 *
 * Line items come from the SNAPSHOT columns, so this page shows what was
 * actually sold at what price, even if the product has since been renamed or
 * repriced.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { cancelChallan, confirmChallan, getChallan } from '../../api/challans.api';
import { useAuth } from '../../context/AuthContext';
import { Button, LinkButton } from '../../components/ui/Button';
import { ErrorState, InlineSpinner, SuccessBanner } from '../../components/ui/States';
import { formatCurrency, formatDateTime } from '../../utils/format';
import {
  CHALLAN_STATUS_BADGE,
  CHALLAN_STATUS_LABELS,
  type Challan,
} from '../../types/challan';
import styles from './ChallanDetailPage.module.css';

export default function ChallanDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const challanId = Number(id);
  const navigate = useNavigate();
  const location = useLocation();
  const { hasRole } = useAuth();

  const canEdit = hasRole('ADMIN', 'SALES');
  const canConfirm = hasRole('ADMIN', 'SALES', 'WAREHOUSE');
  const canCancel = hasRole('ADMIN', 'SALES');

  const [challan, setChallan] = useState<Challan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const [flash, setFlash] = useState<string | null>(
    (location.state as { flash?: string } | null)?.flash ?? null,
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setChallan(await getChallan(challanId));
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught : new ApiError('Failed to load challan', 0, 'UNKNOWN'),
      );
    } finally {
      setIsLoading(false);
    }
  }, [challanId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (flash) navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash]);

  async function handleConfirm(): Promise<void> {
    if (
      !window.confirm(
        'Confirm this challan? Stock will be deducted for every line and this cannot be undone.',
      )
    )
      return;

    setActionError(null);
    setIsWorking(true);

    try {
      const updated = await confirmChallan(challanId);
      setChallan(updated);
      setFlash(`Challan ${updated.challanNumber} confirmed. Stock has been deducted.`);
    } catch (caught) {
      // Insufficient stock arrives here as a 409 listing every failing line.
      setActionError(
        caught instanceof ApiError ? caught : new ApiError('Confirmation failed', 0, 'UNKNOWN'),
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function handleCancel(): Promise<void> {
    const reason = window.prompt('Why is this challan being cancelled? (optional)');
    if (reason === null) return;

    setActionError(null);
    setIsWorking(true);

    try {
      const updated = await cancelChallan(challanId, reason.trim() || undefined);
      setChallan(updated);
      setFlash(`Challan ${updated.challanNumber} cancelled. No stock was affected.`);
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? caught : new ApiError('Cancellation failed', 0, 'UNKNOWN'),
      );
    } finally {
      setIsWorking(false);
    }
  }

  if (isLoading) return <InlineSpinner label="Loading challan…" />;
  if (error) return <ErrorState error={error} onRetry={() => void load()} />;
  if (!challan) return <ErrorState error={new Error('Challan not found')} />;

  const isDraft = challan.status === 'DRAFT';

  return (
    <>
      {flash && <SuccessBanner message={flash} onDismiss={() => setFlash(null)} />}

      <div className={styles.header}>
        <div>
          <div className={styles.titleRow}>
            <h1 className={styles.mono}>{challan.challanNumber}</h1>
            <span className={`badge ${CHALLAN_STATUS_BADGE[challan.status]}`}>
              {CHALLAN_STATUS_LABELS[challan.status]}
            </span>
          </div>
          <p className={styles.subtitle}>
            {challan.customer.businessName} &middot; created {formatDateTime(challan.createdAt)} by{' '}
            {challan.createdBy?.name ?? '—'}
          </p>
        </div>

        <div className={styles.headerActions}>
          <LinkButton to="/challans" variant="secondary">
            Back to list
          </LinkButton>
          {isDraft && canEdit && (
            <LinkButton to={`/challans/${challan.id}/edit`} variant="secondary">
              Edit draft
            </LinkButton>
          )}
          {isDraft && canCancel && (
            <Button type="button" variant="danger" onClick={handleCancel} disabled={isWorking}>
              Cancel challan
            </Button>
          )}
          {isDraft && canConfirm && (
            <Button type="button" onClick={handleConfirm} disabled={isWorking}>
              {isWorking ? 'Confirming…' : 'Confirm & deduct stock'}
            </Button>
          )}
        </div>
      </div>

      {isDraft && (
        <div className={styles.draftNotice}>
          This challan is a <strong>draft</strong>. Stock has <strong>not</strong> been deducted yet.
          Confirming will reduce stock for every line and record an OUT movement against each
          product.
        </div>
      )}

      {actionError && (
        <div className={styles.actionError} role="alert">
          <strong>{actionError.message}</strong>
          {actionError.details.length > 0 && (
            <ul className={styles.errorList}>
              {actionError.details.map((detail) => (
                <li key={detail.field}>{detail.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={styles.columns}>
        <section className="card">
          <h3 className={styles.sectionTitle}>Line items</h3>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th className={styles.numeric}>Unit price</th>
                  <th className={styles.numeric}>Qty</th>
                  <th className={styles.numeric}>Line total</th>
                  {isDraft && <th className={styles.numeric}>In stock</th>}
                </tr>
              </thead>
              <tbody>
                {challan.items.map((item) => {
                  const short =
                    isDraft &&
                    item.availableStock !== undefined &&
                    item.availableStock < item.quantity;

                  return (
                    <tr key={item.id}>
                      <td>
                        <Link to={`/products/${item.productId}`}>{item.productName}</Link>
                      </td>
                      <td className={styles.mono}>{item.productSku}</td>
                      <td className={styles.numeric}>{formatCurrency(item.unitPrice)}</td>
                      <td className={styles.numeric}>{item.quantity}</td>
                      <td className={styles.numeric}>{formatCurrency(item.lineTotal)}</td>
                      {isDraft && (
                        <td className={`${styles.numeric} ${short ? styles.short : ''}`}>
                          {item.availableStock ?? '—'}
                          {short && ' ⚠'}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className={styles.totalLabel}>
                    Total
                  </td>
                  <td className={styles.numeric}>
                    <strong>{challan.totalQuantity}</strong>
                  </td>
                  <td className={styles.numeric}>
                    <strong>{formatCurrency(challan.totalAmount)}</strong>
                  </td>
                  {isDraft && <td />}
                </tr>
              </tfoot>
            </table>
          </div>

          {challan.status === 'CONFIRMED' && (
            <p className={styles.snapshotNote}>
              These line details are a snapshot taken when the challan was confirmed. They will not
              change if a product is later renamed or repriced.
            </p>
          )}
        </section>

        <div className={styles.sideColumn}>
          <section className="card">
            <h3 className={styles.sectionTitle}>Customer</h3>
            <dl className={styles.details}>
              <div className={styles.detailRow}>
                <dt className={styles.detailLabel}>Business</dt>
                <dd className={styles.detailValue}>
                  <Link to={`/customers/${challan.customer.id}`}>
                    {challan.customer.businessName}
                  </Link>
                </dd>
              </div>
              <div className={styles.detailRow}>
                <dt className={styles.detailLabel}>Contact</dt>
                <dd className={styles.detailValue}>{challan.customer.name}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt className={styles.detailLabel}>Mobile</dt>
                <dd className={styles.detailValue}>{challan.customer.mobile}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt className={styles.detailLabel}>GST</dt>
                <dd className={styles.detailValue}>{challan.customer.gstNumber ?? '—'}</dd>
              </div>
            </dl>
          </section>

          <section className="card">
            <h3 className={styles.sectionTitle}>Audit trail</h3>
            <dl className={styles.details}>
              <div className={styles.detailRow}>
                <dt className={styles.detailLabel}>Created</dt>
                <dd className={styles.detailValue}>
                  {formatDateTime(challan.createdAt)}
                  <div className={styles.subtle}>{challan.createdBy?.name ?? '—'}</div>
                </dd>
              </div>
              {challan.confirmedAt && (
                <div className={styles.detailRow}>
                  <dt className={styles.detailLabel}>Confirmed</dt>
                  <dd className={styles.detailValue}>
                    {formatDateTime(challan.confirmedAt)}
                    <div className={styles.subtle}>{challan.confirmedBy?.name ?? '—'}</div>
                  </dd>
                </div>
              )}
              {challan.cancelledAt && (
                <div className={styles.detailRow}>
                  <dt className={styles.detailLabel}>Cancelled</dt>
                  <dd className={styles.detailValue}>
                    {formatDateTime(challan.cancelledAt)}
                    <div className={styles.subtle}>{challan.cancelledBy?.name ?? '—'}</div>
                  </dd>
                </div>
              )}
            </dl>

            {challan.notes && (
              <div className={styles.notesBlock}>
                <div className={styles.detailLabel}>Notes</div>
                <p className={styles.notesText}>{challan.notes}</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
