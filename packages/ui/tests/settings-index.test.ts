import { describe, expect, it } from 'vitest';
import { SECTION_LABELS, SETTINGS_ITEMS, searchSettings } from '../src/lib/settings-index';

describe('searchSettings', () => {
  it('matches labels, keywords and section names, every word', () => {
    expect(searchSettings('theme').map((item) => item.id)).toEqual(['theme']);
    expect(searchSettings('DARK').map((item) => item.id)).toEqual(['theme']);
    expect(searchSettings('colorblind').map((item) => item.id)).toEqual(['diff-colours']);
    expect(searchSettings('diff hidden').map((item) => item.id)).toEqual(['hidden-files']);
    expect(searchSettings('data').map((item) => item.id)).toEqual(['clear-data']);
    expect(searchSettings('nothing like this')).toEqual([]);
  });

  it('finds everything for a blank query', () => {
    expect(searchSettings('  ')).toEqual(SETTINGS_ITEMS);
  });

  it('gives each item a unique id and a known section', () => {
    expect(new Set(SETTINGS_ITEMS.map((item) => item.id)).size).toBe(SETTINGS_ITEMS.length);
    for (const item of SETTINGS_ITEMS) {
      expect(SECTION_LABELS[item.section], item.id).toBeDefined();
    }
  });
});
