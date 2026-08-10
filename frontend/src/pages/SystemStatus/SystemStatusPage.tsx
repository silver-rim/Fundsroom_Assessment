/**
 * Phase 1 landing screen.
 *
 * It exists to prove the full chain is wired up — browser -> Vite dev server ->
 * axios API layer -> Express -> PostgreSQL — and to exercise the loading, error
 * and success states of `useApi` before any real screen depends on them.
 *
 * Phase 6 replaces this route with the dashboard; the page stays reachable at
 * /status as a deployment smoke test.
 */
import { getHealth } from '../../api/health.api';
import { config } from '../../config/env';
import { useApi } from '../../hooks/useApi';
import type { HealthStatus } from '../../types/api';
import styles from './SystemStatusPage.module.css';

function formatUptime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function StatusRows({ health }: { health: HealthStatus }): JSX.Element {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'API', value: health.status === 'ok' ? 'Reachable' : 'Degraded' },
    {
      label: 'Database',
      value:
        health.database.status === 'up'
          ? `Connected (${health.database.latencyMs ?? 0} ms)`
          : 'Unreachable',
    },
    { label: 'Environment', value: health.environment },
    { label: 'Uptime', value: formatUptime(health.uptimeSeconds) },
    { label: 'API base URL', value: config.apiBaseUrl },
    { label: 'Server time', value: new Date(health.timestamp).toLocaleString() },
  ];

  return (
    <div className={styles.rows}>
      {rows.map((row) => (
        <div className={styles.row} key={row.label}>
          <span className={styles.label}>{row.label}</span>
          <span className={styles.value}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function SystemStatusPage(): JSX.Element {
  const { data: health, error, isLoading, refetch } = useApi<HealthStatus>(getHealth);

  const isHealthy = health?.status === 'ok' && health.database.status === 'up';

  return (
    // A <div>, not a <main>: this page renders inside AppLayout's <main>, and
    // nesting two main landmarks is invalid and confuses screen readers.
    <div className={styles.page}>
      <section className={`card ${styles.panel}`}>
        <div className={styles.header}>
          <h1>{config.appName}</h1>
          {!isLoading &&
            (isHealthy ? (
              <span className="badge badge--success">Operational</span>
            ) : (
              <span className="badge badge--danger">Unavailable</span>
            ))}
        </div>
        <p className={styles.subtitle}>
          System status &mdash; Phase 1 scaffolding. Sign-in arrives in Phase 2.
        </p>

        {isLoading && (
          <div className={styles.state}>
            <div className={styles.spinner} role="status" aria-label="Checking system status" />
            <span>Contacting the API&hellip;</span>
          </div>
        )}

        {!isLoading && error && (
          <div className={styles.state}>
            <p className={styles.stateTitle}>Could not reach the API</p>
            <div className={styles.errorBox}>
              <strong>{error.code}</strong>
              <br />
              {error.message}
            </div>
            <p>
              Check that the backend is running on <code>{config.apiBaseUrl}</code> and that this
              origin is listed in <code>CORS_ORIGINS</code>.
            </p>
            <button type="button" className={styles.button} onClick={refetch}>
              Retry
            </button>
          </div>
        )}

        {!isLoading && !error && health && <StatusRows health={health} />}

        <p className={styles.footer}>
          Backend: Node.js &middot; TypeScript &middot; Express &middot; PostgreSQL &nbsp;|&nbsp;
          Frontend: React &middot; TypeScript &middot; Vite
        </p>
      </section>
    </div>
  );
}
