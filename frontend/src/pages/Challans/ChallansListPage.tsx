/**
 * Sales challan list: search by number or customer, status and date filters.
 */
import { useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listChallans } from '../../api/challans.api';
import { useApi } from '../../hooks/useApi';
import { useDebounce } from '../../hooks/useDebounce';
import { useAuth } from '../../context/AuthContext';
import { LinkButton } from '../../components/ui/Button';
import { EmptyState, ErrorState, InlineSpinner } from '../../components/ui/States';
import Pagination from '../../components/ui/Pagination';
import { formatCurrency, formatDateTime } from '../../utils/format';
import { parsePage } from '../../utils/params';
import {
  CHALLAN_STATUSES,
  CHALLAN_STATUS_BADGE,
  CHALLAN_STATUS_LABELS,
  type ChallanStatus,
} from '../../types/challan';
import styles from './ChallansListPage.module.css';

export default function ChallansListPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasRole } = useAuth();
  const canCreate = hasRole('ADMIN', 'SALES');

  const page = parsePage(searchParams.get('page'));
  const search = searchParams.get('search') ?? '';
  const status = (searchParams.get('status') ?? '') as ChallanStatus | '';
  const dateFrom = searchParams.get('dateFrom') ?? '';
  const dateTo = searchParams.get('dateTo') ?? '';

  const debouncedSearch = useDebounce(search);

  const request = useCallback(
    () =>
      listChallans({
        page,
        limit: 10,
        search: debouncedSearch,
        status,
        dateFrom,
        dateTo,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      }),
    [page, debouncedSearch, status, dateFrom, dateTo],
  );

  const { data, error, isLoading, refetch } = useApi(request, [
    page,
    debouncedSearch,
    status,
    dateFrom,
    dateTo,
  ]);

  const updateParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const hasFilters = Boolean(search || status || dateFrom || dateTo);

  const content = useMemo(() => {
    if (isLoading) return <InlineSpinner label="Loading challans…" />;
    if (error) return <ErrorState error={error} onRetry={refetch} />;

    if (!data || data.items.length === 0) {
      return (
        <EmptyState
          title={hasFilters ? 'No challans match those filters' : 'No sales challans yet'}
          message={
            hasFilters
              ? 'Try a different search or clear the filters.'
              : 'Create a challan to dispatch goods to a customer.'
          }
          action={
            canCreate && !hasFilters ? <LinkButton to="/challans/new">New challan</LinkButton> : undefined
          }
        />
      );
    }

    return (
      <>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Challan</th>
                <th>Customer</th>
                <th className={styles.numeric}>Items</th>
                <th className={styles.numeric}>Qty</th>
                <th className={styles.numeric}>Amount</th>
                <th>Status</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((challan) => (
                <tr key={challan.id}>
                  <td>
                    <Link to={`/challans/${challan.id}`} className={styles.mono}>
                      {challan.challanNumber}
                    </Link>
                  </td>
                  <td>
                    {challan.customer.businessName}
                    <div className={styles.subtle}>{challan.customer.name}</div>
                  </td>
                  <td className={styles.numeric}>{challan.itemCount}</td>
                  <td className={styles.numeric}>{challan.totalQuantity}</td>
                  <td className={styles.numeric}>{formatCurrency(challan.totalAmount)}</td>
                  <td>
                    <span className={`badge ${CHALLAN_STATUS_BADGE[challan.status]}`}>
                      {CHALLAN_STATUS_LABELS[challan.status]}
                    </span>
                  </td>
                  <td>
                    {formatDateTime(challan.createdAt)}
                    <div className={styles.subtle}>{challan.createdBy?.name ?? '—'}</div>
                  </td>
                  <td>
                    <Link to={`/challans/${challan.id}`}>View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination
          pagination={data.pagination}
          isLoading={isLoading}
          onPageChange={(nextPage) => updateParam('page', String(nextPage))}
        />
      </>
    );
  }, [data, error, isLoading, refetch, hasFilters, canCreate, updateParam]);

  return (
    <>
      <div className={styles.header}>
        <div>
          <h1>Sales challans</h1>
          <p className={styles.subtitle}>
            Delivery notes. Confirming one dispatches goods and deducts stock.
            {data ? ` ${data.pagination.total} total.` : ''}
          </p>
        </div>
        {canCreate && <LinkButton to="/challans/new">New challan</LinkButton>}
      </div>

      <div className={styles.filters}>
        <input
          type="search"
          className={styles.search}
          placeholder="Search challan number or customer…"
          value={search}
          onChange={(event) => updateParam('search', event.target.value)}
          aria-label="Search challans"
        />

        <select
          className={styles.select}
          value={status}
          onChange={(event) => updateParam('status', event.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {CHALLAN_STATUSES.map((value) => (
            <option key={value} value={value}>
              {CHALLAN_STATUS_LABELS[value]}
            </option>
          ))}
        </select>

        <label className={styles.dateField}>
          <span>From</span>
          <input
            type="date"
            className={styles.select}
            value={dateFrom}
            onChange={(event) => updateParam('dateFrom', event.target.value)}
          />
        </label>

        <label className={styles.dateField}>
          <span>To</span>
          <input
            type="date"
            className={styles.select}
            value={dateTo}
            onChange={(event) => updateParam('dateTo', event.target.value)}
          />
        </label>

        {hasFilters && (
          <button
            type="button"
            className={styles.clear}
            onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}
          >
            Clear filters
          </button>
        )}
      </div>

      {content}
    </>
  );
}
