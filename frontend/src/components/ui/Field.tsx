/**
 * Form field primitives.
 *
 * Every form in the portal is built from these, so labels, required markers,
 * error text and the accessibility wiring (`aria-invalid`, `aria-describedby`,
 * label/control association) are correct once rather than re-implemented per
 * screen.
 */
import type { ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, InputHTMLAttributes } from 'react';
import styles from './Field.module.css';

interface FieldShellProps {
  id: string;
  label: string;
  required?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
}

function FieldShell({ id, label, required, error, hint, children }: FieldShellProps): JSX.Element {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {required && <span className={styles.required} aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && !error && (
        <span className={styles.hint} id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className={styles.error} id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

type BaseProps = {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
};

export function TextField({
  id,
  label,
  error,
  hint,
  required,
  ...inputProps
}: BaseProps & InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return (
    <FieldShell id={id} label={label} required={required} error={error} hint={hint}>
      <input
        {...inputProps}
        id={id}
        required={required}
        className={`${styles.control} ${error ? styles.controlError : ''}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      />
    </FieldShell>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectField({
  id,
  label,
  error,
  hint,
  required,
  options,
  placeholder,
  ...selectProps
}: BaseProps & { options: readonly SelectOption[]; placeholder?: string } & SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return (
    <FieldShell id={id} label={label} required={required} error={error} hint={hint}>
      <select
        {...selectProps}
        id={id}
        required={required}
        className={`${styles.control} ${error ? styles.controlError : ''}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function TextAreaField({
  id,
  label,
  error,
  hint,
  required,
  ...textareaProps
}: BaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return (
    <FieldShell id={id} label={label} required={required} error={error} hint={hint}>
      <textarea
        {...textareaProps}
        id={id}
        required={required}
        className={`${styles.control} ${styles.textarea} ${error ? styles.controlError : ''}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      />
    </FieldShell>
  );
}
