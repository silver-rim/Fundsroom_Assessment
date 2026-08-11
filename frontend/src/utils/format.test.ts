/**
 * Unit tests for the display formatters.
 *
 * These functions are pure, and they carry the one piece of logic in the
 * frontend that is genuinely easy to get wrong and impossible to spot by
 * looking: a calendar date must never be shifted by a timezone, while an
 * instant must always be shown in the viewer's.
 *
 * Run with `npm test` (node:test via tsx — no browser needed, because nothing
 * here touches the DOM).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCurrency, formatDate, formatDateTime, isOverdue, todayIso } from './format';

describe('formatDate', () => {
  it('renders a calendar date without shifting it', () => {
    // The bug this guards against: `new Date('2026-08-14')` is midnight UTC, and
    // formatting that in a negative-offset timezone displays the 13th.
    const formatted = formatDate('2026-08-14');

    assert.ok(formatted.includes('14'), `expected the 14th, got "${formatted}"`);
    assert.ok(formatted.includes('2026'));
    assert.ok(!formatted.includes('13'), 'the date must not slip a day');
  });

  it('handles the first and last day of a month without slipping', () => {
    assert.ok(formatDate('2026-01-01').includes('01'));
    assert.ok(formatDate('2026-12-31').includes('31'));
  });

  it('renders an em dash for an absent value', () => {
    for (const value of [null, undefined, '']) {
      assert.equal(formatDate(value), '—');
    }
  });

  it('renders an em dash rather than "Invalid Date"', () => {
    assert.equal(formatDate('not-a-date'), '—');
  });
});

describe('formatDateTime', () => {
  it('formats an ISO instant', () => {
    const formatted = formatDateTime('2026-08-14T09:20:00.000Z');

    assert.ok(formatted.includes('2026'));
    assert.notEqual(formatted, '—');
  });

  it('falls back to an em dash for missing or malformed input', () => {
    assert.equal(formatDateTime(null), '—');
    assert.equal(formatDateTime('nonsense'), '—');
  });
});

describe('formatCurrency', () => {
  it('formats a decimal string from the API', () => {
    const formatted = formatCurrency('9400.00');

    assert.ok(formatted.includes('9,400'), `got "${formatted}"`);
  });

  it('accepts a number as well as a string', () => {
    assert.equal(formatCurrency(9400), formatCurrency('9400.00'));
  });

  it('formats zero as a real amount, not as an em dash', () => {
    const formatted = formatCurrency('0.00');

    assert.ok(formatted.includes('0'));
    assert.notEqual(formatted, '—');
  });

  it('keeps two decimal places', () => {
    assert.ok(formatCurrency('1234.5').includes('.50'));
  });

  it('renders an em dash for absent or unparseable values', () => {
    for (const value of [null, undefined, '', 'abc']) {
      assert.equal(formatCurrency(value), '—');
    }
  });
});

describe('isOverdue', () => {
  it('counts today as due', () => {
    assert.equal(isOverdue(todayIso()), true);
  });

  it('counts the past as due and the future as not', () => {
    assert.equal(isOverdue('2000-01-01'), true);
    assert.equal(isOverdue('2999-12-31'), false);
  });

  it('treats no date as not due', () => {
    assert.equal(isOverdue(null), false);
    assert.equal(isOverdue(undefined), false);
  });
});

describe('todayIso', () => {
  it('returns a YYYY-MM-DD string', () => {
    assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
  });
});
