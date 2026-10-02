import { describe, expect, it } from 'vitest';
import type { DiffFile, ParsedDiff } from '@diffity/parser';
import {
  getOutsideThreads,
  groupThreads,
  locateViewThreads,
  matchesFilters,
  threadLineLabel,
  treePagePath,
  TREE_REF,
  viewLabel,
} from '../src/lib/thread-location';
import type { LocatedThread } from '../src/lib/api';
import type { CommentThread } from '../src/components/comments/types';

function thread(partial: Partial<CommentThread>): CommentThread {
  return { id: 't', filePath: 'a.ts', side: 'new', startLine: 1, endLine: 1, comments: [], status: 'open', ...partial };
}

function file(partial: Partial<DiffFile>): DiffFile {
  return { oldPath: 'a.ts', newPath: 'a.ts', status: 'modified', hunks: [], additions: 0, deletions: 0, isBinary: false, ...partial };
}

function diff(files: DiffFile[]): ParsedDiff {
  return { files, stats: { totalAdditions: 0, totalDeletions: 0, filesChanged: files.length } };
}

describe('getOutsideThreads', () => {
  const threads = [
    thread({ id: 'kept' }),
    thread({ id: 'gone', filePath: 'b.ts' }),
    thread({ id: 'general', filePath: '__general__', startLine: 0, endLine: 0 }),
    thread({ id: 'deleted', filePath: 'old.ts' }),
  ];

  it('lists threads of files the diff does not show', () => {
    const files = [file({}), file({ oldPath: 'old.ts', newPath: '/dev/null', status: 'deleted' })];
    expect(getOutsideThreads(threads, diff(files)).map((t) => t.id)).toEqual(['gone']);
  });

  it('lists every thread once the view has no changes', () => {
    expect(getOutsideThreads(threads, diff([])).map((t) => t.id)).toEqual(['kept', 'gone', 'general', 'deleted']);
  });
});

describe('threadLineLabel', () => {
  it('names lines, whole files and general comments', () => {
    expect(threadLineLabel(thread({}))).toBe('Line 1');
    expect(threadLineLabel(thread({ startLine: 2, endLine: 4 }))).toBe('Lines 2–4');
    expect(threadLineLabel(thread({ startLine: 0, endLine: 0 }))).toBe('File');
    expect(threadLineLabel(thread({ filePath: '__general__', startLine: 0, endLine: 0 }))).toBe('General');
  });
});

function located(partial: Partial<LocatedThread>): LocatedThread {
  return {
    ...thread({}),
    sessionId: 's',
    ref: 'work',
    otherBranch: null,
    location: 'current',
    movedTo: null,
    updatedAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

describe('treePagePath', () => {
  it('opens the file browser on the file of a thread', () => {
    expect(treePagePath({ filePath: 'src/a.ts' })).toBe('/tree?path=src%2Fa.ts&type=file');
    expect(treePagePath({ filePath: '__path__:src' })).toBe('/tree');
    expect(treePagePath({ filePath: '__general__' })).toBe('/tree');
    expect(treePagePath()).toBe('/tree');
  });
});

describe('matchesFilters', () => {
  const byAgent = thread({ comments: [{ id: 'c', author: { name: 'Claude', type: 'agent' }, body: 'x', createdAt: '' }] });

  it('filters by status and by who started the thread', () => {
    expect(matchesFilters(byAgent, { status: 'all', author: 'agent' })).toBe(true);
    expect(matchesFilters(byAgent, { status: 'all', author: 'user' })).toBe(false);
    expect(matchesFilters(byAgent, { status: 'resolved', author: 'all' })).toBe(false);
    expect(matchesFilters(thread({ status: 'dismissed' }), { status: 'dismissed', author: 'user' })).toBe(true);
  });
});

describe('locateViewThreads', () => {
  it('takes the server location and falls back to where the page lists the thread', () => {
    const threads = [thread({ id: 'a' }), thread({ id: 'b', filePath: 'b.ts' }), thread({ id: 'c' })];
    const locations = new Map([['c', located({ id: 'c', location: 'outdated' })]]);
    const view = { sessionId: 's', ref: 'work', empty: false };
    expect(locateViewThreads(threads, locations, [threads[1]], view).map((t) => t.location)).toEqual(['current', 'file_gone', 'outdated']);
    expect(locateViewThreads(threads, new Map(), threads, { ...view, empty: true })[0].location).toBe('view_empty');
  });
});

describe('groupThreads', () => {
  it('puts the current view first, then the most recent, files sorted with general first', () => {
    const groups = groupThreads(
      [
        located({ id: '1', sessionId: 'old', ref: 'old', updatedAt: '2026-01-01T00:00:00Z' }),
        located({ id: '2', sessionId: 'new', ref: 'new', updatedAt: '2026-03-01T00:00:00Z', filePath: 'b.ts' }),
        located({ id: '3', sessionId: 'new', ref: 'new', updatedAt: '2026-02-01T00:00:00Z', filePath: '__general__' }),
        located({ id: '4', sessionId: 'here', updatedAt: '2025-01-01T00:00:00Z' }),
        located({ id: '5', sessionId: 'new', ref: 'new', filePath: 'b.ts', startLine: 0, endLine: 0, location: 'file_gone' }),
      ],
      'here',
    );
    expect(groups.map((group) => group.sessionId)).toEqual(['here', 'new', 'old']);
    expect(groups[0].current).toBe(true);
    expect(groups[1].located.map((file) => file.path)).toEqual(['__general__', 'b.ts']);
    expect(groups[1].outdated).toEqual([{ path: 'b.ts', threads: [expect.objectContaining({ id: '5' })] }]);
    expect(groups[1].count).toBe(3);
  });
});

describe('viewLabel', () => {
  it('names views and the branch of views from other branches', () => {
    expect(viewLabel('work', 'main', 'origin/main')).toBe('Uncommitted changes');
    expect(viewLabel(TREE_REF, 'main', null)).toBe('Files');
    expect(viewLabel('abcdef1234~1..abcdef1234', 'main', null)).toBe('Commit abcdef1');
    expect(viewLabel('work', 'main', null, 'feature')).toBe('Uncommitted changes on feature');
    expect(viewLabel('origin/main...HEAD', 'main', 'origin/main', 'feature')).toBe('feature vs main');
  });
});
