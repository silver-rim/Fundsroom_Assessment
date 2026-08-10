/**
 * Display formatting.
 *
 * Centralised so dates and money look the same on every screen, and so the
 * date-only vs instant distinction is handled correctly in one place.
 */

/**
 * Formats a 'YYYY-MM-DD' calendar date.
 *
 * Parsed as UTC and rendered in UTC on purpose. `new Date('2026-08-14')` is
 * midnight UTC, and formatting that in a negative-offset timezone would display
 * the 13th. A calendar date has no timezone, so it must not be shifted.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';

  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Formats an ISO instant in the viewer's local timezone, which is correct for a moment in time. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** True when a follow-up date is today or in the past. */
export function isOverdue(date: string | null | undefined): boolean {
  if (!date) return false;
  const today = new Date().toISOString().slice(0, 10);
  return date <= today;
}

/** Indian-format currency from the API's decimal string. */
export function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';

  const amount = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(amount)) return '—';

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(amount);
}
