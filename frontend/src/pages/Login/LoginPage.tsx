import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { config } from '../../config/env';
import { useAuth } from '../../context/AuthContext';
import { ROLE_LABELS, type Role } from '../../types/auth';
import styles from './LoginPage.module.css';

/**
 * Demo accounts, shown so a reviewer can sign in as any role without digging
 * through the README. Development convenience only — Phase 9 removes this block
 * from the deployed build if the credentials are not meant to be public.
 */
const DEMO_ACCOUNTS: Array<{ role: Role; email: string; password: string }> = [
  { role: 'ADMIN', email: 'admin@minierp.local', password: 'Admin@12345' },
  { role: 'SALES', email: 'sales@minierp.local', password: 'Sales@12345' },
  { role: 'WAREHOUSE', email: 'warehouse@minierp.local', password: 'Warehouse@12345' },
  { role: 'ACCOUNTS', email: 'accounts@minierp.local', password: 'Accounts@12345' },
];

interface FieldErrors {
  email?: string;
  password?: string;
}

export default function LoginPage(): JSX.Element {
  const { login, isAuthenticated, isInitialising } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Where the user was headed before being bounced here.
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';

  if (!isInitialising && isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  /** Mirrors the backend Zod rules for instant feedback. The server re-checks. */
  function validate(): boolean {
    const errors: FieldErrors = {};

    if (email.trim().length === 0) errors.email = 'Email is required';
    else if (!/^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/.test(email.trim()))
      errors.email = 'Enter a valid email address';

    if (password.length === 0) errors.password = 'Password is required';

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    if (!validate()) return;

    setIsSubmitting(true);

    try {
      await login(email.trim(), password);
      navigate(redirectTo, { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        // 422 carries per-field problems; map them onto the inputs.
        if (error.isValidationError && error.details.length > 0) {
          const mapped: FieldErrors = {};
          for (const detail of error.details) {
            if (detail.field.endsWith('email')) mapped.email = detail.message;
            if (detail.field.endsWith('password')) mapped.password = detail.message;
          }
          setFieldErrors(mapped);
          setFormError('Please correct the highlighted fields.');
        } else {
          setFormError(error.message);
        }
      } else {
        setFormError('An unexpected error occurred. Please try again.');
      }
      setPassword('');
    } finally {
      setIsSubmitting(false);
    }
  }

  function fillDemoAccount(account: (typeof DEMO_ACCOUNTS)[number]): void {
    setEmail(account.email);
    setPassword(account.password);
    setFieldErrors({});
    setFormError(null);
  }

  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <div className={styles.brandName}>{config.appName}</div>
          <div className={styles.brandTag}>Operations Portal &mdash; staff sign in</div>
        </div>

        <div className="card">
          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            {formError && (
              <div className={styles.alert} role="alert">
                <strong>Sign-in failed</strong>
                <span>{formError}</span>
              </div>
            )}

            <div className={styles.field}>
              <label className={styles.label} htmlFor="email">
                Email<span className={styles.required}>*</span>
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                className={`${styles.input} ${fieldErrors.email ? styles.inputError : ''}`}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                placeholder="you@minierp.local"
                autoFocus
              />
              {fieldErrors.email && (
                <span className={styles.fieldError} id="email-error">
                  {fieldErrors.email}
                </span>
              )}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="password">
                Password<span className={styles.required}>*</span>
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                className={`${styles.input} ${fieldErrors.password ? styles.inputError : ''}`}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? 'password-error' : undefined}
              />
              {fieldErrors.password && (
                <span className={styles.fieldError} id="password-error">
                  {fieldErrors.password}
                </span>
              )}
            </div>

            <button type="submit" className={styles.submit} disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className={styles.hint}>
            <div className={styles.hintTitle}>Demo accounts &mdash; click to fill</div>
            <div className={styles.accountList}>
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.role}
                  type="button"
                  className={styles.account}
                  onClick={() => fillDemoAccount(account)}
                  disabled={isSubmitting}
                >
                  <span>{ROLE_LABELS[account.role]}</span>
                  <span className={styles.accountEmail}>{account.email}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
