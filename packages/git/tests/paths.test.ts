import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getFileContent, getIndexFileContent, revertFile } from '../src/diff.js';
import { InputError } from '../src/errors.js';
import { getTreeEntries, getWorkingTreeFileContent, getWorkingTreeRawFile } from '../src/tree.js';
import { createRepo, type TempRepo } from './helpers.js';

let repo: TempRepo;
let outside: string;
let origCwd: string;

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof InputError ? err.code : 'other';
  }
  return undefined;
}

beforeAll(() => {
  origCwd = process.cwd();
  outside = mkdtempSync(join(tmpdir(), 'diffity-outside-'));
  writeFileSync(join(outside, 'secret.txt'), 'secret\n');

  repo = createRepo();
  repo.write('README.md', 'hello\n');
  repo.write('src/app.ts', 'app\n');
  repo.commit('initial');
  symlinkSync(join(outside, 'secret.txt'), join(repo.dir, 'escape'));
  symlinkSync('README.md', join(repo.dir, 'inside'));
  process.chdir(repo.dir);
});

afterAll(() => {
  process.chdir(origCwd);
  repo.remove();
  rmSync(outside, { recursive: true, force: true });
});

describe('request paths', () => {
  it('rejects paths that leave the repo', () => {
    const escapes = ['../secret.txt', 'src/../../secret.txt', join(outside, 'secret.txt'), './README.md', 'src//app.ts', ''];
    for (const path of escapes) {
      expect(code(() => getWorkingTreeFileContent(path))).toBe('invalid');
      expect(code(() => getWorkingTreeRawFile(path))).toBe('invalid');
      expect(code(() => getFileContent(path, 'HEAD'))).toBe('invalid');
      expect(code(() => getIndexFileContent(path))).toBe('invalid');
      expect(code(() => revertFile(path))).toBe('invalid');
    }
    expect(code(() => getTreeEntries('HEAD', '..'))).toBe('invalid');
    expect(code(() => getTreeEntries('HEAD', '/etc'))).toBe('invalid');
  });

  it('rejects symlinks that lead outside the repo', () => {
    expect(code(() => getWorkingTreeFileContent('escape'))).toBe('invalid');
    expect(getWorkingTreeFileContent('inside')).toBe('hello\n');
  });

  it('reports missing files as not found', () => {
    expect(code(() => getWorkingTreeFileContent('missing.txt'))).toBe('not_found');
  });

  it('lists a subdirectory', () => {
    expect(getTreeEntries('HEAD', 'src')).toEqual([{ type: 'blob', path: 'src/app.ts', name: 'app.ts' }]);
  });
});

describe('revertFile', () => {
  it('restores tracked files and removes new ones', () => {
    rmSync(join(repo.dir, 'escape'));
    rmSync(join(repo.dir, 'inside'));
    repo.write('README.md', 'changed\n');
    repo.write('untracked.txt', 'u\n');
    repo.write('added.txt', 'a\n');
    repo.git('add', 'added.txt');
    symlinkSync('README.md', join(repo.dir, 'link'));

    revertFile('README.md');
    revertFile('untracked.txt');
    revertFile('added.txt');
    revertFile('link');

    expect(repo.read('README.md')).toBe('hello\n');
    expect(existsSync(join(repo.dir, 'untracked.txt'))).toBe(false);
    expect(existsSync(join(repo.dir, 'added.txt'))).toBe(false);
    expect(existsSync(join(repo.dir, 'link'))).toBe(false);
    expect(repo.git('status', '--porcelain')).toBe('');
  });

  it('treats paths literally instead of as globs', () => {
    repo.write('README.md', 'changed\n');
    repo.write('src/app.ts', 'changed\n');
    expect(code(() => revertFile('*'))).toBeUndefined();
    expect(repo.read('README.md')).toBe('changed\n');
    expect(code(() => revertFile('src'))).toBe('invalid');
    expect(repo.read('src/app.ts')).toBe('changed\n');
    repo.git('checkout', '--', '.');
  });
});
