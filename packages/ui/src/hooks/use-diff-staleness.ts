import { useCallback } from 'react';
import { fetchDiffFingerprint } from '../lib/api';
import { useStaleness } from './use-staleness';

/** Whether the diff of `ref` changed since `baseline`, the fingerprint the diff on screen came with. */
export function useDiffStaleness(baseline: string | undefined, ref?: string, enabled = true) {
  const fetchFingerprint = useCallback(() => fetchDiffFingerprint(ref), [ref]);
  return useStaleness(baseline, fetchFingerprint, enabled);
}
