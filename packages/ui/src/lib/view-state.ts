import { useCallback, useEffect, useRef, useState, type Dispatch, type RefCallback, type SetStateAction } from 'react';
import { readJsonPreference, writeJsonPreference } from './preferences';

const memory = new Map<string, unknown>();

/** UI state kept in memory for the life of the page, so a view that mounts again continues where it was. */
export function readViewState<T>(key: string, fallback: T): T {
  return memory.has(key) ? (memory.get(key) as T) : fallback;
}

export function writeViewState(key: string, value: unknown) {
  memory.set(key, value);
}

/** `useState` whose value is kept under `key` and restored when the component mounts again. */
export function useViewState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readViewState(key, initial));

  useEffect(() => {
    writeViewState(key, value);
  }, [key, value]);

  return [value, setValue];
}

export type AppView = 'diff' | 'tree';

const LOCATIONS_KEY = 'diffity-view-locations';

function readLocations(): Partial<Record<AppView, string>> {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(LOCATIONS_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Remembers the query string a view was last shown with, so switching back to it returns there. */
export function rememberLocation(view: AppView, search: string) {
  try {
    sessionStorage.setItem(LOCATIONS_KEY, JSON.stringify({ ...readLocations(), [view]: search }));
  } catch {
    // Storage unavailable, switching views starts fresh
  }
}

/** Query parameters that hold for every view, like the theme and diff layout the app was opened with. */
const SHARED_PARAMS = ['theme', 'view'];

/** `search` with the shared parameters of `current` carried over. */
export function withSharedParams(search: string, current: string): string {
  const params = new URLSearchParams(search);
  const from = new URLSearchParams(current);
  const carried = SHARED_PARAMS.filter((name) => from.has(name) && from.get(name) !== params.get(name));
  if (carried.length === 0) {
    return search;
  }
  for (const name of carried) {
    params.set(name, from.get(name)!);
  }
  return `?${params.toString().replace(/%2F/g, '/')}`;
}

/** Where `view` was left, with the shared parameters of `currentSearch`, the query string of the view shown now. */
export function lastLocation(view: AppView, currentSearch = ''): string {
  return `/${view}${withSharedParams(readLocations()[view] ?? '', currentSearch)}`;
}

interface SavedScroll {
  location: string;
  top: number;
}

const PERSIST_DELAY_MS = 300;

function isSavedScroll(value: unknown): value is SavedScroll {
  const saved = value as SavedScroll | null;
  return !!saved && typeof saved.location === 'string' && typeof saved.top === 'number';
}

/** The offset `useRestoredScroll` restores for `location`, 0 when there is none. */
export function restoredScrollTop(key: string, location: string, persist?: string): number {
  const saved = [readViewState<unknown>(key, null), persist ? readJsonPreference(persist) : null]
    .filter(isSavedScroll)
    .find((candidate) => candidate.location === location);
  return saved?.top ?? 0;
}

/** Applies `top` to `el` now and again while late content grows it, until the user scrolls. */
function restoreScroll(el: HTMLElement, top: number): () => void {
  const apply = () => {
    el.scrollTop = top;
  };
  const observer = new ResizeObserver(apply);
  const stop = () => {
    observer.disconnect();
    window.clearTimeout(timer);
    el.removeEventListener('wheel', stop);
    el.removeEventListener('pointerdown', stop);
    el.removeEventListener('keydown', stop);
  };
  const timer = window.setTimeout(stop, 2000);
  apply();
  for (const child of Array.from(el.children)) {
    observer.observe(child);
  }
  el.addEventListener('wheel', stop, { passive: true });
  el.addEventListener('pointerdown', stop);
  el.addEventListener('keydown', stop);
  return stop;
}

/**
 * A ref that keeps the scroll offset of its element under `key` and, when an
 * element attaches, restores it if the view shows the same `location` as when
 * it was saved. With `persist`, the offset is also stored in that
 * preference, so it survives a reload. A list that mounts again, like a
 * sidebar shown again, gets its offset back and keeps saving it.
 */
export function useRestoredScroll(key: string, location: string, persist?: string): RefCallback<HTMLElement> {
  const locationRef = useRef(location);
  locationRef.current = location;

  return useCallback((el: HTMLElement | null) => {
    if (!el) {
      return;
    }
    const top = restoredScrollTop(key, locationRef.current, persist);
    const stopRestoring = top !== 0 ? restoreScroll(el, top) : null;

    let timer: number | undefined;
    const flush = () => {
      if (timer === undefined || !persist) {
        return;
      }
      window.clearTimeout(timer);
      timer = undefined;
      writeJsonPreference(persist, readViewState(key, null));
    };
    const save = () => {
      writeViewState(key, { location: locationRef.current, top: el.scrollTop });
      if (persist && timer === undefined) {
        timer = window.setTimeout(flush, PERSIST_DELAY_MS);
      }
    };
    el.addEventListener('scroll', save, { passive: true });
    window.addEventListener('pagehide', flush);
    return () => {
      stopRestoring?.();
      el.removeEventListener('scroll', save);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [key, persist]);
}
