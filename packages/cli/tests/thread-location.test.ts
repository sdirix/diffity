import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseDiff } from '@diffity/parser';
import {
  indexDiff,
  locateThread,
  locateTreeThread,
  showsThread,
  type LocatableThread,
} from '../src/thread-location.js';
import { listLocatedThreads, type LocatedThread } from '../src/repo-threads.js';
import { findOrCreateSession, TREE_REF } from '../src/session.js';
import { createThread } from '../src/threads.js';
import { createRepo, type TempRepo } from './helpers.js';

const PATCH = `diff --git a/src/a.rs b/src/a.rs
index 1111111..2222222 100644
--- a/src/a.rs
+++ b/src/a.rs
@@ -1,4 +1,5 @@
 fn main() {
-    old();
+    new();
+    more();
     done();
 }
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 3333333..0000000
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/old.txt b/new.txt
similarity index 80%
rename from old.txt
rename to new.txt
index 4444444..5555555 100644
--- a/old.txt
+++ b/new.txt
@@ -1,2 +1,2 @@
 keep
-was
+is
`;

const index = indexDiff(parseDiff(PATCH));

function thread(partial: Partial<LocatableThread>): LocatableThread {
  return { filePath: 'src/a.rs', side: 'new', startLine: 2, endLine: 2, anchorContent: null, ...partial };
}

describe('indexDiff', () => {
  it('indexes the lines of each side', () => {
    const a = index.files.get('src/a.rs')!;
    expect(a.new.get(2)).toBe('    new();');
    expect(a.old.get(2)).toBe('    old();');
    expect(a.new.size).toBe(5);
    expect(a.old.size).toBe(4);
    expect(index.files.get('gone.txt')!.old.get(1)).toBe('bye');
    expect(index.empty).toBe(false);
  });

  it('keys a renamed file by both paths, the old one for the old side only', () => {
    expect(index.files.get('new.txt')!.new.get(2)).toBe('is');
    expect(index.files.get('old.txt')!.old.get(2)).toBe('was');
    expect(index.files.get('old.txt')!.new.size).toBe(0);
  });
});

describe('locateThread', () => {
  it('keeps threads whose lines read as they did', () => {
    expect(locateThread(index, thread({ endLine: 3, anchorContent: '    new();\n    more();' }))).toBe('current');
    expect(locateThread(index, thread({ side: 'old', anchorContent: '    old();' }))).toBe('current');
    expect(locateThread(index, thread({}))).toBe('current');
  });

  it('marks threads outdated when their lines changed or left the hunks', () => {
    expect(locateThread(index, thread({ anchorContent: '    renamed();' }))).toBe('outdated');
    expect(locateThread(index, thread({ startLine: 40, endLine: 41 }))).toBe('outdated');
  });

  it('lines up an anchor of the whole range with the lines still shown', () => {
    expect(locateThread(index, thread({ startLine: 4, endLine: 6, anchorContent: '    done();\n}\nlater' }))).toBe('current');
    expect(locateThread(index, thread({ startLine: 4, endLine: 6, anchorContent: '    done();\n};\nlater' }))).toBe('outdated');
  });

  it('keeps whole file and general threads while their file or view has changes', () => {
    expect(locateThread(index, thread({ startLine: 0, endLine: 0 }))).toBe('current');
    expect(locateThread(index, thread({ filePath: '__general__', startLine: 0, endLine: 0 }))).toBe('current');
  });

  it('notices files that left the diff and views without changes', () => {
    expect(locateThread(index, thread({ filePath: 'README.md', startLine: 0, endLine: 0 }))).toBe('file_gone');
    expect(locateThread(index, thread({ filePath: 'old.txt', side: 'old', anchorContent: 'was' }))).toBe('current');
    expect(locateThread(indexDiff(parseDiff('')), thread({ filePath: '__general__' }))).toBe('view_empty');
  });
});

describe('showsThread', () => {
  it('needs every line of the thread with its anchor', () => {
    expect(showsThread(index, thread({ anchorContent: '    new();' }))).toBe(true);
    expect(showsThread(index, thread({ endLine: 3, anchorContent: '    new();\n    more();' }))).toBe(true);
    expect(showsThread(index, thread({ endLine: 3, anchorContent: '    new();' }))).toBe(false);
    expect(showsThread(index, thread({ startLine: 5, endLine: 6, anchorContent: '}\nlater' }))).toBe(false);
    expect(showsThread(index, thread({ anchorContent: '    other();' }))).toBe(false);
    expect(showsThread(index, thread({ startLine: 0, endLine: 0 }))).toBe(false);
    expect(showsThread(index, thread({ filePath: 'README.md' }))).toBe(false);
  });
});

describe('locateTreeThread', () => {
  it('compares the anchor with the file as it reads now', () => {
    const content = 'one\ntwo\nthree\n';
    expect(locateTreeThread(thread({ filePath: 'a.txt', anchorContent: 'two\nthree', endLine: 3 }), content)).toBe('current');
    expect(locateTreeThread(thread({ filePath: 'a.txt', anchorContent: 'TWO' }), content)).toBe('outdated');
    expect(locateTreeThread(thread({ filePath: 'a.txt', anchorContent: 'two' }), null)).toBe('file_gone');
    expect(locateTreeThread(thread({ filePath: '__path__:src', startLine: 0, endLine: 0 }), '')).toBe('current');
  });
});

