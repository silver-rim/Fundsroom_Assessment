/**
 * Runs an async API call and exposes the loading / error / data triad.
 *
 * Every screen in this app has four states — loading, error, empty, success —
 * and this hook makes it awkward to forget one. It also guards against setting
 * state after unmount and against a slow earlier request overwriting a faster
 * later one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';

interface UseApiResult<T> {
  data: T | null;
  error: ApiError | null;
  isLoading: boolean;
  /** Re-runs the request; useful for a "Retry" button or after a mutation. */
  refetch: () => void;
}

export function useApi<T>(
  request: () => Promise<T>,
  /**
   * Values that should trigger a refetch when they change (page, search term,
   * filters). Same contract as a useEffect dependency array.
   */
  deps: readonly unknown[] = [],
): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  // Identifies the most recent request, so a stale response is discarded
  // instead of overwriting fresher data.
  const requestIdRef = useRef(0);

  // Held in a ref so an inline arrow function passed as `request` does not
  // restart the effect on every render.
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    let isActive = true;

    setIsLoading(true);
    setError(null);

    requestRef
      .current()
      .then((result) => {
        if (!isActive || requestId !== requestIdRef.current) return;
        setData(result);
      })
      .catch((caught: unknown) => {
        if (!isActive || requestId !== requestIdRef.current) return;
        setData(null);
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError('An unexpected error occurred.', 0, 'UNKNOWN_ERROR'),
        );
      })
      .finally(() => {
        if (!isActive || requestId !== requestIdRef.current) return;
        setIsLoading(false);
      });

    return () => {
      isActive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken, ...deps]);

  const refetch = useCallback(() => setReloadToken((token) => token + 1), []);

  return { data, error, isLoading, refetch };
}
