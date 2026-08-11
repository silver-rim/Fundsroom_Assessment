/**
 * Unit tests for query-string parsing.
 *
 * Filter state lives in the URL, so these values are user-editable and must
 * never be able to break a screen.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePage } from './params';

describe('parsePage', () => {
  it('reads a valid page number', () => {
    assert.equal(parsePage('1'), 1);
    assert.equal(parsePage('7'), 7);
  });

  it('falls back to page 1 when the parameter is absent', () => {
    assert.equal(parsePage(null), 1);
    assert.equal(parsePage(''), 1);
  });

  it('falls back to page 1 for values the API would reject', () => {
    // Regression: these were sent to the API as-is and came back 422, so a
    // mistyped URL showed an error screen instead of the first page.
    for (const value of ['abc', 'NaN', '0', '-3', '1.5', 'Infinity']) {
      assert.equal(parsePage(value), 1, `parsePage(${JSON.stringify(value)}) should be 1`);
    }
  });
});
