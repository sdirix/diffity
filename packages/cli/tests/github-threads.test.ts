import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb } from '../src/db.js';
import { bodyForGitHub, findComment, githubThreadOf, recordGitHubReply, recordGitHubStatus } from '../src/github-threads.js';
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

describe('GitHub thread actions', () => {
  it('records replies and resolves done on GitHub', () => {
    const session = findOrCreateSession('origin/main');
    const thread = createThread(session.id, 'a.txt', 'new', 1, 1, 'nit', { name: 'alice', type: 'user' });
    expect(githubThreadOf(thread.id)).toBeNull();
    getDb().prepare("UPDATE comment_threads SET github_thread_id = 'T1' WHERE id = ?").run(thread.id);
    expect(githubThreadOf(thread.id)).toBe('T1');

    updateThreadStatus(thread.id, 'resolved');
    const reply = recordGitHubReply(thread.id, 'done', { name: 'You', type: 'user' }, 42);
    expect(reply.githubCommentId).toBe(42);
    let [stored] = getThreadsForSession(session.id);
    expect(stored.status).toBe('resolved');
    expect(stored.comments.map((c) => [c.body, c.githubCommentId])).toEqual([['nit', null], ['done', 42]]);

    recordGitHubStatus(thread.id, false);
    [stored] = getThreadsForSession(session.id);
    expect(stored.status).toBe('open');
    expect(findComment(reply.id)).toMatchObject({ body: 'done', githubCommentId: 42, githubThreadId: 'T1' });
  });

  it('marks agent comments posted under your name', () => {
    expect(bodyForGitHub('Fixed it.\n', 'Claude', 'agent')).toBe('Fixed it.\n\n<sub>Drafted by Claude in diffity</sub>');
    expect(bodyForGitHub('Fixed it.', 'You', 'user')).toBe('Fixed it.');
  });
});
