import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { queryAll } from '../src/db.js';
import { findOrCreateSession, getCurrentSession, isBranchRelative, setCurrentSession, TREE_REF } from '../src/session.js';
import { createThread, getThreadsForSession } from '../src/threads.js';
import { createRepo, writeLegacyDb, type TempRepo } from './helpers.js';

let repo: TempRepo;

function head(): string {
  return repo.git('rev-parse', 'HEAD').trim();
}

function comment(sessionId: string, body: string) {
  return createThread(sessionId, 'a.txt', 'new', 1, 1, body, { name: 'Agent', type: 'agent' });
}

function bodies(sessionId: string): string[] {
  return getThreadsForSession(sessionId).map((t) => t.comments[0].body);
}

beforeEach(() => {
  repo = createRepo();
});

afterEach(() => {
  repo.remove();
});

describe('isBranchRelative', () => {
  const tags = (name: string) => name.startsWith('v');

  it('scopes views that depend on the checked out branch', () => {
    for (const ref of ['work', '.', 'staged', 'unstaged', 'main', 'origin/main', 'HEAD~1', 'HEAD~2..HEAD',
      'abc1234..HEAD', 'origin/main...HEAD', 'main..', '...main', '@~1', 'main...@', 'HEAD@{1}']) {
      expect(isBranchRelative(ref, tags), ref).toBe(true);
    }
  });

  it('shares views that read the same on every branch', () => {
    for (const ref of [TREE_REF, 'abc1234', 'abc1234~1', 'v1.0.0', 'v1.0.0^', 'abc1234~1..abc1234',
      'main..feature', 'v1.0.0...v2.0.0']) {
      expect(isBranchRelative(ref, tags), ref).toBe(false);
    }
  });
});

describe('findOrCreateSession', () => {
  it('keeps threads across commits and amends', () => {
    const session = findOrCreateSession('work');
    comment(session.id, 'survives');
    repo.write('a.txt', 'changed\n');
    repo.commit('second');
    repo.git('commit', '-q', '--amend', '-m', 'second, amended');

    const again = findOrCreateSession('work');
    expect(again.id).toBe(session.id);
    expect(again.scope).toBe('main');
    expect(bodies(again.id)).toEqual(['survives']);
  });

  it('keeps branch relative views apart per branch', () => {
    const onMain = findOrCreateSession('work');
    comment(onMain.id, 'on main');

    repo.git('checkout', '-q', '-b', 'feature');
    const onFeature = findOrCreateSession('work');
    expect(onFeature.id).not.toBe(onMain.id);
    expect(onFeature.scope).toBe('feature');
    expect(bodies(onFeature.id)).toEqual([]);

    repo.git('checkout', '-q', 'main');
    expect(findOrCreateSession('work').id).toBe(onMain.id);
  });

  it('shares views of fixed commits and the file browser between branches', () => {
    const sha = head();
    const commit = findOrCreateSession(sha);
    const tree = findOrCreateSession(TREE_REF);
    repo.git('checkout', '-q', '-b', 'feature');
    expect(findOrCreateSession(sha).id).toBe(commit.id);
    expect(findOrCreateSession(TREE_REF).id).toBe(tree.id);
    expect(commit.scope).toBe('');
  });

  it('scopes a detached HEAD to its commit', () => {
    repo.git('checkout', '-q', '--detach');
    expect(findOrCreateSession('work').scope).toBe(`detached@${head().slice(0, 12)}`);
  });
});

describe('getCurrentSession', () => {
  it('follows the checked out branch', () => {
    const onMain = findOrCreateSession('work');
    setCurrentSession(onMain);
    repo.git('checkout', '-q', '-b', 'feature');
    const current = getCurrentSession()!;
    expect(current.ref).toBe('work');
    expect(current.id).not.toBe(onMain.id);
  });

  it('is not replaced by opening the file browser', () => {
    expect(getCurrentSession()).toBeNull();
    const tree = findOrCreateSession(TREE_REF);
    setCurrentSession(tree);
    expect(getCurrentSession()!.id).toBe(tree.id);

    const diff = findOrCreateSession('main');
    setCurrentSession(diff);
    setCurrentSession(tree);
    expect(getCurrentSession()!.id).toBe(diff.id);
  });
});

