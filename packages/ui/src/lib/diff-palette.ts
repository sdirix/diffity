import { useSyncExternalStore } from 'react';
import { readPreference, subscribePreference, writePreference } from './preferences';

/** Colours of added and deleted lines, stats and status badges. */
export type DiffPalette = 'default' | 'colorblind';

const PREFERENCE = 'diff-palette';

export function parseDiffPalette(value: string | null): DiffPalette {
  return value === 'colorblind' ? 'colorblind' : 'default';
}

let palette: DiffPalette = 'default';
const listeners = new Set<() => void>();

/** `data-diff-palette` on the root swaps the diff colour tokens in app.css. */
function applyDiffPalette(next: DiffPalette) {
  palette = next;
  if (next === 'default') {
    document.documentElement.removeAttribute('data-diff-palette');
  } else {
    document.documentElement.setAttribute('data-diff-palette', next);
  }
  for (const listener of listeners) {
    listener();
  }
}

export function setDiffPalette(next: DiffPalette) {
  writePreference(PREFERENCE, next === 'default' ? null : next);
  applyDiffPalette(next);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDiffPalette(): DiffPalette {
  return useSyncExternalStore(subscribe, () => palette, () => 'default');
}

if (typeof window !== 'undefined') {
  applyDiffPalette(parseDiffPalette(readPreference(PREFERENCE)));
  subscribePreference(PREFERENCE, (value) => applyDiffPalette(parseDiffPalette(value)));
}
