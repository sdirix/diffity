import { useCallback, useLayoutEffect, useSyncExternalStore } from 'react';
import { updateSettings, useSettings, type ThemeSetting } from '../lib/preferences';

export type Theme = 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function getTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function subscribeToTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/** The theme applied to the document, for components that do not receive it as a prop. */
export function useDocumentTheme(): Theme {
  return useSyncExternalStore(subscribeToTheme, getTheme, () => 'light');
}

function getSystemTheme(): Theme {
  return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
}

function subscribeToSystemTheme(onChange: () => void) {
  const query = window.matchMedia?.(DARK_QUERY);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

/** The theme `setting` shows: its own, or for `system` the one the URL asks for, else the system's. */
export function resolveTheme(setting: ThemeSetting, requested: Theme | null | undefined, system: Theme): Theme {
  return setting === 'system' ? requested || system : setting;
}

/** Applies the theme setting to the document. `initialTheme` is the one the URL asks for. */
export function useTheme(initialTheme?: Theme | null) {
  const { theme: setting } = useSettings();
  const system = useSyncExternalStore(subscribeToSystemTheme, getSystemTheme, () => 'light' as Theme);
  const theme = resolveTheme(setting, initialTheme, system);

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    void updateSettings({ theme: theme === 'light' ? 'dark' : 'light' });
  }, [theme]);

  return { theme, setting, toggleTheme };
}
