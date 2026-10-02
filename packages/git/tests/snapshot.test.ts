import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { InputError } from '../src/errors.js';
import { getFileLineCounts } from '../src/diff.js';
import { getChangesSinceBlob, getNewSideBlobs, SNAPSHOT_MAX_BYTES, snapshotNewSide } from '../src/snapshot.js';
import { createRepo, type TempRepo } from './helpers.js';

let repo: TempRepo;
let origCwd: string;

beforeEach(() => {
  origCwd = process.cwd();
  repo = createRepo();
  repo.write('base.txt', 'base\n');
  repo.commit('initial');
  process.chdir(repo.dir);
});

afterEach(() => {
  process.chdir(origCwd);
  repo.remove();
});

function errorCode(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof InputError ? err.code : 'other';
  }
}

describe('snapshotNewSide', () => {
  it('keeps working tree content that later edits do not change', () => {
    repo.write('app.ts', 'one\ntwo\n');
    const [snapshot] = snapshotNewSide('work', ['app.ts']);
    expect(snapshot.kept).toBe(true);
    expect(repo.git('cat-file', '-p', snapshot.blob!)).toBe('one\ntwo\n');
    expect(getNewSideBlobs('work', ['app.ts'])).toEqual([snapshot.blob]);

    repo.write('app.ts', 'changed\n');
    expect(repo.git('cat-file', '-p', snapshot.blob!)).toBe('one\ntwo\n');
    expect(getNewSideBlobs('work', ['app.ts'])).not.toEqual([snapshot.blob]);
  });

  it('hashes but does not keep missing, binary and large files', () => {
    repo.write('image.bin', Buffer.from([0, 1, 2, 0]));
    repo.write('huge.txt', 'x'.repeat(SNAPSHOT_MAX_BYTES + 1));
    const [missing, binary, huge] = snapshotNewSide('work', ['missing.ts', 'image.bin', 'huge.txt']);
    expect(missing).toEqual({ blob: null, kept: false });
    expect(binary.kept).toBe(false);
    expect(huge.kept).toBe(false);
    expect(getNewSideBlobs('work', ['missing.ts', 'image.bin', 'huge.txt'])).toEqual([null, binary.blob, huge.blob]);
    repo.git('add', 'image.bin', 'huge.txt');
    expect(repo.git('rev-parse', ':image.bin', ':huge.txt').trim().split('\n')).toEqual([binary.blob, huge.blob]);
  });

  it('stores a symlink as its target like git does', () => {
    symlinkSync('base.txt', join(repo.dir, 'link'));
    const [snapshot] = snapshotNewSide('work', ['link']);
    repo.git('add', 'link');
    expect(snapshot).toEqual({ blob: repo.git('rev-parse', ':link').trim(), kept: true });
  });

  it('reads the index of staged changes and the right end of a range', () => {
    repo.write('a.txt', 'v1\n');
    repo.commit('v1');
    repo.write('a.txt', 'v2\n');
    repo.git('add', 'a.txt');
    repo.write('a.txt', 'v3\n');

    expect(snapshotNewSide('staged', ['a.txt'])).toEqual([{ blob: repo.git('rev-parse', ':a.txt').trim(), kept: true }]);
    expect(snapshotNewSide('HEAD~1..HEAD', ['a.txt', 'gone.txt'])).toEqual([
      { blob: repo.git('rev-parse', 'HEAD:a.txt').trim(), kept: true },
      { blob: null, kept: false },
    ]);
    expect(getNewSideBlobs('staged', ['a.txt\nb'])).toEqual([null]);
  });

  it('reads names that end in a carriage return or hold a newline', () => {
    const names = ['cr', 'cr\r', 'new\nline'];
    names.forEach((name, i) => repo.write(name, 'x\n'.repeat(i + 1)));
    repo.commit('names');
    const head = repo.git('rev-parse', 'HEAD').trim();
    const blobs = names.map((name) => repo.git('rev-parse', `HEAD:${name}`).trim());
    expect(new Set(blobs).size).toBe(3);

    expect(getFileLineCounts(names, { type: 'ref', ref: head })).toEqual([1, 2, 3]);
    expect(snapshotNewSide('work', names)).toEqual(blobs.map((blob) => ({ blob, kept: true })));
    expect(getNewSideBlobs('work', names)).toEqual(blobs);
    expect(snapshotNewSide('staged', names)).toEqual(blobs.map((blob) => ({ blob, kept: true })));
    expect(getNewSideBlobs(`${head}~1..${head}`, names)).toEqual(blobs);
  });

  it('rejects paths outside the repository', () => {
    expect(errorCode(() => snapshotNewSide('work', ['../x']))).toBe('invalid');
  });
});

