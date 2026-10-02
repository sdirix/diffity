import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { RemoteComment, RemoteThread } from '@diffity/github';
import { getDb, queryOne } from '../src/db.js';
import { syncRemoteThreads } from '../src/github-sync.js';
import { findOrCreateSession } from '../src/session.js';
import { createThread, getThreadsForSession, updateThreadStatus } from '../src/threads.js';
import { createRepo, type TempRepo } from './helpers.js';

let repo: TempRepo;

beforeEach(() => {
  repo = createRepo();
});

afterEach(() => {
  repo.remove();
});

function comment(id: number, body: string, login = 'alice', typename = 'User'): RemoteComment {
  return {
    databaseId: id,
    body,
    createdAt: `2099-01-01T00:00:0${id}Z`,
    author: { login, avatarUrl: null, __typename: typename },
    pullRequestReview: { id: 'R1' },
  };
}

function remote(id: string, comments: RemoteComment[], overrides: Partial<RemoteThread> = {}): RemoteThread {
  return {
    id,
    isResolved: false,
    isOutdated: false,
    path: 'a.txt',
    line: 2,
    startLine: null,
    originalLine: 2,
    originalStartLine: null,
    diffSide: 'RIGHT',
    subjectType: 'LINE',
    diffHunk: '@@ -1,3 +1,3 @@\n one\n-two\n+TWO',
    comments,
    ...overrides,
  };
}

describe('syncRemoteThreads', () => {
  it('pulls threads with their replies, state and anchors', () => {
    const session = findOrCreateSession('origin/main');
    const result = syncRemoteThreads(session.id, [
      remote('T1', [comment(1, 'nit'), comment(2, 'done', 'ci[bot]', 'Bot')], { isResolved: true }),
      remote('T2', [comment(3, 'old code')], { line: null, isOutdated: true, originalLine: 2, diffSide: 'LEFT' }),
      remote('T3', [comment(4, 'whole file')], { subjectType: 'FILE', line: null, originalLine: null }),
      remote('T4', []),
    ]);
    expect(result).toEqual({ pulled: 3, updated: 0, skipped: 1 });

    const threads = getThreadsForSession(session.id);
    const byId = new Map(threads.map((t) => [t.githubThreadId, t]));
    const first = byId.get('T1')!;
    expect(first).toMatchObject({ filePath: 'a.txt', side: 'new', startLine: 2, endLine: 2, status: 'resolved', anchorContent: 'TWO' });
    expect(first.comments.map((c) => [c.author.name, c.author.type, c.body, c.githubCommentId])).toEqual([
      ['alice', 'user', 'nit', 1],
      ['ci[bot]', 'agent', 'done', 2],
    ]);
    expect(byId.get('T2')).toMatchObject({ side: 'old', startLine: 2, status: 'open', anchorContent: 'two' });
    expect(byId.get('T3')).toMatchObject({ startLine: 0, endLine: 0, anchorContent: null });
  });

  it('merges into linked threads by id instead of adding them again', () => {
    const session = findOrCreateSession('origin/main');
    syncRemoteThreads(session.id, [remote('T1', [comment(1, 'nit')])]);
    const result = syncRemoteThreads(session.id, [remote('T1', [comment(1, 'nit'), comment(2, 'nit')], { line: 5 })]);
    expect(result).toEqual({ pulled: 0, updated: 1, skipped: 0 });

    const [thread] = getThreadsForSession(session.id);
    expect(thread.comments.map((c) => c.githubCommentId)).toEqual([1, 2]);
    expect([thread.startLine, thread.endLine]).toEqual([5, 5]);
    expect(syncRemoteThreads(session.id, [remote('T1', [comment(1, 'nit'), comment(2, 'nit')], { line: 5 })]))
      .toEqual({ pulled: 0, updated: 0, skipped: 1 });
  });

  it('applies a resolve done on GitHub and keeps one done here', () => {
    const session = findOrCreateSession('origin/main');
    syncRemoteThreads(session.id, [remote('T1', [comment(1, 'a')]), remote('T2', [comment(2, 'b')])]);
    const local = new Map(getThreadsForSession(session.id).map((t) => [t.githubThreadId, t.id]));
    updateThreadStatus(local.get('T2')!, 'resolved');

    syncRemoteThreads(session.id, [remote('T1', [comment(1, 'a')], { isResolved: true }), remote('T2', [comment(2, 'b')])]);
    const status = new Map(getThreadsForSession(session.id).map((t) => [t.githubThreadId, t.status]));
    expect(status.get('T1')).toBe('resolved');
    expect(status.get('T2')).toBe('resolved');

    syncRemoteThreads(session.id, [remote('T1', [comment(1, 'a')], { isResolved: false }), remote('T2', [comment(2, 'b')])]);
    expect(getThreadsForSession(session.id).find((t) => t.githubThreadId === 'T1')!.status).toBe('open');
  });

  it('updates a linked thread of another view in place', () => {
    const work = findOrCreateSession('work');
    const pr = findOrCreateSession('origin/main');
    const posted = createThread(work.id, 'a.txt', 'new', 2, 2, 'posted from work', { name: 'You', type: 'user' });
    getDb().prepare("UPDATE comment_threads SET github_thread_id = 'T1', github_resolved = 0 WHERE id = ?").run(posted.id);

    syncRemoteThreads(pr.id, [remote('T1', [comment(1, 'posted from work'), comment(2, 'thanks')])]);
    expect(getThreadsForSession(pr.id)).toEqual([]);
    const [thread] = getThreadsForSession(work.id);
    expect(thread.comments.map((c) => [c.author.name, c.body, c.githubCommentId])).toEqual([
      ['You', 'posted from work', 1],
      ['alice', 'thanks', 2],
    ]);
  });

  it('links a thread pulled before threads were linked', () => {
    const session = findOrCreateSession('origin/main');
    const legacy = createThread(session.id, 'a.txt', 'new', 2, 2, 'nit', { name: 'alice', type: 'user' });
    const result = syncRemoteThreads(session.id, [remote('T1', [comment(1, 'nit\r\n')])]);
    expect(result.pulled).toBe(0);
    const [thread] = getThreadsForSession(session.id);
    expect(thread.id).toBe(legacy.id);
    expect(thread.githubThreadId).toBe('T1');
    expect(thread.comments.map((c) => c.githubCommentId)).toEqual([1]);
    expect(queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM comment_threads')!.n).toBe(1);
  });
});
