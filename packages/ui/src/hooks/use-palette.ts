import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { CommentThread } from '../components/comments/types';

export type PaletteMode = 'commands' | 'files';

export type PaletteGroup = 'Actions' | 'View' | 'Go to' | 'Comments';

export interface PaletteAction {
  /** Stable across renders, keys the recent actions. */
  id: string;
  title: string;
  group?: PaletteGroup;
  /** Key from the shortcut registry, shown next to the title. */
  hint?: string;
  keywords?: string;
  icon?: ReactNode;
  run: () => void;
}

export interface PaletteFile {
  path: string;
  additions?: number;
  deletions?: number;
  comments?: number;
  viewed?: boolean;
}

/** The files and comments of the page that is showing. */
export interface PaletteView {
  /** Keys the recent files. */
  repo: string;
  filesLabel: string;
  files: PaletteFile[];
  openFile: (path: string) => void;
  threads: CommentThread[];
  openThread: (threadId: string, filePath: string) => void;
  /** Whether files can be opened in the editor. */
  editor: boolean;
}

interface PaletteState {
  mode: PaletteMode | null;
  actions: Record<string, PaletteAction[]>;
  view: PaletteView | null;
}

let state: PaletteState = { mode: null, actions: {}, view: null };
const listeners = new Set<() => void>();

function setState(next: Partial<PaletteState>) {
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

export function getPaletteState(): PaletteState {
  return state;
}

export function usePaletteState(): PaletteState {
  return useSyncExternalStore(subscribe, getPaletteState, getPaletteState);
}

export function usePaletteMode(): PaletteMode | null {
  return useSyncExternalStore(subscribe, () => state.mode, () => null);
}

export function openPalette(mode: PaletteMode) {
  setState({ mode });
}

export function closePalette() {
  setState({ mode: null });
}

/** Whether the page has offered anything, else the palette keys are left to the browser. */
export function isPaletteAvailable(): boolean {
  return state.view !== null || Object.keys(state.actions).length > 0;
}

/** Offers `actions` in the palette while the component is mounted. Pass a memoized list. */
export function usePaletteActions(owner: string, actions: PaletteAction[]) {
  useEffect(() => {
    setState({ actions: { ...state.actions, [owner]: actions } });
    return () => {
      if (state.actions[owner] !== actions) {
        return;
      }
      const rest = { ...state.actions };
      delete rest[owner];
      setState({ actions: rest });
    };
  }, [owner, actions]);
}

/** Offers the files and comments of the page while it is mounted. Pass a memoized view. */
export function usePaletteView(view: PaletteView | null) {
  useEffect(() => {
    if (!view) {
      return;
    }
    setState({ view });
    return () => {
      if (state.view === view) {
        setState({ view: null });
      }
    };
  }, [view]);
}
