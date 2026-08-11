/**
 * The operations dashboard — the landing screen for every signed-in user.
 *
 * Two rules shaped this page:
 *
 *   1. Every number comes from GET /api/dashboard/summary, which recomputes it
 *      from the tables on each request. Nothing here is cached or estimated, so
 *      a figure on this screen and the list behind it can never disagree.
 *   2. Every number is a link, and every action shown is one the signed-in role
 *      is actually allowed to perform. A Warehouse user is not offered "New
 *      challan" only to be bounced by /forbidden.
 */
import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getDashboardSummary } from '../../api/dashboard.api';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import { LinkButton } from '../../components/ui/Button';
import { StatTile, type StatTone } from '../../components/ui/StatTile';
import { ErrorState, InlineSpinner } from '../../components/ui/States';
import { formatCurrency, formatDateTime, todayIso } from '../../utils/format';
import { ROLE_DESCRIPTIONS } from '../../types/auth';
import {
  CHALLAN_STATUS_BADGE,
  CHALLAN_STATUS_LABELS,
} from '../../types/challan';
import { MOVEMENT_TYPE_LABELS } from '../../types/product';
import styles from './DashboardPage.module.css';

export default function DashboardPage(): JSX.Element {
  const { user, hasRole } = useAuth();

  const request = useCallback(() => getDashboardSummary(), []);
  const { data, error, isLoading, refetch } = useApi(request);

  const canSell = hasRole('ADMIN', 'SALES');
  const canStock = hasRole('ADMIN', 'WAREHOUSE');

  const heading = (
    <div className={styles.header}>
      <div>
        <h1>{user ? `Welcome back, ${user.name.split(' ')[0]}` : 'Dashboard'}</h1>
        <p className={styles.subtitle}>
          {user ? ROLE_DESCRIPTIONS[user.role] : ''} Every figure below is computed live.
        </p>
      </div>

      <div className={styles.actions}>
        {canSell && <LinkButton to="/challans/new">New challan</LinkButton>}
        {canSell && (
          <LinkButton to="/customers/new" variant="secondary">
            Add customer
          </LinkButton>
        )}
        {canStock && (
          <LinkButton to="/products/new" variant="secondary">
            Add product
          </LinkButton>
        )}
        <button type="button" className={styles.refresh} onClick={refetch} disabled={isLoading}>
          {isLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
  );

  if (isLoading && !data) {
    return (
      <>
        {heading}
        <InlineSpinner label="Loading dashboard…" />
      </>
    );
  }

  if (error) {
    return (
      <>
        {heading}
        <ErrorState error={error} onRetry={refetch} />
      </>
    );
  }

  if (!data) return heading;

  const { customers, products, challans, lowStockProducts, recentChallans, recentMovements } = data;

  // A count of zero is good news for these two, so they stay neutral instead of
  // shouting in amber at a warehouse that has nothing to reorder.
  const followUpTone: StatTone = customers.followUpsDue > 0 ? 'warning' : 'neutral';
  const lowStockTone: StatTone =
    products.outOfStock > 0 ? 'danger' : products.lowStock > 0 ? 'warning' : 'neutral';

  return (
    <>
      {heading}

      <div className={styles.tiles}>
        <StatTile
          label="Customers"
          value={customers.total}
          hint={`${customers.active} active · ${customers.leads} leads`}
          to="/customers"
        />
        <StatTile
          label="Follow-ups due"
          value={customers.followUpsDue}
          hint={customers.followUpsDue > 0 ? 'Due today or overdue' : 'Nothing outstanding'}
          to={`/customers?followUpBefore=${todayIso()}`}
          tone={followUpTone}
        />
        <StatTile
          label="Products"
          value={products.total}
          hint={`${products.inactive} inactive`}
          to="/products"
        />
        <StatTile
          label="Low stock"
          value={products.lowStock}
          hint={
            products.outOfStock > 0
              ? `${products.outOfStock} out of stock`
              : 'At or below reorder level'
          }
          to="/products?lowStock=true"
          tone={lowStockTone}
        />
        <StatTile
          label="Draft challans"
          value={challans.draft}
          hint="Awaiting confirmation"
          to="/challans?status=DRAFT"
          tone={challans.draft > 0 ? 'warning' : 'neutral'}
        />
        <StatTile
          label="Dispatched this month"
          value={challans.confirmedThisMonth}
          hint={`${formatCurrency(challans.valueThisMonth)} of goods`}
          to="/challans?status=CONFIRMED"
        />
      </div>

      <div className={styles.panels}>
        {/* ---- Needs reordering ------------------------------------------- */}
        <section className="card">
          <div className={styles.panelHeader}>
            <h3>Needs reordering</h3>
            <Link to="/products?lowStock=true">View all</Link>
          </div>

          {lowStockProducts.length === 0 ? (
            <p className={styles.empty}>Every active product is above its reorder level.</p>
          ) : (
            <ul className={styles.list}>
              {lowStockProducts.map((product) => (
                <li className={styles.row} key={product.id}>
                  <div className={styles.rowMain}>
                    <Link to={`/products/${product.id}`}>{product.name}</Link>
                    <span className={styles.meta}>{product.sku}</span>
                  </div>
                  <span
                    className={`badge ${product.currentStock === 0 ? 'badge--danger' : 'badge--warning'}`}
                  >
                    {product.currentStock} / {product.minStockAlert}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- Recent challans -------------------------------------------- */}
        <section className="card">
          <div className={styles.panelHeader}>
            <h3>Recent challans</h3>
            <Link to="/challans">View all</Link>
          </div>

          {recentChallans.length === 0 ? (
            <p className={styles.empty}>
              No challans yet.{' '}
              {canSell ? <Link to="/challans/new">Create the first one.</Link> : null}
            </p>
          ) : (
            <ul className={styles.list}>
              {recentChallans.map((challan) => (
                <li className={styles.row} key={challan.id}>
                  <div className={styles.rowMain}>
                    <Link to={`/challans/${challan.id}`} className={styles.mono}>
                      {challan.challanNumber}
                    </Link>
                    <span className={styles.meta}>
                      {challan.customerName} · {formatCurrency(challan.totalAmount)}
                    </span>
                  </div>
                  <span className={`badge ${CHALLAN_STATUS_BADGE[challan.status]}`}>
                    {CHALLAN_STATUS_LABELS[challan.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- Recent stock movements ------------------------------------- */}
        <section className="card">
          <div className={styles.panelHeader}>
            <h3>Recent stock movements</h3>
            <Link to="/inventory">View ledger</Link>
          </div>

          {recentMovements.length === 0 ? (
            <p className={styles.empty}>The ledger is empty — no stock has moved yet.</p>
          ) : (
            <ul className={styles.list}>
              {recentMovements.map((movement) => (
                <li className={styles.row} key={movement.id}>
                  <div className={styles.rowMain}>
                    <Link to={`/products/${movement.productId}`}>{movement.productName}</Link>
                    <span className={styles.meta}>
                      {formatDateTime(movement.createdAt)} · balance {movement.balanceAfter}
                    </span>
                  </div>
                  <span
                    className={`badge ${movement.movementType === 'IN' ? 'badge--success' : 'badge--info'}`}
                    title={MOVEMENT_TYPE_LABELS[movement.movementType]}
                  >
                    {movement.movementType === 'IN' ? '+' : '−'}
                    {movement.quantity}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
