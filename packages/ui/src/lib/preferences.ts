import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { fetchSettings, saveSettings } from './api';
import { errorMessage } from './toast';

/**
 * Preferences live in localStorage, which is per origin and so per port.
 * They hold state of this browser, like scroll offsets and expanded
 * folders. Settings are shared by every repo: the server keeps them in
 * `~/.diffity/settings.json` and localStorage only caches them, so the
 * first paint already has the right colours.
 */
const PREFIX = 'diffity-';

export function readPreference(name: string): string | null {
  try {
    return localStorage.getItem(PREFIX + name);
  } catch {
    return null;
  }
}

/** `null` removes the preference. */
export function writePreference(name: string, value: string | null) {
  try {
    if (value === null) {
      localStorage.removeItem(PREFIX + name);
    } else {
      localStorage.setItem(PREFIX + name, value);
    }
  } catch {
    // Storage unavailable, the preference lasts until the page reloads
  }
}

function parseJson(value: string | null): unknown {
  if (value === null) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** The preference parsed as JSON, `null` when it is unset or not valid JSON. */
export function readJsonPreference(name: string): unknown {
  return parseJson(readPreference(name));
}

export function writeJsonPreference(name: string, value: unknown) {
  writePreference(name, JSON.stringify(value));
}

/** Calls `listener` with the new value when another tab changes the preference. */
export function subscribePreference(name: string, listener: (value: string | null) => void): () => void {
  const handler = (event: StorageEvent) => {
    if (event.key === PREFIX + name) {
      listener(event.newValue);
    }
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

export type ThemeSetting = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemeSetting;
  diffPalette: 'default' | 'colorblind';
  /** How a diff opens, `u` and `s` switch the open one. */
  diffLayout: 'split' | 'unified';
  /** Whether a diff opens with whitespace changes hidden. */
  hideWhitespace: boolean;
  /** `auto`, a known editor's id or `custom`, checked by the server. */
  editor: string;
  /** The custom editor command, with `{file}`, `{line}` and `{column}`. */
  editorCommand: string;
  /** Whether a comment that mentions `@claude` or `@agent` sends its thread to the agent. */
  agentMentions: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  diffPalette: 'default',
  diffLayout: 'split',
  hideWhitespace: false,
  editor: 'auto',
  editorCommand: '',
  agentMentions: true,
};

function oneOf(...values: unknown[]) {
  return (value: unknown) => values.includes(value);
}

function isText(value: unknown) {
  return typeof value === 'string';
}

const VALID: Record<keyof Settings, (value: unknown) => boolean> = {
  theme: oneOf('system', 'light', 'dark'),
  diffPalette: oneOf('default', 'colorblind'),
  diffLayout: oneOf('split', 'unified'),
  hideWhitespace: oneOf(false, true),
  editor: isText,
  editorCommand: isText,
  agentMentions: oneOf(false, true),
};

/** `value` as settings, a missing or invalid field taking its default. */
export function parseSettings(value: unknown): Settings {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const [key, valid] of Object.entries(VALID)) {
    if (valid(source[key])) {
      settings[key] = source[key];
    }
  }
  return settings as unknown as Settings;
}

const SETTINGS_CACHE = 'settings';

let settings = parseSettings(readJsonPreference(SETTINGS_CACHE));
const listeners = new Set<() => void>();
/** Counts the saves, so an answer that a later save overtook is dropped. */
let saves = 0;
let loaded: Promise<void> | null = null;

function setSettings(next: Settings, cache = true) {
  if (JSON.stringify(next) === JSON.stringify(settings)) {
    return;
  }
  settings = next;
  if (cache) {
    writeJsonPreference(SETTINGS_CACHE, next);
  }
  for (const listener of listeners) {
    listener();
  }
}

export function getSettings(): Settings {
  return settings;
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings, () => DEFAULT_SETTINGS);
}

/** Reads the settings from the server, keeping the cached ones when it does not answer. */
export async function refreshSettings(): Promise<void> {
  const before = saves;
  try {
    const value = await fetchSettings();
    if (saves === before) {
      setSettings(parseSettings(value));
    }
  } catch {
    // Server unreachable, the cached settings stay
  }
}

/** Applies `patch` at once and saves it for every repo. A failed save shows a toast and reads the settings again. */
export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  setSettings({ ...settings, ...patch });
  const save = ++saves;
  try {
    const saved = parseSettings(await saveSettings(patch));
    if (save === saves) {
      setSettings(saved);
    }
  } catch (error) {
    toast.error('Failed to save settings', { description: errorMessage(error) });
    if (save === saves) {
      void refreshSettings();
    }
  }
}

/**
 * Moves the theme and diff palette this origin kept before settings were
 * global, unless the server already has a choice of its own.
 */
function migrateLocalColours() {
  const theme = readPreference('theme');
  const palette = readPreference('diff-palette');
  if (theme === null && palette === null) {
    return;
  }
  writePreference('theme', null);
  writePreference('diff-palette', null);
  const patch: Partial<Settings> = {};
  if ((theme === 'light' || theme === 'dark') && settings.theme === 'system') {
    patch.theme = theme;
  }
  if (palette === 'colorblind' && settings.diffPalette === 'default') {
    patch.diffPalette = palette;
  }
  if (Object.keys(patch).length > 0) {
    void updateSettings(patch);
  }
}

/** Resolves once the settings were read from the server for this page, or it did not answer. */
export function settingsLoaded(): Promise<void> {
  loaded ??= refreshSettings().then(migrateLocalColours);
  return loaded;
}

if (typeof window !== 'undefined') {
  void settingsLoaded();
  // Another repo's server may have changed them while this tab was in the background.
  window.addEventListener('focus', () => void refreshSettings());
  subscribePreference(SETTINGS_CACHE, (value) => setSettings(parseSettings(parseJson(value)), false));
}

/**
 * Inline script for the document head. It sets the cached theme and diff
 * palette on the root before the first paint, so a page that is still
 * loading shows in the right colours. The `theme` query parameter and then
 * the system theme apply while the theme setting is `system`.
 */
export const APPLY_STORED_COLOURS = `(function(){try{var d=document.documentElement,s=JSON.parse(localStorage.getItem('${PREFIX}${SETTINGS_CACHE}'))||{},t=s.theme;if(t!=='light'&&t!=='dark')t=new URLSearchParams(location.search).get('theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');if(t==='dark'||t==='light')d.setAttribute('data-theme',t);if(s.diffPalette==='colorblind')d.setAttribute('data-diff-palette','colorblind')}catch(e){}})()`;
