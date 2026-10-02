import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { basename, delimiter, join, resolve } from 'node:path';

/** A file or folder of the repo to open, at a line and column when known. */
export interface EditorTarget {
  root: string;
  /** Absolute. */
  path: string;
  isDir: boolean;
  line?: number;
  column?: number;
}

export interface EditorLaunch {
  command: string;
  args: string[];
}

interface KnownEditor {
  id: string;
  name: string;
  /** Commands it installs, the first one on PATH runs. */
  commands: string[];
  args: (target: EditorTarget) => string[];
}

/** `path:line:column` for a file with a line, else the path. */
function location(target: EditorTarget): string {
  if (target.isDir || !target.line) {
    return target.path;
  }
  return target.column ? `${target.path}:${target.line}:${target.column}` : `${target.path}:${target.line}`;
}

/** VS Code and its forks open the file in the window of the repo. */
function vscodeArgs(target: EditorTarget): string[] {
  return [target.root, '--goto', location(target)];
}

function jetbrainsArgs(target: EditorTarget): string[] {
  if (target.isDir || !target.line) {
    return [target.path];
  }
  return ['--line', String(target.line), ...(target.column ? ['--column', String(target.column)] : []), target.path];
}

/** Editors found on PATH, in the order the automatic choice tries them. */
const KNOWN_EDITORS: KnownEditor[] = [
  { id: 'code', name: 'VS Code', commands: ['code'], args: vscodeArgs },
  { id: 'cursor', name: 'Cursor', commands: ['cursor'], args: vscodeArgs },
  { id: 'code-insiders', name: 'VS Code Insiders', commands: ['code-insiders'], args: vscodeArgs },
  { id: 'zed', name: 'Zed', commands: ['zed', 'zeditor'], args: (target) => [location(target)] },
  { id: 'subl', name: 'Sublime Text', commands: ['subl'], args: (target) => [location(target)] },
  { id: 'idea', name: 'IntelliJ IDEA', commands: ['idea'], args: jetbrainsArgs },
];

export const EDITOR_IDS = KNOWN_EDITORS.map((editor) => editor.id);

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Whether `command` runs: a path, relative to `cwd`, or a name on `pathList`. */
export function commandExists(command: string, cwd: string, pathList = process.env.PATH ?? ''): boolean {
  if (command.includes('/')) {
    return isExecutable(resolve(cwd, command));
  }
  return pathList.split(delimiter).some((dir) => dir !== '' && isExecutable(join(dir, command)));
}

export interface DetectedEditor {
  id: string;
  name: string;
  command: string;
}

/** The known editors whose command is on `pathList`. */
export function findEditors(pathList = process.env.PATH ?? ''): DetectedEditor[] {
  return KNOWN_EDITORS.flatMap((editor) => {
    const command = editor.commands.find((name) => commandExists(name, '/', pathList));
    return command ? [{ id: editor.id, name: editor.name, command }] : [];
  });
}

let detected: DetectedEditor[] | null = null;

/** `findEditors` for the server's PATH, looked up once. */
export function detectEditors(): DetectedEditor[] {
  detected ??= findEditors();
  return detected;
}

/**
 * Splits a command line into the program and its arguments like a POSIX
 * shell, without expanding anything: whitespace separates, quotes group,
 * and a backslash escapes the next character outside single quotes (in
 * double quotes only `"` and `\`). `null` for an unclosed quote.
 */
export function splitCommand(line: string): string[] | null {
  const args: string[] = [];
  let current = '';
  let started = false;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (quote === "'") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
    } else if (char === '\\' && next !== undefined && (quote === null || next === '"' || next === '\\')) {
      current += next;
      started = true;
      i++;
    } else if (quote === '"') {
      if (char === '"') {
        quote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) {
        args.push(current);
        current = '';
        started = false;
      }
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) {
    return null;
  }
  if (started) {
    args.push(current);
  }
  return args;
}

const PLACEHOLDER = /\{(file|line|column)\}/g;

/**
 * The arguments of a custom command for `target`. `{file}`, `{line}` and
 * `{column}` are replaced in each argument, a line or column that is not
 * known reads as 1. The file is appended when no argument has `{file}`.
 */
export function customArgs(argv: string[], target: EditorTarget): string[] {
  const values: Record<string, string> = {
    file: target.path,
    line: String(target.line ?? 1),
    column: String(target.column ?? 1),
  };
  const args = argv.slice(1);
  const expanded = args.map((arg) => arg.replace(PLACEHOLDER, (_, name: string) => values[name]));
  return args.some((arg) => arg.includes('{file}')) ? expanded : [...expanded, target.path];
}

export interface EditorChoice {
  editor: string;
  editorCommand: string;
}

export interface ResolvedEditor {
  /** A known editor's id, or `custom`. */
  id: string;
  name: string;
  launch: (target: EditorTarget) => EditorLaunch;
}

/**
 * The editor that opens files for `choice`: the custom command when it
 * runs, else the chosen known editor when it is installed, else the first
 * one installed. `null` when there is none.
 */
export function resolveEditor(choice: EditorChoice, cwd: string, editors = detectEditors()): ResolvedEditor | null {
  if (choice.editor === 'custom') {
    const argv = splitCommand(choice.editorCommand);
    if (!argv?.length || !commandExists(argv[0], cwd)) {
      return null;
    }
    return { id: 'custom', name: basename(argv[0]), launch: (target) => ({ command: argv[0], args: customArgs(argv, target) }) };
  }
  const editor = editors.find((candidate) => candidate.id === choice.editor) ?? editors[0];
  const known = editor && KNOWN_EDITORS.find((candidate) => candidate.id === editor.id);
  if (!editor || !known) {
    return null;
  }
  return { id: editor.id, name: editor.name, launch: (target) => ({ command: editor.command, args: known.args(target) }) };
}

/** Starts the editor on its own, without a shell. Resolves once it runs, rejects when it cannot start. */
export function launchEditor(launch: EditorLaunch, cwd: string): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(launch.command, launch.args, { cwd, detached: true, stdio: 'ignore' });
    child.once('error', fail);
    child.once('spawn', () => {
      child.unref();
      done();
    });
  });
}
