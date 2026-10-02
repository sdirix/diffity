import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { commandExists, customArgs, findEditors, launchEditor, resolveEditor, splitCommand, type EditorTarget } from '../src/editor.js';

const file: EditorTarget = { root: '/repo', path: '/repo/src/a b.ts', isDir: false, line: 12, column: 3 };
const folder: EditorTarget = { root: '/repo', path: '/repo/src', isDir: true };

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'diffity-editor-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function script(path: string, body = 'exit 0') {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

describe('splitCommand', () => {
  it('splits on whitespace and groups quotes like a shell', () => {
    expect(splitCommand('  subl  {file}:{line} ')).toEqual(['subl', '{file}:{line}']);
    expect(splitCommand(`"/opt/My Editor/edit" --goto '{file}:{line}' a\\ b`)).toEqual(['/opt/My Editor/edit', '--goto', '{file}:{line}', 'a b']);
    expect(splitCommand(`ed "say \\"hi\\" \\n" '\\x' ""`)).toEqual(['ed', 'say "hi" \\n', '\\x', '']);
    expect(splitCommand('')).toEqual([]);
  });

  it('expands nothing', () => {
    expect(splitCommand('ed $HOME `id` ~ *.ts; rm -rf /')).toEqual(['ed', '$HOME', '`id`', '~', '*.ts;', 'rm', '-rf', '/']);
  });

  it('refuses an unclosed quote', () => {
    expect(splitCommand('ed "{file}')).toBeNull();
    expect(splitCommand("ed '{file}")).toBeNull();
  });
});

describe('customArgs', () => {
  it('fills in the placeholders of each argument', () => {
    expect(customArgs(['ed', '--goto', '{file}:{line}:{column}'], file)).toEqual(['--goto', '/repo/src/a b.ts:12:3']);
    expect(customArgs(['idea', '--line', '{line}', '{file}'], folder)).toEqual(['--line', '1', '/repo/src']);
  });

  it('appends the file without a {file} placeholder', () => {
    expect(customArgs(['ed', '-w'], file)).toEqual(['-w', '/repo/src/a b.ts']);
    expect(customArgs(['ed'], folder)).toEqual(['/repo/src']);
  });
});

describe('editors', () => {
  it('are found on PATH, the first installed command of each', () => {
    script(join(dir, 'a', 'cursor'));
    script(join(dir, 'b', 'zeditor'));
    script(join(dir, 'b', 'code'));
    writeFileSync(join(dir, 'b', 'subl'), 'not executable');
    expect(findEditors(`${join(dir, 'a')}:${join(dir, 'b')}`)).toEqual([
      { id: 'code', name: 'VS Code', command: 'code' },
      { id: 'cursor', name: 'Cursor', command: 'cursor' },
      { id: 'zed', name: 'Zed', command: 'zeditor' },
    ]);
    expect(findEditors('')).toEqual([]);
  });

  it('resolve to the chosen one, else the first installed', () => {
    const editors = [
      { id: 'code', name: 'VS Code', command: 'code' },
      { id: 'zed', name: 'Zed', command: 'zed' },
    ];
    const zed = resolveEditor({ editor: 'zed', editorCommand: '' }, dir, editors)!;
    expect(zed.launch(file)).toEqual({ command: 'zed', args: ['/repo/src/a b.ts:12:3'] });
    const auto = resolveEditor({ editor: 'subl', editorCommand: '' }, dir, editors)!;
    expect(auto.launch({ ...file, column: undefined })).toEqual({ command: 'code', args: ['/repo', '--goto', '/repo/src/a b.ts:12'] });
    expect(resolveEditor({ editor: 'auto', editorCommand: '' }, dir, [])).toBeNull();
  });

  it('resolve a custom command only when it runs', () => {
    script(join(dir, 'bin', 'my ed'));
    const custom = resolveEditor({ editor: 'custom', editorCommand: '"./bin/my ed" {file}' }, dir, [])!;
    expect(custom).toMatchObject({ id: 'custom', name: 'my ed' });
    expect(custom.launch(file)).toEqual({ command: './bin/my ed', args: ['/repo/src/a b.ts'] });
    expect(resolveEditor({ editor: 'custom', editorCommand: './bin/missing {file}' }, dir, [])).toBeNull();
    expect(resolveEditor({ editor: 'custom', editorCommand: '' }, dir, [])).toBeNull();
    expect(commandExists('sh', dir)).toBe(true);
  });

  it('launch without a shell, passing each argument as is', async () => {
    const out = join(dir, 'args.txt');
    script(join(dir, 'ed'), `for a in "$@"; do printf '%s\\n' "$a" >> "${out}"; done`);
    await launchEditor({ command: join(dir, 'ed'), args: ['a b', '$(id)', '{x}'] }, dir);
    for (let i = 0; i < 50 && !readFileSafe(out).includes('{x}'); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(readFileSafe(out)).toBe('a b\n$(id)\n{x}\n');
    await expect(launchEditor({ command: join(dir, 'missing'), args: [] }, dir)).rejects.toThrow('ENOENT');
  });
});

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}
