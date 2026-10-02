import { useSyncExternalStore } from 'react';

export type SettingsSection = 'appearance' | 'diff' | 'editor' | 'data';

interface SettingsDialogState {
  open: boolean;
  section: SettingsSection;
  /** The setting to scroll to and focus once its section shows. */
  item: string | null;
}

let state: SettingsDialogState = { open: false, section: 'appearance', item: null };
const listeners = new Set<() => void>();

function setState(next: Partial<SettingsDialogState>) {
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

export function getSettingsDialogState(): SettingsDialogState {
  return state;
}

export function useSettingsDialog(): SettingsDialogState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** Opens the settings at `section`, or where they were last, and scrolls to `item`. */
export function openSettings(section?: SettingsSection, item?: string) {
  setState({ open: true, section: section ?? state.section, item: item ?? null });
}

export function closeSettings() {
  setState({ open: false, item: null });
}
