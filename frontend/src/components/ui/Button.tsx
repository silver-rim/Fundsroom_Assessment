import type { ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'danger';

function classesFor(variant: Variant, small: boolean, extra?: string): string {
  return [styles.button, styles[variant], small ? styles.small : '', extra ?? '']
    .filter(Boolean)
    .join(' ');
}

export function Button({
  variant = 'primary',
  small = false,
  className,
  ...props
}: { variant?: Variant; small?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return <button {...props} className={classesFor(variant, small, className)} />;
}

/** A link styled as a button — for navigation actions like "Add customer". */
export function LinkButton({
  variant = 'primary',
  small = false,
  className,
  ...props
}: { variant?: Variant; small?: boolean } & LinkProps): JSX.Element {
  return <Link {...props} className={classesFor(variant, small, className)} />;
}
