import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getRefDiff, getRefFilePatch } from '../src/diff.js';
import { createRepo, type TempRepo } from './helpers.js';

let repo: TempRepo;
let origCwd: string;
let origHome: string | undefined;
let home: string;

/** The `diff --git` section of `patch` whose header ends in `b/<path>`. */
function section(patch: string, path: string): string {
  return patch.split(/^(?=diff --git )/m).find((part) => part.split('\n')[0].endsWith(` b/${path}`)) ?? '';
}

beforeEach(() => {
  origCwd = process.cwd();
  origHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), 'diffity-home-'));
  process.env.HOME = home;
  repo = createRepo();
  repo.write('big.txt', Array.from({ length: 200 }, (_, i) => `line ${i}\n`).join(''));
  repo.write('small.txt', 'a\n');
  repo.write('old name.txt', 'one\ntwo\nthree\nfour\n');
  repo.write('dist/out.js', 'a\n');
  repo.commit('initial');
  process.chdir(repo.dir);
});

afterEach(() => {
  process.chdir(origCwd);
  process.env.HOME = origHome;
  repo.remove();
  rmSync(home, { recursive: true, force: true });
});

describe('getRefFilePatch', () => {
  it('returns the section of the full diff for a tracked, an untracked and a renamed file', () => {
    repo.write('big.txt', Array.from({ length: 200 }, (_, i) => `changed ${i}\n`).join(''));
    repo.write('small.txt', 'b\n');
    repo.write('new big.txt', Array.from({ length: 200 }, (_, i) => `new ${i}\n`).join(''));
    repo.git('mv', 'old name.txt', 'new name.txt');
    repo.write('new name.txt', 'one\ntwo\nthree\nfour!\n');

    const { patch } = getRefDiff('work');
    expect(getRefFilePatch('work', 'big.txt', null)).toBe(section(patch, 'big.txt'));
    expect(getRefFilePatch('work', 'new big.txt', null)).toBe(section(patch, 'new big.txt'));
    expect(getRefFilePatch('work', 'new name.txt', 'old name.txt')).toBe(section(patch, 'new name.txt'));
    expect(getRefFilePatch('work', 'big.txt', null)).toContain('+changed 199');
  });

  it('follows the ref and the extra arguments', () => {
    repo.write('small.txt', 'a \n');
    repo.write('new.txt', 'x\n');
    expect(getRefFilePatch('work', 'small.txt', null)).toContain('+a ');
    expect(getRefFilePatch('work', 'small.txt', null, ['-w'])).toBe('');
    expect(getRefFilePatch('staged', 'small.txt', null)).toBe('');
    expect(getRefFilePatch('staged', 'new.txt', null)).toBe('');
    repo.git('add', 'small.txt');
    expect(getRefFilePatch('staged', 'small.txt', null)).toContain('+a ');
    repo.commit('second');
    expect(getRefFilePatch('HEAD~1..HEAD', 'small.txt', null)).toContain('+a ');
  });

  it('leaves out files .diffityignore hides unless they are shown', () => {
    repo.write('.diffityignore', 'dist/\n');
    repo.write('dist/out.js', 'b\n');
    expect(getRefFilePatch('work', 'dist/out.js', null)).toBe('');
    expect(getRefFilePatch('work', 'dist/out.js', null, [], { showHidden: true })).toContain('+b');
  });

  it('treats the path literally and rejects paths outside the repo', () => {
    repo.write('small.txt', 'b\n');
    expect(getRefFilePatch('work', '*.txt', null)).toBe('');
    expect(() => getRefFilePatch('work', '../outside.txt', null)).toThrow(/Invalid path/);
  });
});