describe('listLocatedThreads', () => {
  let repo: TempRepo;
  const agent = { name: 'Agent', type: 'agent' as const };

  beforeEach(() => {
    repo = createRepo();
  });

  afterEach(() => {
    repo.remove();
  });

  function find(threads: LocatedThread[], id: string): LocatedThread {
    const found = threads.find((t) => t.id === id);
    expect(found).toBeDefined();
    return found!;
  }

  it('locates threads across views and follows committed code to HEAD', () => {
    repo.write('src/lib.rs', 'fn a() {}\nfn b2() {}\nfn c() {}\n');
    repo.write('notes.txt', 'one\ntwo\n');
    const work = findOrCreateSession('work');
    const onLine = createThread(work.id, 'src/lib.rs', 'new', 2, 2, 'rename b2', agent, 'fn b2() {}');
    const far = createThread(work.id, 'src/lib.rs', 'new', 40, 41, 'way below', agent);
    const untouched = createThread(work.id, 'README.md', 'new', 1, 1, 'readme', agent);
    const head = repo.git('rev-parse', 'HEAD').trim();
    const commit = findOrCreateSession(`${head}~1..${head}`);
    const inCommit = createThread(commit.id, 'a.txt', 'new', 1, 1, 'hello?', agent, 'one');
    const tree = findOrCreateSession(TREE_REF);
    const folder = createThread(tree.id, '__path__:src', 'new', 0, 0, 'folder note', agent);
    const gone = findOrCreateSession('no-such-branch...HEAD');
    const lost = createThread(gone.id, 'src/lib.rs', 'new', 1, 1, 'lost', agent);

    let threads = listLocatedThreads();
    expect(threads).toHaveLength(6);
    expect(find(threads, onLine.id)).toMatchObject({ location: 'current', ref: 'work', otherBranch: null, movedTo: null });
    expect(find(threads, far.id).location).toBe('outdated');
    expect(find(threads, untouched.id).location).toBe('file_gone');
    expect(find(threads, inCommit.id).location).toBe('current');
    expect(find(threads, folder.id).location).toBe('current');
    expect(find(threads, lost.id).location).toBe('unknown');
    expect(listLocatedThreads(work.id).map((t) => t.id)).toEqual([onLine.id, far.id, untouched.id]);

    repo.commit('rename b');
    const sha = repo.git('rev-parse', 'HEAD').trim();
    threads = listLocatedThreads();
    const moved = find(threads, onLine.id);
    expect(moved.location).toBe('view_empty');
    expect(moved.movedTo).toEqual({ sha, shortSha: sha.slice(0, 7), subject: 'rename b', ref: `${sha}~1..${sha}` });
    expect(find(threads, far.id).movedTo).toBeNull();
    expect(find(threads, untouched.id)).toMatchObject({ location: 'view_empty', movedTo: null });
  });

  it('marks edited lines outdated and reverted files gone', () => {
    repo.write('a.txt', 'one\nTWO\nthree\n');
    repo.write('b.txt', 'new file\n');
    const work = findOrCreateSession('work');
    const edited = createThread(work.id, 'a.txt', 'new', 2, 2, 'caps?', agent, 'TWO');
    const reverted = createThread(work.id, 'b.txt', 'new', 1, 1, 'why?', agent, 'new file');

    repo.write('a.txt', 'one\nTwo\nthree\n');
    repo.git('clean', '-qf', 'b.txt');
    const threads = listLocatedThreads(work.id);
    expect(find(threads, edited.id)).toMatchObject({ location: 'outdated', movedTo: null });
    expect(find(threads, reverted.id)).toMatchObject({ location: 'file_gone', movedTo: null });
  });

  it('locates threads on files .diffityignore hides', () => {
    repo.write('.diffityignore', 'gen/\n');
    repo.write('gen/out.txt', 'generated\n');
    repo.commit('generated');
    repo.write('gen/out.txt', 'regenerated\n');
    const work = findOrCreateSession('work');
    const hidden = createThread(work.id, 'gen/out.txt', 'new', 1, 1, 'why?', agent, 'regenerated');
    const sha = repo.git('rev-parse', 'HEAD').trim();
    const commit = findOrCreateSession(`${sha}~1..${sha}`);
    const inCommit = createThread(commit.id, 'gen/out.txt', 'new', 1, 1, 'new?', agent, 'generated');

    const threads = listLocatedThreads();
    expect(find(threads, hidden.id).location).toBe('current');
    expect(find(threads, inCommit.id).location).toBe('current');

    repo.commit('regenerated');
    expect(find(listLocatedThreads(), hidden.id)).toMatchObject({ location: 'view_empty', movedTo: { subject: 'regenerated' } });
  });

  it('leaves views of other branches unlocated', () => {
    repo.write('a.txt', 'one\nTWO\nthree\n');
    const onMain = findOrCreateSession('work');
    const thread = createThread(onMain.id, 'a.txt', 'new', 2, 2, 'caps?', agent, 'TWO');
    repo.git('stash', '-q');
    repo.git('checkout', '-q', '-b', 'feature');

    expect(find(listLocatedThreads(), thread.id)).toMatchObject({ location: 'unknown', otherBranch: 'main', movedTo: null });
  });
});
