/**
 * Reading values out of the URL query string.
 *
 * Filter state lives in the URL, which means the user can edit it — and a
 * hand-typed or truncated link must not break the screen.
 */

/**
 * Page number from a query parameter, falling back to 1.
 *
 * `Number(null)` is 0 and `Number('abc')` is NaN; both were being sent straight
 * to the API, which correctly rejected them with a 422 and left the user
 * looking at an error screen instead of the first page. Anything that is not a
 * whole number of at least 1 is treated as "no page specified".
 */
export function parsePage(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}
