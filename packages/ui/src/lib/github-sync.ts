import { useEffect, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { pullFromGitHub, type PullResult } from './api';
import { readPreference, writePreference } from './preferences';
import { queryClient } from './query-client';
import { errorMessage } from './toast';

export const AUTO_SYNC_MS = 60_000;
const PAUSED_PREFERENCE = 'github-auto-sync';

interface SyncState {
  syncing: boolean;
  syncedAt: number | null;
  /** Auto sync is off. */
  paused: boolean;
  /** Why the last pull failed. */
  error: string | null;
}

let state: SyncState = { syncing: false, syncedAt: null, paused: readPreference(PAUSED_PREFERENCE) === 'paused', error: null };
const listeners = new Set<() => void>();

function setState(next: Partial<SyncState>) {
  state = { ...state, ...next };
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useGitHubSync(): SyncState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function setAutoSyncPaused(paused: boolean) {
  writePreference(PAUSED_PREFERENCE, paused ? 'paused' : null);
  setState({ paused });
}

export function refreshThreadQueries() {
  for (const key of ['threads', 'repo-threads', 'thread-locations', 'github-details']) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

/** Pulls the review threads, `null` when a pull is already running. */
export async function pullReviewThreads(): Promise<PullResult | null> {
  if (state.syncing) {
    return null;
  }
  setState({ syncing: true });
  try {
    const result = await pullFromGitHub();
    setState({ syncedAt: Date.now(), error: null });
    if (result.pulled + result.updated > 0) {
      refreshThreadQueries();
    }
    return result;
  } catch (error) {
    setState({ error: errorMessage(error) });
    throw error;
  } finally {
    setState({ syncing: false });
  }
}

export function pullSummary(result: PullResult): string {
  if (result.pulled + result.updated === 0) {
    return result.skipped > 0 ? 'Review threads up to date' : 'No review threads on GitHub';
  }
  const parts = [];
  if (result.pulled > 0) {
    parts.push(`Pulled ${result.pulled} review thread${result.pulled === 1 ? '' : 's'}`);
  }
  if (result.updated > 0) {
    parts.push(`${result.pulled > 0 ? 'updated' : 'Updated'} ${result.updated}`);
  }
  return parts.join(', ');
}

/** Pulls now and reports the outcome, offering `openView` when the threads went to another view. */
export async function syncNow(currentRef: string | null, openView: (ref: string) => void) {
  const id = toast.loading('Pulling review threads…');
  try {
    const result = await pullReviewThreads();
    if (!result) {
      toast.dismiss(id);
      return;
    }
    const elsewhere = result.ref !== currentRef && result.pulled + result.updated > 0;
    toast.success(pullSummary(result), {
      id,
      action: elsewhere ? { label: 'Open PR view', onClick: () => openView(result.ref) } : undefined,
    });
  } catch (error) {
    toast.error('Failed to pull review threads', { id, description: errorMessage(error) });
  }
}

/** Pulls on open, every minute and when the tab shows again, while `enabled` and not paused. */
export function useAutoSync(enabled: boolean) {
  const { paused } = useGitHubSync();

  useEffect(() => {
    if (!enabled || paused) {
      return;
    }
    const tick = () => {
      if (document.hidden || Date.now() - (state.syncedAt ?? 0) < AUTO_SYNC_MS - 1000) {
        return;
      }
      pullReviewThreads().catch(() => {});
    };
    tick();
    const timer = setInterval(tick, AUTO_SYNC_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [enabled, paused]);
}
