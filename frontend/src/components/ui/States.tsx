/**
 * Shared empty / error / inline-loading states.
 *
 * Every list and detail screen renders all four states, and reusing these keeps
 * a "nothing here yet" or "that failed" moment looking the same everywhere.
 */
import type { ReactNode } from 'react';
import { ApiError } from '../../api/client';
import { Button } from './Button';
import styles from './States.module.css';

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className={styles.state}>
      <p className={styles.title}>{title}</p>
      {message && <p className={styles.message}>{message}</p>}
      {action}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: ApiError | Error;
  onRetry?: () => void;
}): JSX.Element {
  const code = error instanceof ApiError ? error.code : undefined;

  return (
    <div className={styles.state}>
      <p className={styles.title}>Something went wrong</p>
      <div className={styles.errorBox} role="alert">
        {code && (
          <>
            <strong>{code}</strong>
            <br />
          </>
        )}
        {error.message}
      </div>
      {onRetry && (
        <Button type="button" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function InlineSpinner({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <div className={styles.state} role="status" aria-live="polite">
      <div className={styles.spinner} />
      <p className={styles.message}>{label}</p>
    </div>
  );
}

/** Dismissible success banner shown after a create/update/delete. */
export function SuccessBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}): JSX.Element {
  return (
    <div className={styles.success} role="status">
      <span>{message}</span>
      {onDismiss && (
        <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}
