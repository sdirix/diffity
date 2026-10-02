import { useCallback, useEffect, useState } from 'react';

const POLL_INTERVAL = 3000;

/**
 * Polls `fetchFingerprint` until it differs from `baseline`, the fingerprint
 * the data on screen was read with, so a change that lands while that data
 * loads is not missed. A new baseline clears the stale state.
 */
export function useStaleness(
  baseline: string | undefined,
  fetchFingerprint: () => Promise<string>,
  enabled = true,
) {
  const [staleFor, setStaleFor] = useState<string | null>(null);
  const isStale = !!baseline && staleFor === baseline;

  const resetStaleness = useCallback(() => setStaleFor(null), []);

  useEffect(() => {
    if (!enabled || !baseline || isStale) {
      return;
    }
    const expected = baseline;

    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function poll() {
      try {
        const fingerprint = await fetchFingerprint();
        if (cancelled) {
          return;
        }
        if (fingerprint !== expected) {
          setStaleFor(expected);
          return;
        }
      } catch {
        // ignore fetch errors
      }

      if (!cancelled) {
        timer = setTimeout(poll, POLL_INTERVAL);
      }
    }

    timer = setTimeout(poll, POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [baseline, fetchFingerprint, enabled, isStale]);

  return { isStale, resetStaleness };
}
