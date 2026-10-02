import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  getDiffFiles,
  getFileContent,
  getIndexFileContent,
  resolveBaseRef,
  resolveRef,
  revertFile,
} from '../src/diff.js';
import { InputError } from '../src/errors.js';
import { getWorkingTreeFileContent } from '../src/tree.js';
import { createRepo, type TempRepo } from './helpers.js';

const NAMES = [
  'with space.txt',
  '$(touch pwned).txt',
  '`touch pwned`.txt',
  'semi; touch pwned.txt',
  `quo'te.txt`,
  'dollar $HOME.txt',
];

let repo: TempRepo;
let origCwd: string;

function pwned(): boolean {
  return existsSync(join(repo.dir, 'pwned')) || existsSync(join(origCwd, 'pwned'));
}

beforeAll(() => {
  origCwd = process.cwd();
  repo = createRepo();
  for (const name of NAMES) {
    repo.write(name, `${name}\n`);
  }
  repo.commit('initial');
  process.chdir(repo.dir);
});

afterAll(() => {
  process.chdir(origCwd);
  repo.remove();
});

describe('paths with shell metacharacters', () => {
  it('reads committed and indexed content without running a shell', () => {
    for (const name of NAMES) {
      expect(getFileContent(name, 'HEAD')).toBe(`${name}\n`);
      expect(getIndexFileContent(name)).toBe(`${name}\n`);
      expect(getWorkingTreeFileContent(name)).toBe(`${name}\n`);
    }
    expect(pwned()).toBe(false);
  });

  it('diffs and reverts tracked and untracked files', () => {
    for (const name of NAMES) {
      repo.write(name, 'changed\n');
      repo.write(`new ${name}`, 'untracked\n');
    }

    const raw = resolveRef('work');
    const files = getDiffFiles('work');
    for (const name of NAMES) {
      expect(raw).toContain(`+++ b/${name}`);
      expect(raw).toContain(`+++ b/new ${name}`);
      expect(files).toContain(name);
      expect(files).toContain(`new ${name}`);
    }

    for (const name of NAMES) {
      revertFile(name);
      revertFile(`new ${name}`);
      expect(repo.read(name)).toBe(`${name}\n`);
      expect(existsSync(join(repo.dir, `new ${name}`))).toBe(false);
    }
    expect(repo.git('status', '--porcelain')).toBe('');
    expect(pwned()).toBe(false);
  });
});

describe('refs that look like options', () => {
  it('rejects them before they reach git', () => {
    for (const ref of ['--output=pwned', 'main..--output=pwned', 'main...--output=pwned', '--output=pwned..main']) {
      expect(() => resolveRef(ref)).toThrow(InputError);
      expect(() => resolveBaseRef(ref)).toThrow(InputError);
    }
    expect(() => getFileContent(NAMES[0], '--output=pwned')).toThrow();
    expect(pwned()).toBe(false);
  });
});
