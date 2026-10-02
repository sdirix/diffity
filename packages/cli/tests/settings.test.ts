import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { readSettings, settingsPath, updateSettings, updateSettingsFromRequest } from '../src/settings.js';

let home: string;
const origHome = process.env.HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'diffity-settings-home-'));
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

function writeFile(data: unknown) {
  mkdirSync(dirname(settingsPath()), { recursive: true });
  writeFileSync(settingsPath(), typeof data === 'string' ? data : JSON.stringify(data));
}

describe('settings', () => {
  it('live in the home diffity dir', () => {
    expect(settingsPath()).toBe(join(home, '.diffity', 'settings.json'));
  });

  it('read as defaults without a file or with a broken one', () => {
    const defaults = {
      theme: 'system',
      diffPalette: 'default',
      diffLayout: 'split',
      hideWhitespace: false,
      editor: 'auto',
      editorCommand: '',
      agentMentions: true,
    };
    expect(readSettings()).toEqual(defaults);
    writeFile('{broken');
    expect(readSettings()).toEqual(defaults);
    writeFile([1, 2]);
    expect(readSettings()).toEqual(defaults);
  });

  it('replace invalid stored values with defaults', () => {
    writeFile({ theme: 'dark', diffLayout: 'sideways', hideWhitespace: 'yes' });
    expect(readSettings()).toMatchObject({ theme: 'dark', diffLayout: 'split', hideWhitespace: false });
  });

  it('save a patch and keep unknown keys', () => {
    writeFile({ theme: 'light', fromNewerVersion: { a: 1 } });
    expect(updateSettings({ diffLayout: 'unified', hideWhitespace: true })).toMatchObject({
      theme: 'light',
      diffLayout: 'unified',
      hideWhitespace: true,
    });
    const stored = JSON.parse(readFileSync(settingsPath(), 'utf-8'));
    expect(stored).toEqual({ theme: 'light', fromNewerVersion: { a: 1 }, diffLayout: 'unified', hideWhitespace: true });
    expect(readdirSync(dirname(settingsPath()))).toEqual(['settings.json']);
  });

  it('refuse unknown keys and invalid values without saving', () => {
    updateSettings({ theme: 'dark' });
    expect(() => updateSettings({ theme: 'light', colour: 'red' })).toThrow('Unknown setting: colour');
    expect(() => updateSettings({ diffPalette: 'neon' })).toThrow('Invalid value for diffPalette');
    expect(() => updateSettings({ toString: 'x' })).toThrow('Unknown setting');
    expect(() => updateSettings({ editor: 'notepad' })).toThrow('Invalid value for editor');
    expect(() => updateSettings({ editorCommand: 'subl "{file}' })).toThrow('Invalid value for editorCommand');
    expect(readSettings().theme).toBe('dark');
  });

  it('keep the editor command out of reach of requests', () => {
    updateSettings({ editorCommand: 'subl {file}' });
    expect(() => updateSettingsFromRequest({ editor: 'custom', editorCommand: 'sh -c "id"' })).toThrow('editorCommand can only be set');
    expect(readSettings()).toMatchObject({ editor: 'auto', editorCommand: 'subl {file}' });
    expect(updateSettingsFromRequest({ editor: 'custom', theme: 'dark' })).toMatchObject({ editor: 'custom', editorCommand: 'subl {file}' });
  });
});
