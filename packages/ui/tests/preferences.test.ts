import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  getSettings,
  parseSettings,
  readJsonPreference,
  readPreference,
  updateSettings,
  writeJsonPreference,
  writePreference,
} from '../src/lib/preferences';

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

describe('parseSettings', () => {
  it('falls back to the defaults', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('dark')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ theme: 'neon', diffPalette: 'colorblind', hideWhitespace: 'yes', editor: 3, extra: 1 })).toEqual({
      ...DEFAULT_SETTINGS,
      diffPalette: 'colorblind',
    });
  });

  it('keeps valid values', () => {
    const settings = {
      theme: 'dark',
      diffPalette: 'default',
      diffLayout: 'unified',
      hideWhitespace: true,
      editor: 'custom',
      editorCommand: 'subl {file}:{line}',
      agentMentions: false,
    };
    expect(parseSettings(settings)).toEqual(settings);
  });
});

describe('updateSettings', () => {
  function stubServer() {
    const answers: ((value: unknown) => void)[] = [];
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Promise((resolve) => {
        answers.push((value) => resolve({ ok: true, json: async () => value }));
      });
    });
    return { answers, bodies };
  }

  it('applies the patch at once, then the saved settings', async () => {
    stubStorage();
    const { answers, bodies } = stubServer();
    const saving = updateSettings({ theme: 'dark' });
    expect(getSettings().theme).toBe('dark');
    expect(bodies).toEqual([{ theme: 'dark' }]);
    answers[0]({ ...DEFAULT_SETTINGS, theme: 'dark', diffLayout: 'unified' });
    await saving;
    expect(getSettings()).toMatchObject({ theme: 'dark', diffLayout: 'unified' });
  });

  it('drops the answer of a save that a later one overtook', async () => {
    const items = stubStorage();
    const { answers } = stubServer();
    const first = updateSettings({ hideWhitespace: true });
    const second = updateSettings({ hideWhitespace: false });
    answers[1]({ ...DEFAULT_SETTINGS, hideWhitespace: false });
    await second;
    answers[0]({ ...DEFAULT_SETTINGS, hideWhitespace: true });
    await first;
    expect(getSettings().hideWhitespace).toBe(false);
    expect(JSON.parse(items.get('diffity-settings')!).hideWhitespace).toBe(false);
  });
});
