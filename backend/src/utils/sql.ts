/**
 * SQL helpers for values that are bound as parameters but still carry meaning
 * to the database.
 */

/**
 * Builds a case-insensitive "contains" pattern for LIKE.
 *
 * Binding a search term as a parameter stops SQL injection, but it does NOT
 * stop the term from being read as a LIKE *pattern*: `%` means "any run of
 * characters" and `_` means "any single character" wherever they appear.
 *
 * That is a real problem here rather than a theoretical one, because SKUs are
 * allowed to contain underscores (`^[A-Za-z0-9_-]{2,50}$`). Without escaping,
 * a user searching for the SKU `LOW_1` is also shown `LOW-1` and `LOWX1`, and
 * has no way to search for the one they actually meant. `%` is worse: a lone
 * `%` matches every row in the table.
 *
 * PostgreSQL's default LIKE escape character is the backslash, so escaping
 * `\`, `%` and `_` is enough and no ESCAPE clause is needed. The backslash must
 * be escaped first, or it would double-escape the replacements added after it.
 */
export function likeContains(term: string): string {
  const escaped = term.replace(/[\\%_]/g, (character) => `\\${character}`);
  return `%${escaped.toLowerCase()}%`;
}
