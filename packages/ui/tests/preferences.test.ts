import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJsonPreference, readPreference, writeJsonPreference, writePreference } from '../src/lib/preferences';
import { parseDiffPalette } from '../src/lib/diff-palette';

function stubStorage() {
  const items = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  });
  return items;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('preferences', () => {
  it('stores under the diffity prefix', () => {
    const items = stubStorage();
    writePreference('theme', 'dark');
    expect(items.get('diffity-theme')).toBe('dark');
    expect(readPreference('theme')).toBe('dark');
  });

  it('removes a preference set to null', () => {
    const items = stubStorage();
    writePreference('diff-palette', 'colorblind');
    writePreference('diff-palette', null);
    expect(items.has('diffity-diff-palette')).toBe(false);
    expect(readPreference('diff-palette')).toBeNull();
  });

  it('reads nothing and keeps going without storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(readPreference('theme')).toBeNull();
    expect(() => writePreference('theme', 'dark')).not.toThrow();
  });

  it('round-trips JSON values', () => {
    stubStorage();
    writeJsonPreference('tree-expanded:/repo', ['src', 'src/lib']);
    expect(readJsonPreference('tree-expanded:/repo')).toEqual(['src', 'src/lib']);
  });

  it('reads unset or broken JSON as null', () => {
    const items = stubStorage();
    expect(readJsonPreference('tree-expanded:/repo')).toBeNull();
    items.set('diffity-tree-expanded:/repo', '{broken');
    expect(readJsonPreference('tree-expanded:/repo')).toBeNull();
  });
});

describe('parseDiffPalette', () => {
  it('falls back to the default palette', () => {
    expect(parseDiffPalette('colorblind')).toBe('colorblind');
    expect(parseDiffPalette(null)).toBe('default');
    expect(parseDiffPalette('unknown')).toBe('default');
  });
});
