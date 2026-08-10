import { useEffect, useState } from 'react';

/**
 * Delays a rapidly-changing value.
 *
 * Used for the search boxes: without it every keystroke fires a request, so
 * typing "distributor" would issue eleven queries and the answers could arrive
 * out of order.
 */
export function useDebounce<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
