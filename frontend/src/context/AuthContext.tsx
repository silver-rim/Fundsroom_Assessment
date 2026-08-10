/**
 * Authentication state.
 *
 * The only global state in the app. Everything else is fetched per screen.
 *
 * The token lives in localStorage so a page refresh does not sign the user out.
 * That is vulnerable to XSS; an httpOnly cookie would be stronger but needs
 * CSRF protection and a cross-origin cookie setup between Vercel and Render.
 * The trade-off is recorded in docs/AUTHENTICATION.md rather than hidden.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AUTH_TOKEN_KEY } from '../api/client';
import * as authApi from '../api/auth.api';
import type { AuthUser, Role } from '../types/auth';

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** True while a stored token is being exchanged for a profile on first load. */
  isInitialising: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** True when the signed-in user holds any of the given roles. */
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isInitialising, setIsInitialising] = useState(true);

  // On first load, turn a stored token back into a session. The profile is
  // fetched from the server rather than decoded from the token, so a revoked or
  // stale token cannot produce a phantom logged-in UI.
  useEffect(() => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);

    if (!token) {
      setIsInitialising(false);
      return;
    }

    let isActive = true;

    authApi
      .getMe()
      .then((profile) => {
        if (isActive) setUser(profile);
      })
      .catch(() => {
        // Token is expired or invalid. Drop it and fall back to signed-out.
        if (isActive) {
          localStorage.removeItem(AUTH_TOKEN_KEY);
          setUser(null);
        }
      })
      .finally(() => {
        if (isActive) setIsInitialising(false);
      });

    return () => {
      isActive = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    // Store the token before setting the user, so any request triggered by the
    // resulting re-render already carries the Authorization header.
    localStorage.setItem(AUTH_TOKEN_KEY, result.token);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setUser(null);
    // No redirect needed: ProtectedRoute sees a null user and sends the browser
    // to /login on the next render.
  }, []);

  const hasRole = useCallback(
    (...roles: Role[]) => (user ? roles.includes(user.role) : false),
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isInitialising,
      login,
      logout,
      hasRole,
    }),
    [user, isInitialising, login, logout, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside an <AuthProvider>');
  }

  return context;
}