describe('sessions from before scoping', () => {
  it('are merged per view and adopted by the branch they belong to', () => {
    const first = head();
    repo.write('a.txt', 'main\n');
    repo.commit('main work');
    const amendedAway = head();
    repo.git('commit', '-q', '--amend', '-m', 'main work, amended');
    const mainHead = head();
    repo.git('checkout', '-q', '-b', 'feature', first);
    repo.write('b.txt', 'feature\n');
    repo.commit('feature work');
    const featureHead = head();
    repo.git('checkout', '-q', 'main');

    writeLegacyDb(`
      INSERT INTO review_sessions (id, ref, head_hash, created_at) VALUES
        ('w-first', 'work', '${first}', '2026-01-01 00:00:00'),
        ('w-amended', 'work', '${amendedAway}', '2026-01-02 00:00:00'),
        ('w-main', 'work', '${mainHead}', '2026-01-03 00:00:00'),
        ('w-feature', 'work', '${featureHead}', '2026-01-04 00:00:00'),
        ('w-empty', 'work', '${mainHead}', '2026-01-05 00:00:00'),
        ('t-1', '__tree__', '${first}', '2026-01-01 00:00:00'),
        ('t-2', '__tree__', '${featureHead}', '2026-01-02 00:00:00');
      INSERT INTO comment_threads (id, session_id, file_path, side, start_line, end_line, created_at) VALUES
        ('th-first', 'w-first', 'a.txt', 'new', 1, 1, '2026-01-01T00:00:00.000Z'),
        ('th-amended', 'w-amended', 'a.txt', 'new', 1, 1, '2026-01-02T00:00:00.000Z'),
        ('th-main', 'w-main', 'a.txt', 'new', 1, 1, '2026-01-03T00:00:00.000Z'),
        ('th-feature', 'w-feature', 'a.txt', 'new', 1, 1, '2026-01-04T00:00:00.000Z'),
        ('th-tree-1', 't-1', 'a.txt', 'new', 1, 1, '2026-01-01T00:00:00.000Z'),
        ('th-tree-2', 't-2', 'a.txt', 'new', 1, 1, '2026-01-02T00:00:00.000Z');
      INSERT INTO comments (id, thread_id, author_name, author_type, body) VALUES
        ('c1', 'th-first', 'You', 'user', 'first'),
        ('c2', 'th-amended', 'You', 'user', 'amended away'),
        ('c3', 'th-main', 'You', 'user', 'main'),
        ('c4', 'th-feature', 'You', 'user', 'feature'),
        ('c5', 'th-tree-1', 'You', 'user', 'tree 1'),
        ('c6', 'th-tree-2', 'You', 'user', 'tree 2');
    `);

    const onMain = findOrCreateSession('work');
    expect(onMain.id).toBe('w-main');
    expect(bodies(onMain.id)).toEqual(['first', 'amended away', 'main']);

    repo.git('checkout', '-q', 'feature');
    const onFeature = findOrCreateSession('work');
    expect(onFeature.id).toBe('w-feature');
    expect(bodies(onFeature.id)).toEqual(['feature']);

    const tree = findOrCreateSession(TREE_REF);
    expect(tree.id).toBe('t-2');
    expect(bodies(tree.id)).toEqual(['tree 1', 'tree 2']);

    const sessions = queryAll<{ id: string; scope: string | null }>('SELECT id, scope FROM review_sessions ORDER BY id');
    expect(sessions).toEqual([
      { id: 't-2', scope: '' },
      { id: 'w-feature', scope: 'feature' },
      { id: 'w-main', scope: 'main' },
    ]);
  });
});
