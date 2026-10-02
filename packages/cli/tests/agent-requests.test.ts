import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  EXPIRED_RESULT,
  LISTENER_STALE_MS,
  REQUEST_EXPIRY_MS,
  RequestStateError,
  cancelRequest,
  claimNextRequest,
  enqueueRequest,
  expireStaleRequests,
  findRequest,
  finishRequest,
  listRequests,
  queuedThreadRequest,
  listenerStatus,
  registerListener,
  removeListener,
  setRequestProgress,
  touchListener,
} from '../src/agent-requests.js';
import { findOrCreateSession, type Session } from '../src/session.js';
import { createRepo, type TempRepo } from './helpers.js';

const require = createRequire(import.meta.url);
const TSX = require.resolve('tsx/cli');
const CLAIMER = fileURLToPath(new URL('./fixtures/claim-requests.ts', import.meta.url));
const run = promisify(execFile);

let repo: TempRepo;
let session: Session;

beforeEach(() => {
  repo = createRepo();
  session = findOrCreateSession('work');
});

afterEach(() => {
  repo.remove();
});

function enqueue(mode: 'review' | 'resolve' | 'thread' | 'summarize' = 'review', now = Date.now(), extra = {}) {
  return enqueueRequest({ sessionId: session.id, ref: 'work', mode, ...extra }, now);
}

describe('agent request queue', () => {
  it('stores the payload and lists the newest first', () => {
    const t0 = Date.parse('2026-01-01T10:00:00Z');
    const review = enqueue('review', t0, { focus: 'error handling', paths: ['a.txt'] });
    const resolve = enqueue('resolve', t0 + 1000, { threadIds: ['t1', 't2'], note: 'keep it small', trigger: 'mention' });

    expect(review).toMatchObject({ mode: 'review', status: 'queued', focus: 'error handling', paths: ['a.txt'], threadIds: [], note: null, trigger: 'user' });
    expect(listRequests(50, t0 + 2000).map((r) => r.id)).toEqual([resolve.id, review.id]);
    expect(findRequest(resolve.id.slice(0, 8))).toMatchObject({ threadIds: ['t1', 't2'], note: 'keep it small', trigger: 'mention', createdAt: '2026-01-01T10:00:01.000Z' });
    expect(() => findRequest('abc')).toThrow('use at least 8 characters');
    expect(() => findRequest('00000000')).toThrow('Request not found: 00000000');
  });

  it('claims the oldest queued request once', () => {
    const first = enqueue('review', 1000);
    const second = enqueue('summarize', 2000);

    expect(claimNextRequest(3000)).toMatchObject({ id: first.id, status: 'claimed', claimedAt: new Date(3000).toISOString() });
    expect(claimNextRequest(3000)?.id).toBe(second.id);
    expect(claimNextRequest(3000)).toBeNull();
    expect(findRequest(first.id).status).toBe('claimed');
  });

  it('cancels only queued requests', () => {
    const claimed = enqueue('review', 1000);
    const queued = enqueue('review', 2000);
    claimNextRequest();

    expect(() => cancelRequest(claimed.id)).toThrow(RequestStateError);
    expect(cancelRequest(queued.id).status).toBe('cancelled');
    expect(claimNextRequest()).toBeNull();
    expect(() => cancelRequest(queued.id)).toThrow('is cancelled, only a queued request can be cancelled');
  });

  it('records progress and the summary of claimed requests', () => {
    const request = enqueue();
    expect(() => setRequestProgress(request.id, 'Reading')).toThrow('is queued');
    expect(() => finishRequest(request.id)).toThrow('is queued');

    claimNextRequest();
    expect(setRequestProgress(request.id, 'Reading the diff')).toMatchObject({ status: 'claimed', progress: 'Reading the diff' });
    const done = finishRequest(request.id.slice(0, 8), '  2 must-fix  ');
    expect(done).toMatchObject({ status: 'done', result: '2 must-fix', progress: 'Reading the diff' });
    expect(done.doneAt).not.toBeNull();
    expect(finishRequest(request.id, 'again').result).toBe('2 must-fix');
  });

  it('expires claimed requests without progress, which the agent can still finish', () => {
    const t0 = Date.parse('2026-01-01T10:00:00Z');
    const silent = enqueue('review', t0);
    const busy = enqueue('review', t0 + 1);
    claimNextRequest(t0);
    claimNextRequest(t0);
    setRequestProgress(busy.id, 'Half way', t0 + REQUEST_EXPIRY_MS / 2);

    expect(expireStaleRequests(t0 + REQUEST_EXPIRY_MS - 1)).toBe(0);
    expect(expireStaleRequests(t0 + REQUEST_EXPIRY_MS + 1)).toBe(1);
    expect(findRequest(silent.id)).toMatchObject({ status: 'cancelled', result: EXPIRED_RESULT });
    expect(findRequest(busy.id).status).toBe('claimed');
    expect(listRequests(50, t0 + 2 * REQUEST_EXPIRY_MS).every((r) => r.status === 'cancelled')).toBe(true);

    expect(setRequestProgress(silent.id, 'Back')).toMatchObject({ status: 'claimed', result: null, doneAt: null });
    expect(finishRequest(busy.id, 'Late but done')).toMatchObject({ status: 'done', result: 'Late but done' });
  });

  it('finds the waiting thread request of a thread', () => {
    const request = enqueue('thread', Date.now(), { threadIds: ['thread-1'] });
    enqueue('resolve', Date.now(), { threadIds: ['thread-2'] });
    expect(queuedThreadRequest('thread-1')?.id).toBe(request.id);
    expect(queuedThreadRequest('thread-2')).toBeNull();
    claimNextRequest();
    expect(queuedThreadRequest('thread-1')).toBeNull();
  });

  it('hands each request to one of two competing waiters', { timeout: 30_000 }, async () => {
    const ids = Array.from({ length: 200 }, (_, i) => enqueue('review', Date.now() + i).id);
    const goAt = String(Date.now() + 2500);
    const env = { ...process.env, HOME: repo.home, GO_AT: goAt };
    const results = await Promise.all([1, 2].map(() => run(process.execPath, [TSX, CLAIMER], { cwd: repo.dir, env })));
    const claimed = results.map(({ stdout }) => JSON.parse(stdout) as string[]);

    const all = claimed.flat();
    expect(all).toHaveLength(ids.length);
    expect(new Set(all)).toEqual(new Set(ids));
    expect(listRequests().every((r) => r.status === 'claimed')).toBe(true);
  });
});

describe('agent listeners', () => {
  it('reports waiting agents while their heartbeat is recent', () => {
    const t0 = Date.parse('2026-01-01T10:00:00Z');
    expect(listenerStatus(t0)).toBeNull();

    const first = registerListener(101, t0);
    const second = registerListener(102, t0 + 1000);
    expect(listenerStatus(t0 + 1000)).toEqual({ since: new Date(t0).toISOString(), seenAt: new Date(t0 + 1000).toISOString(), count: 2 });

    touchListener(second.id, t0 + LISTENER_STALE_MS);
    expect(listenerStatus(t0 + LISTENER_STALE_MS + 500)).toMatchObject({ since: new Date(t0 + 1000).toISOString(), count: 1 });

    removeListener(second.id);
    expect(listenerStatus(t0 + LISTENER_STALE_MS + 500)).toBeNull();

    registerListener(103, t0 + 10 * LISTENER_STALE_MS);
    touchListener(first.id, t0 + 10 * LISTENER_STALE_MS);
    expect(listenerStatus(t0 + 10 * LISTENER_STALE_MS)?.count).toBe(1);
  });
});
