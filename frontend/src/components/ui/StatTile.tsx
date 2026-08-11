/**
 * A single headline number with a label and one line of context.
 *
 * Every tile is a link. A counter the user cannot act on is decoration, so each
 * one navigates to the filtered list that produced it — "4 low stock" goes to
 * the four products, not to a dead end.
 *
 * `tone` is applied only when a number genuinely needs attention. Colouring
 * every tile would mean colouring none of them, because nothing would stand out.
 */
import { Link } from 'react-router-dom';
import styles from './StatTile.module.css';

export type StatTone = 'neutral' | 'warning' | 'danger';

export function StatTile({
  label,
  value,
  hint,
  to,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  hint?: string;
  to: string;
  tone?: StatTone;
}): JSX.Element {
  return (
    <Link to={to} className={`${styles.tile} ${styles[tone]}`}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
      <span className={styles.hint}>{hint ?? ' '}</span>
    </Link>
  );
}
