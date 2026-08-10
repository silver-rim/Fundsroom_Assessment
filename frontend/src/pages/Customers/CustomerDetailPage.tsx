/**
 * Customer detail: full record, follow-up history, add-note form, delete.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import {
  addFollowUp,
  deleteCustomer,
  getCustomer,
  listFollowUps,
} from '../../api/customers.api';
import { useAuth } from '../../context/AuthContext';
import { Button, LinkButton } from '../../components/ui/Button';
import { TextAreaField, TextField } from '../../components/ui/Field';
import { EmptyState, ErrorState, InlineSpinner, SuccessBanner } from '../../components/ui/States';
import { formatDate, formatDateTime, isOverdue } from '../../utils/format';
import {
  CUSTOMER_STATUS_BADGE,
  CUSTOMER_STATUS_LABELS,
  CUSTOMER_TYPE_LABELS,
  type Customer,
  type FollowUp,
} from '../../types/customer';
import styles from './CustomerDetailPage.module.css';

export default function CustomerDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const customerId = Number(id);
  const navigate = useNavigate();
  const location = useLocation();
  const { hasRole } = useAuth();

  const canEdit = hasRole('ADMIN', 'SALES');
  const canDelete = hasRole('ADMIN');
  const canSeeFollowUps = hasRole('ADMIN', 'SALES', 'ACCOUNTS');
  const canAddFollowUp = hasRole('ADMIN', 'SALES');

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  // Flash message handed over by the form page after a successful save.
  const [flash, setFlash] = useState<string | null>(
    (location.state as { flash?: string } | null)?.flash ?? null,
  );

  const [note, setNote] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const record = await getCustomer(customerId);
      setCustomer(record);

      // Follow-ups are a separate endpoint with its own permission group, so a
      // role that cannot read them still gets the customer record.
      if (canSeeFollowUps) {
        const history = await listFollowUps(customerId, { limit: 50 });
        setFollowUps(history.items);
      }
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught : new ApiError('Failed to load customer', 0, 'UNKNOWN'),
      );
    } finally {
      setIsLoading(false);
    }
  }, [customerId, canSeeFollowUps]);

  useEffect(() => {
    void load();
  }, [load]);

  // Clear the flash from history so a refresh does not show it again.
  useEffect(() => {
    if (flash) navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash]);

  async function handleAddNote(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setNoteError(null);

    if (note.trim().length === 0) {
      setNoteError('Note is required');
      return;
    }

    setIsSavingNote(true);

    try {
      await addFollowUp(customerId, {
        note: note.trim(),
        ...(nextDate ? { nextFollowUpDate: nextDate } : {}),
      });

      setNote('');
      setNextDate('');
      setFlash('Follow-up note added.');
      // Reload so the customer's own follow-up date reflects the new note.
      await load();
    } catch (caught) {
      setNoteError(
        caught instanceof ApiError ? caught.message : 'Could not save the note. Please try again.',
      );
    } finally {
      setIsSavingNote(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!window.confirm('Delete this customer? They will be hidden from all lists.')) return;

    setIsDeleting(true);

    try {
      await deleteCustomer(customerId);
      navigate('/customers', { replace: true, state: { flash: 'Customer deleted.' } });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught : new ApiError('Failed to delete', 0, 'UNKNOWN'),
      );
      setIsDeleting(false);
    }
  }

  if (isLoading) return <InlineSpinner label="Loading customer…" />;
  if (error) return <ErrorState error={error} onRetry={() => void load()} />;
  if (!customer) return <ErrorState error={new Error('Customer not found')} />;

  const details: Array<{ label: string; value: string; danger?: boolean }> = [
    { label: 'Business name', value: customer.businessName },
    { label: 'Mobile', value: customer.mobile },
    { label: 'Email', value: customer.email },
    { label: 'Customer type', value: CUSTOMER_TYPE_LABELS[customer.customerType] },
    { label: 'GST number', value: customer.gstNumber ?? '—' },
    {
      label: 'Next follow-up',
      value: formatDate(customer.followUpDate),
      danger: isOverdue(customer.followUpDate),
    },
    { label: 'Address', value: customer.address },
    { label: 'Added by', value: customer.createdBy?.name ?? '—' },
    { label: 'Created', value: formatDateTime(customer.createdAt) },
    { label: 'Last updated', value: formatDateTime(customer.updatedAt) },
  ];

  return (
    <>
      {flash && <SuccessBanner message={flash} onDismiss={() => setFlash(null)} />}

      <div className={styles.header}>
        <div>
          <div className={styles.titleRow}>
            <h1>{customer.name}</h1>
            <span className={`badge ${CUSTOMER_STATUS_BADGE[customer.status]}`}>
              {CUSTOMER_STATUS_LABELS[customer.status]}
            </span>
          </div>
          <p className={styles.subtitle}>{customer.businessName}</p>
        </div>

        <div className={styles.headerActions}>
          <LinkButton to="/customers" variant="secondary">
            Back to list
          </LinkButton>
          {canEdit && <LinkButton to={`/customers/${customer.id}/edit`}>Edit</LinkButton>}
          {canDelete && (
            <Button type="button" variant="danger" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting…' : 'Delete'}
            </Button>
          )}
        </div>
      </div>

      <div className={styles.columns}>
        <section className="card">
          <h3 className={styles.sectionTitle}>Customer details</h3>
          <dl className={styles.details}>
            {details.map((detail) => (
              <div className={styles.detailRow} key={detail.label}>
                <dt className={styles.detailLabel}>{detail.label}</dt>
                <dd className={`${styles.detailValue} ${detail.danger ? styles.danger : ''}`}>
                  {detail.value}
                </dd>
              </div>
            ))}
          </dl>

          {customer.notes && (
            <div className={styles.notesBlock}>
              <div className={styles.detailLabel}>Notes</div>
              <p className={styles.notesText}>{customer.notes}</p>
            </div>
          )}
        </section>

        {canSeeFollowUps && (
          <section className="card">
            <h3 className={styles.sectionTitle}>Follow-up history</h3>

            {canAddFollowUp && (
              <form className={styles.noteForm} onSubmit={handleAddNote}>
                <TextAreaField
                  id="note"
                  label="Add a follow-up note"
                  required
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  error={noteError ?? undefined}
                  placeholder="What was discussed?"
                  disabled={isSavingNote}
                />
                <TextField
                  id="nextFollowUpDate"
                  label="Next follow-up date"
                  type="date"
                  value={nextDate}
                  onChange={(event) => setNextDate(event.target.value)}
                  hint="Optional. Setting this also updates the customer's follow-up date."
                  disabled={isSavingNote}
                />
                <Button type="submit" small disabled={isSavingNote}>
                  {isSavingNote ? 'Saving…' : 'Add note'}
                </Button>
              </form>
            )}

            {followUps.length === 0 ? (
              <EmptyState
                title="No follow-ups yet"
                message={
                  canAddFollowUp
                    ? 'Log the first call or visit using the form above.'
                    : 'Nothing has been logged for this customer.'
                }
              />
            ) : (
              <ol className={styles.timeline}>
                {followUps.map((entry) => (
                  <li key={entry.id} className={styles.timelineItem}>
                    <div className={styles.timelineMeta}>
                      <span className={styles.timelineAuthor}>
                        {entry.createdBy?.name ?? 'Unknown'}
                      </span>
                      <span className={styles.timelineDate}>{formatDateTime(entry.createdAt)}</span>
                    </div>
                    <p className={styles.timelineNote}>{entry.note}</p>
                    {entry.nextFollowUpDate && (
                      <span className="badge badge--info">
                        Next: {formatDate(entry.nextFollowUpDate)}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </div>
    </>
  );
}
