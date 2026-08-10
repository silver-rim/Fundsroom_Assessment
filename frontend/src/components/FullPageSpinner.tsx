import styles from './FullPageSpinner.module.css';

/** Centred loading state for whole-page waits (session restore, route guards). */
export default function FullPageSpinner({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <div className={styles.wrapper} role="status" aria-live="polite">
      <div className={styles.spinner} />
      <p className={styles.label}>{label}</p>
    </div>
  );
}