describe('getChangesSinceBlob', () => {
  it('diffs the kept version against the current one under the file name', () => {
    repo.write('app.ts', 'one\ntwo\n');
    const [{ blob }] = snapshotNewSide('work', ['app.ts']);
    expect(getChangesSinceBlob('work', 'app.ts', blob!)).toBe('');

    repo.write('app.ts', 'one\nTWO\nthree\n');
    const patch = getChangesSinceBlob('work', 'app.ts', blob!);
    expect(patch.startsWith('diff --git a/app.ts b/app.ts\n')).toBe(true);
    expect(patch).toContain('--- a/app.ts\n+++ b/app.ts\n');
    expect(patch).toContain('-two\n+TWO\n+three\n');
    expect(patch).not.toContain(blob!);
  });

  it('quotes names like git', () => {
    repo.write('sp ace.txt', 'a\n');
    const [{ blob }] = snapshotNewSide('work', ['sp ace.txt']);
    repo.write('sp ace.txt', 'b\n');
    expect(getChangesSinceBlob('work', 'sp ace.txt', blob!)).toContain('--- a/sp ace.txt\t\n+++ b/sp ace.txt\t\n@@ -1 +1 @@\n-a\n+b\n');
  });

  it('shows a deleted file as emptied', () => {
    repo.write('app.ts', 'one\n');
    const [{ blob }] = snapshotNewSide('work', ['app.ts']);
    rmSync(join(repo.dir, 'app.ts'));
    expect(getChangesSinceBlob('work', 'app.ts', blob!)).toContain('-one\n');
  });

  it('writes nothing to the repository', () => {
    repo.write('app.ts', 'one\n');
    repo.git('add', 'app.ts');
    const [{ blob: worktree }] = snapshotNewSide('work', ['app.ts']);
    const [{ blob: staged }] = snapshotNewSide('staged', ['app.ts']);
    repo.write('app.ts', 'two\n');
    const objects = () => repo.git('count-objects', '-v');
    const before = objects();

    expect(getChangesSinceBlob('work', 'app.ts', worktree!)).toContain('-one\n+two\n');
    rmSync(join(repo.dir, 'app.ts'));
    expect(getChangesSinceBlob('work', 'app.ts', worktree!)).toContain('-one\n');
    repo.git('rm', '-q', '--cached', 'app.ts');
    expect(getChangesSinceBlob('staged', 'app.ts', staged!)).toContain('-one\n');
    expect(objects()).toBe(before);
  });

  it('fails for a version that is gone, malformed or binary now', () => {
    repo.write('app.ts', 'one\n');
    const [{ blob }] = snapshotNewSide('work', ['app.ts']);
    expect(errorCode(() => getChangesSinceBlob('work', 'app.ts', '0123456789abcdef0123456789abcdef01234567'))).toBe('not_found');
    expect(errorCode(() => getChangesSinceBlob('work', 'app.ts', 'HEAD'))).toBe('not_found');
    repo.write('app.ts', Buffer.from([0, 1]));
    expect(errorCode(() => getChangesSinceBlob('work', 'app.ts', blob!))).toBe('invalid');
  });
});
