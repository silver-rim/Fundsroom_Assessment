/**
 * The global stock ledger — every movement across every product.
 *
 * This is the audit view: "who took 50 units out and why?" is answerable here
 * without opening each product in turn.
 */
import { useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listStockMovements } from '../../api/products.api';
import { useApi } from '../../hooks/useApi';
import { EmptyState, ErrorState, InlineSpinner } from '../../components/ui/States';
import Pagination from '../../components/ui/Pagination';
import { formatDateTime } from '../../utils/format';
import { parsePage } from '../../utils/params';
import {
  MOVEMENT_REFERENCE_LABELS,
  MOVEMENT_REFERENCE_TYPES,
  MOVEMENT_TYPES,
  type MovementReferenceType,
  type MovementType,
} from '../../types/product';
import styles from './StockMovementsPage.module.css';

export default function StockMovementsPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();

  const page = parsePage(searchParams.get('page'));
  const movementType = (searchParams.get('movementType') ?? '') as MovementType | '';
  const referenceType = (searchParams.get('referenceType') ?? '') as MovementReferenceType | '';
  const dateFrom = searchParams.get('dateFrom') ?? '';
  const dateTo = searchParams.get('dateTo') ?? '';

  const request = useCallback(
    () =>
      listStockMovements({
        page,
        limit: 20,
        movementType,
        referenceType,
        dateFrom,
        dateTo,
      }),
    [page, movementType, referenceType, dateFrom, dateTo],
  );

  const { data, error, isLoading, refetch } = useApi(request, [
    page,
    movementType,
    referenceType,
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

  const hasFilters = Boolean(movementType || referenceType || dateFrom || dateTo);

  const content = useMemo(() => {
    if (isLoading) return <InlineSpinner label="Loading stock movements…" />;
    if (error) return <ErrorState error={error} onRetry={refetch} />;

    if (!data || data.items.length === 0) {
      return (
        <EmptyState
          title={hasFilters ? 'No movements match those filters' : 'No stock movements yet'}
          message={
            hasFilters
              ? 'Try widening the date range or clearing the filters.'
              : 'Movements appear here as stock is received, issued or dispatched on a challan.'
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
                <th>When</th>
                <th>Product</th>
                <th>Type</th>
                <th className={styles.numeric}>Qty</th>
                <th className={styles.numeric}>Balance after</th>
                <th>Reason</th>
                <th>By</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((movement) => (
                <tr key={movement.id}>
                  <td>{formatDateTime(movement.createdAt)}</td>
                  <td>
                    <Link to={`/products/${movement.productId}`}>{movement.productName}</Link>
                    <div className={styles.mono}>{movement.productSku}</div>
                  </td>
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

        <Pagination
          pagination={data.pagination}
          isLoading={isLoading}
          onPageChange={(nextPage) => updateParam('page', String(nextPage))}
        />
      </>
    );
  }, [data, error, isLoading, refetch, hasFilters, updateParam]);

  return (
    <>
      <div className="page-header">
        <h1>Inventory ledger</h1>
        <p>
          Every stock change, appended and never edited.
          {data ? ` ${data.pagination.total} movements.` : ''}
        </p>
      </div>

      <div className={styles.filters}>
        <select
          className={styles.select}
          value={movementType}
          onChange={(event) => updateParam('movementType', event.target.value)}
          aria-label="Filter by movement type"
        >
          <option value="">All movements</option>
          {MOVEMENT_TYPES.map((value) => (
            <option key={value} value={value}>
              {value === 'IN' ? 'Stock in' : 'Stock out'}
            </option>
          ))}
        </select>

        <select
          className={styles.select}
          value={referenceType}
          onChange={(event) => updateParam('referenceType', event.target.value)}
          aria-label="Filter by source"
        >
          <option value="">All sources</option>
          {MOVEMENT_REFERENCE_TYPES.map((value) => (
            <option key={value} value={value}>
              {MOVEMENT_REFERENCE_LABELS[value]}
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
