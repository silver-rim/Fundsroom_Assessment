/**
 * Customer list: search, filters, pagination.
 *
 * Filter state lives in the URL query string, so a filtered view can be
 * bookmarked, shared with a colleague, and survives the browser back button.
 */
import { useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listCustomers } from '../../api/customers.api';
import { useApi } from '../../hooks/useApi';
import { useDebounce } from '../../hooks/useDebounce';
import { useAuth } from '../../context/AuthContext';
import { LinkButton } from '../../components/ui/Button';
import { EmptyState, ErrorState, InlineSpinner } from '../../components/ui/States';
import Pagination from '../../components/ui/Pagination';
import { formatDate, isOverdue, todayIso } from '../../utils/format';
import { parsePage } from '../../utils/params';
import {
  CUSTOMER_STATUSES,
  CUSTOMER_STATUS_BADGE,
  CUSTOMER_STATUS_LABELS,
  CUSTOMER_TYPES,
  CUSTOMER_TYPE_LABELS,
  type CustomerStatus,
  type CustomerType,
} from '../../types/customer';
import styles from './CustomersListPage.module.css';

export default function CustomersListPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasRole } = useAuth();
  const canEdit = hasRole('ADMIN', 'SALES');

  const page = parsePage(searchParams.get('page'));
  const search = searchParams.get('search') ?? '';
  const status = (searchParams.get('status') ?? '') as CustomerStatus | '';
  const customerType = (searchParams.get('customerType') ?? '') as CustomerType | '';
  // Set by the "Follow-ups due" toggle and by the dashboard tile that links here.
  const followUpBefore = searchParams.get('followUpBefore') ?? '';

  // Debounced so typing does not fire a request per keystroke.
  const debouncedSearch = useDebounce(search);

  const request = useCallback(
    () =>
      listCustomers({
        page,
        limit: 10,
        search: debouncedSearch,
        status,
        customerType,
        followUpBefore,
        // When the user is working the due list, the most overdue customer is
        // the one they want first — newest-first would bury it.
        sortBy: followUpBefore ? 'followUpDate' : 'createdAt',
        sortOrder: followUpBefore ? 'asc' : 'desc',
      }),
    [page, debouncedSearch, status, customerType, followUpBefore],
  );

  const { data, error, isLoading, refetch } = useApi(request, [
    page,
    debouncedSearch,
    status,
    customerType,
    followUpBefore,
  ]);

  /** Writes a filter into the URL. Any filter change resets to page 1. */
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

  const hasFilters = Boolean(search || status || customerType || followUpBefore);

  const content = useMemo(() => {
    if (isLoading) return <InlineSpinner label="Loading customers…" />;
    if (error) return <ErrorState error={error} onRetry={refetch} />;

    if (!data || data.items.length === 0) {
      return (
        <EmptyState
          title={
            followUpBefore
              ? 'No follow-ups are due'
              : hasFilters
                ? 'No customers match those filters'
                : 'No customers yet'
          }
          message={
            followUpBefore
              ? 'Nothing is scheduled for today or overdue. Clear the filter to see everyone.'
              : hasFilters
                ? 'Try a different search term, or clear the filters to see everyone.'
                : 'Add your first customer to start tracking leads and follow-ups.'
          }
          action={canEdit && !hasFilters ? <LinkButton to="/customers/new">Add customer</LinkButton> : undefined}
        />
      );
    }

    return (
      <>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Business</th>
                <th>Mobile</th>
                <th>Type</th>
                <th>Status</th>
                <th>Follow-up</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <Link to={`/customers/${customer.id}`} className={styles.nameLink}>
                      {customer.name}
                    </Link>
                    <div className={styles.subtle}>{customer.email}</div>
                  </td>
                  <td>{customer.businessName}</td>
                  <td>{customer.mobile}</td>
                  <td>{CUSTOMER_TYPE_LABELS[customer.customerType]}</td>
                  <td>
                    <span className={`badge ${CUSTOMER_STATUS_BADGE[customer.status]}`}>
                      {CUSTOMER_STATUS_LABELS[customer.status]}
                    </span>
                  </td>
                  <td>
                    {customer.followUpDate ? (
                      <span className={isOverdue(customer.followUpDate) ? styles.overdue : ''}>
                        {formatDate(customer.followUpDate)}
                        {isOverdue(customer.followUpDate) && ' • due'}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <Link to={`/customers/${customer.id}`}>View</Link>
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
  }, [data, error, isLoading, refetch, hasFilters, followUpBefore, canEdit, updateParam]);

  return (
    <>
      <div className={styles.header}>
        <div>
          <h1>Customers</h1>
          <p className={styles.subtitle}>
            Leads and accounts, with follow-up history.
            {data ? ` ${data.pagination.total} total.` : ''}
          </p>
        </div>
        {canEdit && <LinkButton to="/customers/new">Add customer</LinkButton>}
      </div>

      <div className={styles.filters}>
        <input
          type="search"
          className={styles.search}
          placeholder="Search name, business, mobile or email…"
          value={search}
          onChange={(event) => updateParam('search', event.target.value)}
          aria-label="Search customers"
        />

        <select
          className={styles.select}
          value={status}
          onChange={(event) => updateParam('status', event.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {CUSTOMER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {CUSTOMER_STATUS_LABELS[value]}
            </option>
          ))}
        </select>

        <select
          className={styles.select}
          value={customerType}
          onChange={(event) => updateParam('customerType', event.target.value)}
          aria-label="Filter by customer type"
        >
          <option value="">All types</option>
          {CUSTOMER_TYPES.map((value) => (
            <option key={value} value={value}>
              {CUSTOMER_TYPE_LABELS[value]}
            </option>
          ))}
        </select>

        <button
          type="button"
          className={`${styles.toggle} ${followUpBefore ? styles.toggleOn : ''}`}
          aria-pressed={Boolean(followUpBefore)}
          onClick={() => updateParam('followUpBefore', followUpBefore ? '' : todayIso())}
        >
          Follow-ups due
        </button>

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
