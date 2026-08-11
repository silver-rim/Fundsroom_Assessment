import { Link, useLocation } from 'react-router-dom';

/**
 * Shown for any unknown path inside the app shell.
 *
 * Earlier this was a silent redirect to `/`. That quietly hides the mistake:
 * a mistyped or stale bookmark looked exactly like a working link that decided
 * to go somewhere else. Saying what happened, and echoing the path that missed,
 * is more useful than pretending nothing did.
 */
export default function NotFoundPage(): JSX.Element {
  const location = useLocation();

  return (
    <div className="card" style={{ maxWidth: '520px' }}>
      <span className="badge badge--neutral">404 &mdash; Not found</span>
      <h2 style={{ marginTop: 'var(--space-4)' }}>That page does not exist</h2>
      <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
        Nothing is served at <code>{location.pathname}</code>. The link may be out of date, or the
        record it pointed to may have been removed.
      </p>
      <p style={{ marginTop: 'var(--space-5)' }}>
        <Link to="/">Back to the dashboard</Link>
      </p>
    </div>
  );
}
