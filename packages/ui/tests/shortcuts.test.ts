import { describe, expect, it } from 'vitest';
import { chord, SHORTCUT_SECTIONS, shortcutHint } from '../src/lib/shortcuts';

describe('chord', () => {
  it('prefixes the mod key, then shift', () => {
    expect(chord('F')).toBe('Ctrl+F');
    expect(chord('G', { shift: true })).toBe('Ctrl+Shift+G');
  });
});

describe('SHORTCUT_SECTIONS', () => {
  const shortcuts = SHORTCUT_SECTIONS.flatMap((section) => section.shortcuts);

  it('gives each id to one shortcut', () => {
    const ids = shortcuts.flatMap((shortcut) => (shortcut.id ? [shortcut.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lists at least one key per shortcut', () => {
    for (const shortcut of shortcuts) {
      expect(shortcut.keys.length, shortcut.label).toBeGreaterThan(0);
    }
  });

  it('keeps labels unique within a section', () => {
    for (const section of SHORTCUT_SECTIONS) {
      const labels = section.shortcuts.map((shortcut) => shortcut.label);
      expect(new Set(labels).size, section.title).toBe(labels.length);
    }
  });
});

describe('shortcutHint', () => {
  it('returns the first key of the shortcut', () => {
    expect(shortcutHint('find')).toBe('Ctrl+F');
    expect(shortcutHint('ref-menu')).toBe('w');
  });

  it('returns undefined for unknown ids', () => {
    expect(shortcutHint('nope')).toBeUndefined();
  });
});
