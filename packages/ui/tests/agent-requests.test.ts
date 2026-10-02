import { describe, expect, it } from 'vitest';
import type { AgentRequest, ListenerStatus } from '../src/components/agent/agent-api';
import { mentionQuery } from '../src/components/agent/mentions';
import {
  agentState,
  busyThreadIds,
  canSendTo,
  endedSince,
  isExpired,
  preselected,
  requestTitle,
  sendCandidates,
  threadActivity,
} from '../src/components/agent/request-state';
import type { CommentThread } from '../src/components/comments/types';

function request(id: string, extra: Partial<AgentRequest> = {}): AgentRequest {
  return {
    id,
    sessionId: 's',
    ref: 'work',
    mode: 'review',
    trigger: 'user',
    threadIds: [],
    note: null,
    focus: null,
    paths: [],
    status: 'queued',
    progress: null,
    result: null,
    createdAt: '2026-01-01T10:00:00.000Z',
    claimedAt: null,
    progressAt: null,
    doneAt: null,
    ...extra,
  };
}

function thread(id: string, authors: ('user' | 'agent')[], extra: Partial<CommentThread> = {}): CommentThread {
  return {
    id,
    filePath: 'src/a.ts',
    side: 'new',
    startLine: 1,
    endLine: 1,
    status: 'open',
    comments: authors.map((type, index) => ({ id: `${id}-${index}`, author: { name: type, type }, body: 'text', createdAt: '' })),
    ...extra,
  };
}

const LISTENER: ListenerStatus = { since: '2026-01-01T10:00:00.000Z', seenAt: '2026-01-01T10:00:00.000Z', count: 1 };

describe('agentState', () => {
  it('works on a claimed request, else listens or is offline', () => {
    expect(agentState([request('a', { status: 'claimed' })], null, null, 0)).toBe('working');
    expect(agentState([request('a')], LISTENER, null, 0)).toBe('listening');
    expect(agentState([request('a', { status: 'done' })], null, null, 0)).toBe('offline');
  });

  it('keeps listening for a moment after the wait ends', () => {
    expect(agentState([], null, 1000, 10_000, 15_000)).toBe('listening');
    expect(agentState([], null, 1000, 16_001, 15_000)).toBe('offline');
  });
});

describe('request state', () => {
  it('names requests', () => {
    expect(requestTitle({ mode: 'review', threadIds: [] })).toBe('Review');
    expect(requestTitle({ mode: 'resolve', threadIds: ['a'] })).toBe('Resolve 1 comment');
    expect(requestTitle({ mode: 'resolve', threadIds: ['a', 'b'] })).toBe('Resolve 2 comments');
    expect(requestTitle({ mode: 'thread', threadIds: ['a'] })).toBe('Reply in thread');
    expect(requestTitle({ mode: 'summarize', threadIds: [] })).toBe('Summary');
  });

  it('tells expired requests from cancelled ones', () => {
    expect(isExpired(request('a', { status: 'cancelled', claimedAt: '2026-01-01T10:00:00.000Z' }))).toBe(true);
    expect(isExpired(request('a', { status: 'cancelled' }))).toBe(false);
  });

  it('follows what happens to a thread', () => {
    const requests = [
      request('q', { mode: 'resolve', threadIds: ['t1', 't2'] }),
      request('c', { mode: 'thread', threadIds: ['t2'], status: 'claimed' }),
      request('d', { mode: 'thread', threadIds: ['t3'], status: 'done' }),
    ];
    expect(threadActivity(requests, 't1')).toBe('queued');
    expect(threadActivity(requests, 't2')).toBe('working');
    expect(threadActivity(requests, 't3')).toBe('idle');
    expect(busyThreadIds(requests)).toEqual(new Set(['t1', 't2']));
  });

  it('finds the requests that ended since the last poll', () => {
    const before = new Map<string, AgentRequest['status']>([['a', 'claimed'], ['b', 'queued'], ['c', 'done']]);
    const now = [request('a', { status: 'done' }), request('b', { status: 'claimed' }), request('c', { status: 'done' }), request('d', { status: 'done' })];
    expect(endedSince(before, now).map((r) => r.id)).toEqual(['a']);
  });
});

describe('send candidates', () => {
  const threads = [
    thread('mine', ['user']),
    thread('agent', ['agent']),
    thread('asked-back', ['user', 'agent']),
    thread('replied', ['agent', 'user']),
    thread('done', ['agent'], { status: 'resolved' }),
    thread('summary', ['agent'], { filePath: '__general__' }),
    thread('busy', ['user']),
  ];

  it('keeps your comments and the agent untouched ones apart', () => {
    const candidates = sendCandidates(threads, new Set(['busy']));
    expect(candidates.yours.map((t) => t.id)).toEqual(['mine', 'replied']);
    expect(candidates.agents.map((t) => t.id)).toEqual(['agent']);
    expect(preselected(candidates).map((t) => t.id)).toEqual(['mine', 'replied']);
    expect(preselected({ yours: [], agents: candidates.agents }).map((t) => t.id)).toEqual(['agent']);
  });

  it('sends only for views the agent can edit', () => {
    expect(canSendTo('work')).toBe(true);
    expect(canSendTo('main')).toBe(true);
    expect(canSendTo('__tree__')).toBe(true);
    expect(canSendTo('main..HEAD')).toBe(true);
    expect(canSendTo('main..feature')).toBe(false);
    expect(canSendTo('abc1234~1..abc1234')).toBe(false);
  });
});

describe('mentionQuery', () => {
  it('completes a handle being typed', () => {
    expect(mentionQuery('Hey @cl', 7)).toEqual({ start: 4, end: 7, handles: ['claude'] });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, end: 1, handles: ['claude', 'agent'] });
    expect(mentionQuery('(@a', 3)).toEqual({ start: 1, end: 3, handles: ['agent'] });
  });

  it('stays out of the way otherwise', () => {
    expect(mentionQuery('@claude', 7)).toBeNull();
    expect(mentionQuery('a@cl', 4)).toBeNull();
    expect(mentionQuery('@bob', 4)).toBeNull();
    expect(mentionQuery('@cl and more', 12)).toBeNull();
  });
});
