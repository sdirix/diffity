import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { parseDiff } from '../../parser/src/index.js';
import { getUntrackedFiles } from '../src/diff.js';
import { getUntrackedDiff } from '../src/untracked.js';
import { createRepo, type TempRepo } from './helpers.js';

const FILES: Record<string, string | Buffer> = {
  'multi.txt': 'one\ntwo\nthree\n',
  'single.txt': 'only\n',
  'no-eol.txt': 'a\nb',
  'blank-lines.txt': '\n\n  indented\n\n',
  'empty.txt': '',
  'crlf.txt': 'a\r\nb\r\n',
  'blob.bin': Buffer.from([1, 0, 2, 10]),
  'late-nul.bin': Buffer.concat([Buffer.alloc(9000, 'a'), Buffer.from([0])]),
  'latin1.txt': Buffer.from([0xff, 0xfe, 0x0a]),
  'ünïcødé.txt': 'ü\n',
  'sp ace.txt': 'x\n',
  'q"uote.txt': 'q\n',
  'sp "both.txt': 'b\n',
  'tab\there.txt': 't\n',
  'back\\slash.txt': 's\n',
  'dir/nested.txt': 'n\n',
  'run.sh': '#!/bin/sh\n',
  'group-exec.sh': 'g\n',
  'ignored-diff.lock': 'looks like text\n',
  'forced-text.dat': Buffer.from('a\0b\n'),
};

let repo: TempRepo;
let origCwd: string;

function gitNoIndex(path: string): string {
  try {
    execFileSync('git', [
      '-c', 'core.quotepath=off', 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/',
      '--no-index', '--', '/dev/null', path,
    ], { cwd: repo.dir, stdio: 'pipe' });
  } catch (err) {
    return (err as { stdout: Buffer }).stdout.toString('utf-8');
  }
  throw new Error(`git diff --no-index found no difference for ${path}`);
}

function withoutIndexLine(patch: string): string {
  return patch.replace(/^index .*\n/m, '');
}

beforeAll(() => {
  origCwd = process.cwd();
  repo = createRepo();
  repo.write('.gitattributes', '*.lock -diff\n*.dat diff\n');
  repo.commit('attributes');
  for (const [name, content] of Object.entries(FILES)) {
    repo.write(name, content);
  }
  chmodSync(join(repo.dir, 'run.sh'), 0o755);
  chmodSync(join(repo.dir, 'group-exec.sh'), 0o654);
  symlinkSync('multi.txt', join(repo.dir, 'link'));
  process.chdir(repo.dir);
});

afterAll(() => {
  process.chdir(origCwd);
  repo.remove();
});

describe('synthesized untracked patches', () => {
  it('match git diff --no-index byte for byte', () => {
    const files = getUntrackedFiles();
    expect(files.sort()).toEqual([...Object.keys(FILES), 'link'].sort());

    for (const file of files) {
      expect(getUntrackedDiff([file]), file).toBe(withoutIndexLine(gitNoIndex(file)));
    }
  });

  it('parse like the patches git prints', () => {
    const files = getUntrackedFiles();
    const synthesized = parseDiff(getUntrackedDiff(files));
    const fromGit = parseDiff(files.map((file) => gitNoIndex(file)).join(''));
    expect(synthesized).toEqual(fromGit);
    expect(synthesized.files.find((f) => f.newPath === 'tab\there.txt')?.status).toBe('added');
    expect(synthesized.files.find((f) => f.newPath === 'ignored-diff.lock')?.isBinary).toBe(true);
    expect(synthesized.files.find((f) => f.newPath === 'run.sh')?.newMode).toBe('100755');
  });

  it('skips files that vanished', () => {
    expect(getUntrackedDiff([])).toBe('');
    expect(getUntrackedDiff(['gone.txt'])).toBe('');
  });
});
