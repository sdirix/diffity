import { fetchTreeFingerprint } from '../lib/api';
import { useStaleness } from './use-staleness';

/** Whether the working tree changed since `baseline`, the fingerprint the tree on screen came with. */
export function useTreeStaleness(baseline: string | undefined) {
  return useStaleness(baseline, fetchTreeFingerprint);
}
