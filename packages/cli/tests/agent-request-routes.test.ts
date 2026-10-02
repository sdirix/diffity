import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { claimNextRequest, registerListener, removeListener } from '../src/agent-requests.js';
import { resolveTargets } from '../src/agent-request-input.js';
import { AGENT_AUTHOR } from '../src/agent-actions.js';
import { startServer } from '../src/server.js';
import { findOrCreateSession, TREE_REF, type Session } from '../src/session.js';
import { addReply, createThread, getThreadsForSession, updateThreadStatus } from '../src/threads.js';
import { createRepo, type TempRepo } from './helpers.js';

const USER = { name: 'You', type: 'user' as const };

let repo: TempRepo;
let session: Session;
let server: { port: number; close: () => void };

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`http://localhost:${server.port}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

beforeEach(async () => {
  repo = createRepo();
  repo.write('a.txt', 'one\nTWO\nthree\n');
  session = findOrCreateSession('work');
  server = await startServer({ port: 0, diffArgs: [] });
});

afterEach(() => {
  server.close();
  repo.remove();
});

describe('agent request API', () => {
  it('queues a review in the session of the ref and lists it', async () => {
    const created = await api('POST', '/api/agent/requests', { mode: 'review', ref: 'work', focus: ' security ' });
    expect(created.status).toBe(200);
    expect(created.json).toMatchObject({ mode: 'review', ref: 'work', sessionId: session.id, focus: 'security', status: 'queued', trigger: 'user' });

    const listed = await api('GET', '/api/agent/requests');
    expect(listed.json).toEqual({ requests: [created.json], listener: null });
  });

  it('reports a waiting agent', async () => {
    const listener = registerListener();
    expect((await api('GET', '/api/agent/requests')).json.listener).toMatchObject({ since: listener.startedAt, count: 1 });
    removeListener(listener.id);
    expect((await api('GET', '/api/agent/requests')).json.listener).toBeNull();
  });

  it('cancels only queued requests', async () => {
    const first = (await api('POST', '/api/agent/requests', { mode: 'summarize', ref: 'work' })).json;
    const second = (await api('POST', '/api/agent/requests', { mode: 'review', ref: 'work' })).json;
    claimNextRequest();

    expect(await api('POST', `/api/agent/requests/${first.id}/cancel`, {})).toMatchObject({ status: 409 });
    expect(await api('POST', `/api/agent/requests/${second.id}/cancel`, {})).toMatchObject({ status: 200, json: { status: 'cancelled' } });
    expect(await api('POST', '/api/agent/requests/00000000-0000-0000-0000-000000000000/cancel', {})).toMatchObject({ status: 404 });
  });

  it('asks about one thread, once while it waits', async () => {
    const head = findOrCreateSession('HEAD');
    const thread = createThread(head.id, 'a.txt', 'new', 1, 1, 'Why?', USER);

    const first = await api('POST', '/api/agent/requests', { mode: 'thread', threadIds: [thread.id], note: 'Be brief' });
    expect(first.json).toMatchObject({ mode: 'thread', ref: 'HEAD', sessionId: head.id, threadIds: [thread.id], note: 'Be brief' });
    const again = await api('POST', '/api/agent/requests', { mode: 'thread', threadIds: [thread.id] });
    expect(again.json.id).toBe(first.json.id);

    expect(await api('POST', '/api/agent/requests', { mode: 'thread', ref: 'work', threadIds: [thread.id] }))
      .toMatchObject({ status: 400, json: { error: expect.stringContaining('belongs to session') } });
    expect(await api('POST', '/api/agent/requests', { mode: 'thread', threadIds: ['missing'] })).toMatchObject({ status: 404 });
    expect(await api('POST', '/api/agent/requests', { mode: 'thread', threadIds: [] })).toMatchObject({ status: 400 });
  });

  it('resolves the picked threads, or the unaddressed ones', async () => {
    const mine = createThread(session.id, 'a.txt', 'new', 2, 2, 'Lower case', USER);
    createThread(session.id, 'a.txt', 'new', 1, 1, 'Nit', AGENT_AUTHOR);

    const picked = await api('POST', '/api/agent/requests', { mode: 'resolve', ref: 'work', threadIds: [mine.id.slice(0, 8)], note: 'Small' });
    expect(picked.json).toMatchObject({ mode: 'resolve', threadIds: [mine.id], note: 'Small' });

    const preselected = await api('POST', '/api/agent/requests', { mode: 'resolve', ref: 'work' });
    expect(preselected.json.threadIds).toHaveLength(1);
    expect(preselected.json.threadIds[0]).not.toBe(mine.id);

    expect(await api('POST', '/api/agent/requests', { mode: 'resolve', ref: 'work' }))
      .toMatchObject({ status: 400, json: { error: 'No open threads to resolve' } });
  });

  it('rejects malformed requests', async () => {
    const cases: [unknown, string][] = [
      [{ mode: 'chat', ref: 'work' }, 'mode must be one of review, resolve, thread, summarize'],
      [{ mode: 'review' }, 'Missing ref'],
      [{ mode: 'review', ref: 'no-such-branch' }, "'no-such-branch' is not a valid git reference."],
      [{ mode: 'review', ref: TREE_REF }, 'A review needs a diff, the file browser has none'],
      [{ mode: 'resolve', ref: 'work', threadIds: 'abc' }, 'threadIds must be an array of strings'],
      [{ mode: 'review', ref: 'work', focus: 3 }, 'focus must be a string'],
      [[], 'Expected an object'],
    ];
    for (const [body, error] of cases) {
      expect(await api('POST', '/api/agent/requests', body), JSON.stringify(body)).toEqual({ status: 400, json: { error } });
    }
  });

  it('only takes JSON', async () => {
    const res = await fetch(`http://localhost:${server.port}/api/agent/requests`, { method: 'POST', body: 'mode=review' });
    expect(res.status).toBe(415);
  });
});

describe('resolveTargets', () => {
  it('prefers threads waiting on the user, then untouched agent comments', () => {
    const mine = createThread(session.id, 'a.txt', 'new', 1, 1, 'Fix', USER);
    const agents = createThread(session.id, 'a.txt', 'new', 2, 2, 'Nit', AGENT_AUTHOR);
    const asked = createThread(session.id, 'a.txt', 'new', 3, 3, 'Rename', USER);
    addReply(asked.id, 'To what?', AGENT_AUTHOR);
    createThread(session.id, '__general__', 'new', 0, 0, '**Summary**', AGENT_AUTHOR);

    const threads = () => getThreadsForSession(session.id, 'open');
    expect(resolveTargets(threads()).map((t) => t.id)).toEqual([mine.id]);
    expect(resolveTargets(threads(), new Set([mine.id])).map((t) => t.id)).toEqual([agents.id]);
    updateThreadStatus(mine.id, 'resolved');
    expect(resolveTargets(threads()).map((t) => t.id)).toEqual([agents.id]);
  });
});
