/**
 * User preferences live in localStorage for now. They are only read and
 * written here, so the store can move, for example to the server.
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

/** The preference parsed as JSON, `null` when it is unset or not valid JSON. */
export function readJsonPreference(name: string): unknown {
  const value = readPreference(name);
  if (value === null) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

/**
 * Inline script for the document head. It sets the stored theme and diff
 * palette on the root before the first paint, so a page that is still
 * loading shows in the right colours.
 */
export const APPLY_STORED_COLOURS = `(function(){try{var d=document.documentElement,s=localStorage,t=s.getItem('${PREFIX}theme')||new URLSearchParams(location.search).get('theme');if(t==='dark'||t==='light')d.setAttribute('data-theme',t);if(s.getItem('${PREFIX}diff-palette')==='colorblind')d.setAttribute('data-diff-palette','colorblind')}catch(e){}})()`;
