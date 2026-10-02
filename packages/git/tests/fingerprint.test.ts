import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { utimesSync } from 'node:fs';
import { join } from 'node:path';
import { getDiffFingerprint, getTreeFingerprint } from '../src/fingerprint.js';
import { createRepo, type TempRepo } from './helpers.js';

let repo: TempRepo;
let origCwd: string;

/** Writes `content` with an mtime `seconds` from now, so a rewrite in the same tick still moves it. */
function rewrite(name: string, content: string, seconds: number) {
  repo.write(name, content);
  const time = Date.now() / 1000 + seconds;
  utimesSync(join(repo.dir, name), time, time);
}

function fingerprints() {
  return {
    work: getDiffFingerprint('work'),
    staged: getDiffFingerprint('staged'),
    unstaged: getDiffFingerprint('unstaged'),
    tree: getTreeFingerprint(),
  };
}

beforeEach(() => {
  origCwd = process.cwd();
  repo = createRepo();
  repo.write('a.txt', 'one\n');
  repo.write('sub/b.txt', 'bee\n');
  repo.commit('initial');
  process.chdir(repo.dir);
});

afterEach(() => {
  process.chdir(origCwd);
  repo.remove();
});

describe('getDiffFingerprint', () => {
  it('stays the same while nothing changes', () => {
    repo.write('a.txt', 'two\n');
    repo.write('new.txt', 'new\n');
    expect(fingerprints()).toEqual(fingerprints());
  });

  it('changes on a same size rewrite of a modified file', () => {
    repo.write('a.txt', 'two\n');
    const stat = repo.git('diff', '--stat');
    const before = fingerprints();
    rewrite('a.txt', 'owt\n', 10);
    expect(repo.git('diff', '--stat')).toBe(stat);
    const after = fingerprints();
    expect(after.work).not.toBe(before.work);
    expect(after.unstaged).not.toBe(before.unstaged);
    expect(after.tree).not.toBe(before.tree);
    expect(after.staged).toBe(before.staged);
  });

  it('changes on an edit to an untracked file', () => {
    repo.write('new.txt', 'new\n');
    const before = fingerprints();
    rewrite('new.txt', 'wen\n', 10);
    const after = fingerprints();
    expect(after.work).not.toBe(before.work);
    expect(after.tree).not.toBe(before.tree);
    expect(after.unstaged).toBe(before.unstaged);
    expect(after.staged).toBe(before.staged);
  });

  it('changes on staging', () => {
    repo.write('a.txt', 'two\n');
    const before = fingerprints();
    repo.git('add', 'a.txt');
    const staged = fingerprints();
    expect(staged.staged).not.toBe(before.staged);
    expect(staged.unstaged).not.toBe(before.unstaged);
    expect(staged.work).not.toBe(before.work);

    rewrite('a.txt', 'three\n', 10);
    expect(getDiffFingerprint('staged')).toBe(staged.staged);
  });

  it('changes on commit', () => {
    repo.write('a.txt', 'two\n');
    repo.git('add', 'a.txt');
    const initial = repo.git('rev-parse', 'HEAD').trim();
    const before = fingerprints();
    const range = getDiffFingerprint(`${initial}..HEAD`);
    repo.git('commit', '-q', '-m', 'second');
    const after = fingerprints();
    expect(after.work).not.toBe(before.work);
    expect(after.staged).not.toBe(before.staged);
    expect(after.tree).not.toBe(before.tree);
    expect(getDiffFingerprint(`${initial}..HEAD`)).not.toBe(range);
  });

  it('reads the working tree for a single ref but not for a range', () => {
    repo.write('a.txt', 'two\n');
    repo.commit('second');
    const range = getDiffFingerprint('HEAD~1..HEAD');
    const single = getDiffFingerprint('HEAD~1');
    repo.write('new.txt', 'new\n');
    expect(getDiffFingerprint('HEAD~1..HEAD')).toBe(range);
    expect(getDiffFingerprint('HEAD~1')).not.toBe(single);
  });

  it('changes when a submodule moves to another commit', () => {
    const sub = createRepo();
    for (const n of [1, 2, 3]) {
      sub.write('src/f.txt', `${n}\n`);
      sub.commit(`c${n}`);
    }
    repo.git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub.dir, 'vendor');
    repo.commit('add submodule');
    const inSub = (...args: string[]) => repo.git('-C', 'vendor', ...args);
    try {
      inSub('checkout', '-q', 'HEAD~1');
      const first = fingerprints();
      inSub('checkout', '-q', 'HEAD~1');
      const second = fingerprints();
      expect(second.work).not.toBe(first.work);
      expect(second.unstaged).not.toBe(first.unstaged);
      expect(second.tree).not.toBe(first.tree);
      expect(second.staged).toBe(first.staged);
    } finally {
      sub.remove();
    }
  });

  it('stats files relative to the root from a subdirectory', () => {
    repo.write('sub/b.txt', 'bea\n');
    process.chdir(join(repo.dir, 'sub'));
    const before = getDiffFingerprint('work');
    rewrite('sub/b.txt', 'bed\n', 10);
    expect(getDiffFingerprint('work')).not.toBe(before);
  });
});
