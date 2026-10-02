import type { ViewedFile } from './api';

export interface ViewedState {
  /** Files marked viewed whose new side is still the one that was viewed. */
  viewed: Set<string>;
  /** Files marked viewed that changed since, with their mark. */
  changed: Map<string, ViewedFile>;
}

/**
 * Splits the viewed marks of a session against the files of the diff: a file
 * stays viewed while its new side is the blob it had when marked, and counts
 * as changed since viewed once that differs. Marks of files outside the diff
 * count as neither.
 */
export function computeViewedState(entries: ViewedFile[], paths: Iterable<string>): ViewedState {
  const shown = new Set(paths);
  const viewed = new Set<string>();
  const changed = new Map<string, ViewedFile>();
  for (const entry of entries) {
    if (!shown.has(entry.path)) {
      continue;
    }
    if (entry.blob === entry.current) {
      viewed.add(entry.path);
    } else {
      changed.set(entry.path, entry);
    }
  }
  return { viewed, changed };
}

/** `entries` with `paths` marked or unmarked right away. A mark counts as viewed until the server answers with its blob. */
export function applyViewed(entries: ViewedFile[], paths: string[], viewed: boolean): ViewedFile[] {
  const targets = new Set(paths);
  const rest = entries.filter((entry) => !targets.has(entry.path));
  if (!viewed) {
    return rest;
  }
  return [...rest, ...paths.map((path) => ({ path, blob: null, current: null, kept: false }))];
}

/**
 * The files that start collapsed: viewed ones, and auto-collapsed ones unless
 * they have comments or changed since viewed. A file toggled by hand is
 * flipped.
 */
export function initialCollapsed(
  paths: string[],
  autoCollapsed: Set<string>,
  commented: Set<string>,
  state: ViewedState,
  toggled: Set<string>,
): Set<string> {
  const collapsed = new Set<string>();
  for (const path of paths) {
    const base = state.viewed.has(path)
      || (autoCollapsed.has(path) && !commented.has(path) && !state.changed.has(path));
    if (base !== toggled.has(path)) {
      collapsed.add(path);
    }
  }
  return collapsed;
}

/** The first file after the one at `from` that is not viewed, wrapping around, `null` when all are. */
export function nextUnviewedFile(paths: string[], from: number, viewed: Set<string>): string | null {
  for (let step = 1; step <= paths.length; step++) {
    const path = paths[(from + step) % paths.length];
    if (!viewed.has(path)) {
      return path;
    }
  }
  return null;
}
