import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { InputError } from '@diffity/git';
import { EDITOR_IDS, splitCommand } from './editor.js';

/** Choices shared by the servers of every repo, kept in `~/.diffity/settings.json`. */
export interface Settings {
  theme: 'system' | 'light' | 'dark';
  diffPalette: 'default' | 'colorblind';
  diffLayout: 'split' | 'unified';
  hideWhitespace: boolean;
  /** `auto` for the first editor found, a known editor's id, or `custom` for `editorCommand`. */
  editor: string;
  /** Program and arguments with `{file}`, `{line}` and `{column}`, split like a shell does but run without one. */
  editorCommand: string;
}

interface Field<T> {
  fallback: T;
  valid: (value: unknown) => value is T;
}

function oneOf<T extends string>(values: readonly T[], fallback: T): Field<T> {
  return { fallback, valid: (value): value is T => values.includes(value as T) };
}

function flag(fallback: boolean): Field<boolean> {
  return { fallback, valid: (value): value is boolean => typeof value === 'boolean' };
}

const MAX_COMMAND_LENGTH = 2000;

function commandLine(): Field<string> {
  return {
    fallback: '',
    valid: (value): value is string => typeof value === 'string' && value.length <= MAX_COMMAND_LENGTH && splitCommand(value) !== null,
  };
}

const SCHEMA: { [K in keyof Settings]: Field<Settings[K]> } = {
  theme: oneOf(['system', 'light', 'dark'], 'system'),
  diffPalette: oneOf(['default', 'colorblind'], 'default'),
  diffLayout: oneOf(['split', 'unified'], 'split'),
  hideWhitespace: flag(false),
  editor: oneOf(['auto', 'custom', ...EDITOR_IDS], 'auto'),
  editorCommand: commandLine(),
};

export function settingsPath(): string {
  return join(homedir(), '.diffity', 'settings.json');
}

/** The stored object with the keys of other diffity versions, empty when the file is missing or broken. */
function readStored(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath(), 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Writes a temp file and renames it over the old one, so readers never see half a file. */
function writeStored(data: Record<string, unknown>): void {
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(temp, path);
}

/** Every setting, the default standing in for one that is missing or invalid. */
export function readSettings(): Settings {
  const stored = readStored();
  const settings: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(SCHEMA)) {
    settings[key] = field.valid(stored[key]) ? stored[key] : field.fallback;
  }
  return settings as unknown as Settings;
}

/**
 * Saves `patch` over the stored settings and returns them all. Keys this
 * version does not know stay in the file. An unknown key or invalid value
 * in `patch` throws `InputError` and saves nothing.
 */
export function updateSettings(patch: Record<string, unknown>): Settings {
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(SCHEMA, key)) {
      throw new InputError(`Unknown setting: ${key}`);
    }
    if (!SCHEMA[key as keyof Settings].valid(value)) {
      throw new InputError(`Invalid value for ${key}`);
    }
  }
  writeStored({ ...readStored(), ...patch });
  return readSettings();
}

/**
 * Settings the server runs as a program. The request guard keeps websites
 * out, but any client that reaches the port can send a request, so only
 * `diffity config` and the settings file set them.
 */
const LOCAL_ONLY: ReadonlySet<string> = new Set<keyof Settings>(['editorCommand']);

/** `updateSettings` for a patch from a request, which may not change the `LOCAL_ONLY` settings. */
export function updateSettingsFromRequest(patch: Record<string, unknown>): Settings {
  for (const key of Object.keys(patch)) {
    if (LOCAL_ONLY.has(key)) {
      throw new InputError(`${key} can only be set with diffity config or in ~/.diffity/settings.json`);
    }
  }
  return updateSettings(patch);
}
