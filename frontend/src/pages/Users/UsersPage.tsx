/**
 * Admin-only user list.
 *
 * Exists to make role-based access observable end to end: the sidebar link is
 * hidden for non-Admin roles, RoleRoute blocks the URL, and the API answers 403
 * even if both are bypassed.
 */
import { listUsers } from '../../api/users.api';
import { useApi } from '../../hooks/useApi';
import FullPageSpinner from '../../components/FullPageSpinner';
import { ROLE_LABELS, type AuthUser } from '../../types/auth';

export default function UsersPage(): JSX.Element {
  const { data: users, error, isLoading, refetch } = useApi<AuthUser[]>(listUsers);

  if (isLoading) return <FullPageSpinner label="Loading users…" />;

  if (error) {
    return (
      <>
        <div className="page-header">
          <h1>Users</h1>
        </div>
        <div className="card">
          <h3>Could not load users</h3>
          <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
            {error.message}
          </p>
          <button type="button" onClick={refetch} style={{ marginTop: 'var(--space-4)' }}>
            Retry
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1>Users</h1>
        <p>Employee accounts with access to the portal. Read-only in this version.</p>
      </div>

      {!users || users.length === 0 ? (
        <div className="card">
          <p>No user accounts found.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.id}</td>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  <td>{ROLE_LABELS[user.role]}</td>
                  <td>
                    <span className={`badge ${user.isActive ? 'badge--success' : 'badge--neutral'}`}>
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
