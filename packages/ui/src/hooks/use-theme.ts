import { useState, useLayoutEffect, useCallback, useSyncExternalStore } from 'react';
import { readPreference, writePreference } from '../lib/preferences';

type Theme = 'light' | 'dark';

function getStoredTheme(): Theme | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return readPreference('theme') as Theme | null;
}

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

export function useTheme(initialTheme?: Theme | null) {
  const [theme, setTheme] = useState<Theme>(
    () => getStoredTheme() || initialTheme || getTheme()
  );

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'light' ? 'dark' : 'light';
      writePreference('theme', next);
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
