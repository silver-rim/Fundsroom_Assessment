import type { PaginationMeta } from './httpResponse';

/** SQL OFFSET for a 1-based page number. */
export function offsetFor(page: number, limit: number): number {
  return (page - 1) * limit;
}

export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

/**
 * Turns a whitelisted sort key into a real column name.
 *
 * `sortBy` arrives from the query string and is interpolated into SQL, where a
 * bound parameter cannot be used for an identifier. Passing it through this map
 * means only names the application chose can ever reach the statement — an
 * unknown key silently falls back to the default instead of reaching the
 * database.
 */
export function resolveSortColumn<T extends Record<string, string>>(
  allowed: T,
  requested: string | undefined,
  fallback: keyof T,
): string {
  if (requested && Object.prototype.hasOwnProperty.call(allowed, requested)) {
    return allowed[requested] as string;
  }
  return allowed[fallback] as string;
}

/** Normalises sort direction to a literal SQL keyword. */
export function resolveSortDirection(order: string | undefined): 'ASC' | 'DESC' {
  return order?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
}
