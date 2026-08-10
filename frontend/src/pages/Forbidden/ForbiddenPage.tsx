import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ROLE_LABELS } from '../../types/auth';

/** Shown when RoleRoute blocks a screen the signed-in role may not open. */
export default function ForbiddenPage(): JSX.Element {
  const { user } = useAuth();

  return (
    <div className="card" style={{ maxWidth: '520px' }}>
      <span className="badge badge--danger">403 &mdash; Forbidden</span>
      <h2 style={{ marginTop: 'var(--space-4)' }}>You do not have access to that page</h2>
      <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
        {user
          ? `Your role (${ROLE_LABELS[user.role]}) is not permitted to view it. If you need access, ask an administrator.`
          : 'Sign in to continue.'}
      </p>
      <p style={{ marginTop: 'var(--space-5)' }}>
        <Link to="/">Back to home</Link>
      </p>
    </div>
  );
}
