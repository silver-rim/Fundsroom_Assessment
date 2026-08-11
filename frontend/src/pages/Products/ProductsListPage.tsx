/**
 * Product list: search, category and low-stock filters, pagination.
 *
 * Filter state lives in the URL, so a view like "low stock in Switchgear" is a
 * shareable address rather than a state someone has to re-create by hand.
 */
import { useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listCategories, listProducts } from '../../api/products.api';
import { useApi } from '../../hooks/useApi';
import { useDebounce } from '../../hooks/useDebounce';
import { useAuth } from '../../context/AuthContext';
import { LinkButton } from '../../components/ui/Button';
import { EmptyState, ErrorState, InlineSpinner } from '../../components/ui/States';
import Pagination from '../../components/ui/Pagination';
import { formatCurrency } from '../../utils/format';
import { parsePage } from '../../utils/params';
import { stockLevel } from '../../types/product';
import styles from './ProductsListPage.module.css';

export default function ProductsListPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasRole } = useAuth();
  const canEdit = hasRole('ADMIN', 'WAREHOUSE');

  const page = parsePage(searchParams.get('page'));
  const search = searchParams.get('search') ?? '';
  const category = searchParams.get('category') ?? '';
  const lowStock = searchParams.get('lowStock') === 'true';
  const isActive = (searchParams.get('isActive') ?? 'true') as 'true' | 'false' | 'all';

  const debouncedSearch = useDebounce(search);

  const request = useCallback(
    () =>
      listProducts({
        page,
        limit: 10,
        search: debouncedSearch,
        category,
        lowStock: lowStock ? 'true' : '',
        isActive,
        sortBy: 'name',
        sortOrder: 'asc',
      }),
    [page, debouncedSearch, category, lowStock, isActive],
  );

  const { data, error, isLoading, refetch } = useApi(request, [
    page,
    debouncedSearch,
    category,
    lowStock,
    isActive,
  ]);

  // Categories rarely change, so this is fetched once rather than per filter.
  const { data: categories } = useApi(listCategories, []);

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

  const hasFilters = Boolean(search || category || lowStock || isActive !== 'true');

  const content = useMemo(() => {
    if (isLoading) return <InlineSpinner label="Loading products…" />;
    if (error) return <ErrorState error={error} onRetry={refetch} />;

    if (!data || data.items.length === 0) {
      return (
        <EmptyState
          title={hasFilters ? 'No products match those filters' : 'No products yet'}
          message={
            hasFilters
              ? 'Try a different search, or clear the filters.'
              : 'Add your first product to start tracking stock.'
          }
          action={
            canEdit && !hasFilters ? <LinkButton to="/products/new">Add product</LinkButton> : undefined
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
                <th>Product</th>
                <th>SKU</th>
                <th>Category</th>
                <th className={styles.numeric}>Unit price</th>
                <th className={styles.numeric}>Stock</th>
                <th className={styles.numeric}>Alert at</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((product) => {
                const level = stockLevel(product);

                return (
                  <tr key={product.id}>
                    <td>
                      <Link to={`/products/${product.id}`} className={styles.nameLink}>
                        {product.name}
                      </Link>
                      <div className={styles.subtle}>{product.location}</div>
                    </td>
                    <td className={styles.mono}>{product.sku}</td>
                    <td>{product.category}</td>
                    <td className={styles.numeric}>{formatCurrency(product.unitPrice)}</td>
                    <td className={`${styles.numeric} ${product.isLowStock ? styles.lowValue : ''}`}>
                      {product.currentStock}
                    </td>
                    <td className={styles.numeric}>{product.minStockAlert}</td>
                    <td>
                      <span className={`badge ${level.badgeClass}`}>{level.label}</span>
                      {!product.isActive && (
                        <span className={`badge badge--neutral ${styles.inactiveBadge}`}>
                          Inactive
                        </span>
                      )}
                    </td>
                    <td>
                      <Link to={`/products/${product.id}`}>View</Link>
                    </td>
                  </tr>
                );
              })}
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
  }, [data, error, isLoading, refetch, hasFilters, canEdit, updateParam]);

  return (
    <>
      <div className={styles.header}>
        <div>
          <h1>Products</h1>
          <p className={styles.subtitle}>
            Product master and current stock levels.
            {data ? ` ${data.pagination.total} shown.` : ''}
          </p>
        </div>
        {canEdit && <LinkButton to="/products/new">Add product</LinkButton>}
      </div>

      <div className={styles.filters}>
        <input
          type="search"
          className={styles.search}
          placeholder="Search name, SKU or category…"
          value={search}
          onChange={(event) => updateParam('search', event.target.value)}
          aria-label="Search products"
        />

        <select
          className={styles.select}
          value={category}
          onChange={(event) => updateParam('category', event.target.value)}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {(categories ?? []).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>

        <select
          className={styles.select}
          value={isActive}
          onChange={(event) => updateParam('isActive', event.target.value)}
          aria-label="Filter by active status"
        >
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
          <option value="all">All products</option>
        </select>

        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={lowStock}
            onChange={(event) => updateParam('lowStock', event.target.checked ? 'true' : '')}
          />
          Low stock only
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
