/**
 * Route guards.
 *
 * These improve the experience — they do not provide security. Anyone can call
 * the API directly, so the backend enforces the same rules independently with
 * `authenticate` and `authorize`. Hiding a screen the user cannot use is a
 * courtesy; refusing the request is the control.
 */
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Role } from '../types/auth';
import FullPageSpinner from '../components/FullPageSpinner';

/** Requires any authenticated user. */
export function ProtectedRoute(): JSX.Element {
  const { isAuthenticated, isInitialising } = useAuth();
  const location = useLocation();

  // Without this the app would flash the login screen on every refresh while
  // the stored token is still being verified.
  if (isInitialising) return <FullPageSpinner label="Restoring your session…" />;

  if (!isAuthenticated) {
    // `state.from` lets the login screen return the user where they were going.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

/** Requires one of the given roles. Must sit inside a ProtectedRoute. */
export function RoleRoute({ allow }: { allow: readonly Role[] }): JSX.Element {
  const { user, isInitialising } = useAuth();

  if (isInitialising) return <FullPageSpinner label="Restoring your session…" />;

  if (!user) return <Navigate to="/login" replace />;

  if (!allow.includes(user.role)) {
    return <Navigate to="/forbidden" replace />;
  }

  return <Outlet />;
}
