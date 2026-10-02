import { randomUUID } from 'node:crypto';
import { InputError } from '@diffity/git';
import { getDb, queryAll, queryOne, transaction } from './db.js';

export const REQUEST_MODES = ['review', 'resolve', 'thread', 'summarize'] as const;
export type RequestMode = (typeof REQUEST_MODES)[number];
export type RequestStatus = 'queued' | 'claimed' | 'done' | 'cancelled';
/** `mention` for a request a comment started by mentioning the agent. */
export type RequestTrigger = 'user' | 'mention';

/** How long a claimed request may go without progress before it expires. */
export const REQUEST_EXPIRY_MS = 60 * 60 * 1000;
/** How long a listener counts as waiting after its last heartbeat. */
export const LISTENER_STALE_MS = 15 * 1000;

export const EXPIRED_RESULT = 'Expired: no update from the agent for 60 minutes';

export interface AgentRequest {
  id: string;
  sessionId: string;
  ref: string;
  mode: RequestMode;
  trigger: RequestTrigger;
  /** `resolve`: the threads to work on. `thread`: the one thread. */
  threadIds: string[];
  note: string | null;
  focus: string | null;
  paths: string[];
  status: RequestStatus;
  /** The agent's last progress report while it works. */
  progress: string | null;
  /** The agent's summary once done, or why it was cancelled. */
  result: string | null;
  createdAt: string;
  claimedAt: string | null;
  progressAt: string | null;
  doneAt: string | null;
}

export interface NewRequest {
  sessionId: string;
  ref: string;
  mode: RequestMode;
  trigger?: RequestTrigger;
  threadIds?: string[];
  note?: string;
  focus?: string;
  paths?: string[];
}

/** A `diffity agent wait` that blocks right now. */
export interface Listener {
  id: string;
  pid: number;
  startedAt: string;
  seenAt: string;
}

/** Whether an agent waits for requests, and since when the longest waiting one does. */
export interface ListenerStatus {
  since: string;
  seenAt: string;
  count: number;
}

/** A change a request in its current state does not take, like cancelling one the agent works on. */
export class RequestStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestStateError';
  }
}

interface Payload {
  threadIds?: string[];
  note?: string;
  focus?: string;
  paths?: string[];
}

interface RequestRow {
  id: string;
  session_id: string;
  ref: string;
  mode: string;
  trigger: string;
  payload: string;
  status: string;
  progress: string | null;
  result: string | null;
  created_at: string;
  claimed_at: string | null;
  progress_at: string | null;
  done_at: string | null;
}

interface ListenerRow {
  id: string;
  pid: number;
  started_at: string;
  seen_at: string;
}

function parsePayload(json: string): Payload {
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === 'object' ? (value as Payload) : {};
  } catch {
    return {};
  }
}

function rowToRequest(row: RequestRow): AgentRequest {
  const payload = parsePayload(row.payload);
  return {
    id: row.id,
    sessionId: row.session_id,
    ref: row.ref,
    mode: row.mode as RequestMode,
    trigger: row.trigger as RequestTrigger,
    threadIds: payload.threadIds ?? [],
    note: payload.note ?? null,
    focus: payload.focus ?? null,
    paths: payload.paths ?? [],
    status: row.status as RequestStatus,
    progress: row.progress,
    result: row.result,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    progressAt: row.progress_at,
    doneAt: row.done_at,
  };
}

function iso(time: number): string {
  return new Date(time).toISOString();
}

/** Whether `request` waits for the agent or is being worked on. */
export function isActiveRequest(request: Pick<AgentRequest, 'status'>): boolean {
  return request.status === 'queued' || request.status === 'claimed';
}

export function enqueueRequest(input: NewRequest, now = Date.now()): AgentRequest {
  const payload: Payload = {};
  if (input.threadIds?.length) {
    payload.threadIds = input.threadIds;
  }
  if (input.note) {
    payload.note = input.note;
  }
  if (input.focus) {
    payload.focus = input.focus;
  }
  if (input.paths?.length) {
    payload.paths = input.paths;
  }
  const row: RequestRow = {
    id: randomUUID(),
    session_id: input.sessionId,
    ref: input.ref,
    mode: input.mode,
    trigger: input.trigger ?? 'user',
    payload: JSON.stringify(payload),
    status: 'queued',
    progress: null,
    result: null,
    created_at: iso(now),
    claimed_at: null,
    progress_at: null,
    done_at: null,
  };
  getDb().prepare(
    'INSERT INTO agent_requests (id, session_id, ref, mode, trigger, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(row.id, row.session_id, row.ref, row.mode, row.trigger, row.payload, row.status, row.created_at);
  return rowToRequest(row);
}

/**
 * Cancels the claimed requests the agent did not report on for
 * `REQUEST_EXPIRY_MS`, so a session that went away leaves nothing in progress.
 */
export function expireStaleRequests(now = Date.now()): number {
  const stale = "status = 'claimed' AND COALESCE(progress_at, claimed_at) < ?";
  const cutoff = iso(now - REQUEST_EXPIRY_MS);
  // Read first, so the browser's polling does not take the write lock each time.
  if (!queryOne<{ id: string }>(`SELECT id FROM agent_requests WHERE ${stale} LIMIT 1`, cutoff)) {
    return 0;
  }
  const result = getDb().prepare(`UPDATE agent_requests SET status = 'cancelled', result = ?, done_at = ? WHERE ${stale}`)
    .run(EXPIRED_RESULT, iso(now), cutoff);
  return Number(result.changes);
}

/** The newest requests first, after expiring stale ones. */
export function listRequests(limit = 50, now = Date.now()): AgentRequest[] {
  expireStaleRequests(now);
  return queryAll<RequestRow>('SELECT * FROM agent_requests ORDER BY created_at DESC, rowid DESC LIMIT ?', limit).map(rowToRequest);
}

/** The queued and claimed requests, oldest first. */
export function activeRequests(): AgentRequest[] {
  return queryAll<RequestRow>(
    "SELECT * FROM agent_requests WHERE status IN ('queued', 'claimed') ORDER BY created_at ASC, rowid ASC",
  ).map(rowToRequest);
}

/** The request with the id `idOrPrefix`, or the one whose id starts with it. A prefix needs 8 characters. */
export function findRequest(idOrPrefix: string): AgentRequest {
  const id = idOrPrefix.trim();
  const exact = queryOne<RequestRow>('SELECT * FROM agent_requests WHERE id = ?', id);
  if (exact) {
    return rowToRequest(exact);
  }
  if (id.length < 8 || !/^[0-9a-f-]+$/i.test(id)) {
    throw new InputError(`Request not found: ${id} (use at least 8 characters of the id)`, 'not_found');
  }
  const rows = queryAll<RequestRow>('SELECT * FROM agent_requests WHERE id LIKE ? LIMIT 2', `${id}%`);
  if (rows.length > 1) {
    throw new InputError(`Request id prefix "${id}" is ambiguous, use more characters`);
  }
  if (rows.length === 0) {
    throw new InputError(`Request not found: ${id}`, 'not_found');
  }
  return rowToRequest(rows[0]);
}

export function hasQueuedRequest(): boolean {
  return queryOne<{ id: string }>("SELECT id FROM agent_requests WHERE status = 'queued' LIMIT 1") !== undefined;
}

/**
 * Hands the oldest queued request to the caller and marks it claimed, or
 * returns `null` when none waits. The write lock makes sure two waiting
 * agents never get the same request.
 */
export function claimNextRequest(now = Date.now()): AgentRequest | null {
  return transaction(() => {
    expireStaleRequests(now);
    const row = queryOne<RequestRow>(
      "SELECT * FROM agent_requests WHERE status = 'queued' ORDER BY created_at ASC, rowid ASC LIMIT 1",
    );
    if (!row) {
      return null;
    }
    const claimedAt = iso(now);
    getDb().prepare("UPDATE agent_requests SET status = 'claimed', claimed_at = ? WHERE id = ? AND status = 'queued'").run(claimedAt, row.id);
    return rowToRequest({ ...row, status: 'claimed', claimed_at: claimedAt });
  });
}

/** An expired request comes back to life when the agent reports on it after all. */
function wasClaimed(request: AgentRequest): boolean {
  return request.status === 'claimed' || (request.status === 'cancelled' && request.claimedAt !== null);
}

/** Records what the agent is doing for request `idOrPrefix`, shown in the browser. */
export function setRequestProgress(idOrPrefix: string, text: string, now = Date.now()): AgentRequest {
  return transaction(() => {
    const request = findRequest(idOrPrefix);
    if (!wasClaimed(request)) {
      throw new RequestStateError(`Request ${request.id.slice(0, 8)} is ${request.status}, progress only applies to a claimed request`);
    }
    getDb().prepare(
      "UPDATE agent_requests SET status = 'claimed', progress = ?, progress_at = ?, result = NULL, done_at = NULL WHERE id = ?",
    ).run(text, iso(now), request.id);
    return findRequest(request.id);
  });
}

/** Marks request `idOrPrefix` done, with the agent's summary of what it did. */
export function finishRequest(idOrPrefix: string, summary?: string, now = Date.now()): AgentRequest {
  return transaction(() => {
    const request = findRequest(idOrPrefix);
    if (request.status === 'done') {
      return request;
    }
    if (!wasClaimed(request)) {
      throw new RequestStateError(`Request ${request.id.slice(0, 8)} is ${request.status}, only a claimed request can be done`);
    }
    getDb().prepare("UPDATE agent_requests SET status = 'done', result = ?, done_at = ? WHERE id = ?")
      .run(summary?.trim() || null, iso(now), request.id);
    return findRequest(request.id);
  });
}

/** Cancels request `idOrPrefix` while it is still queued. */
export function cancelRequest(idOrPrefix: string, now = Date.now()): AgentRequest {
  return transaction(() => {
    const request = findRequest(idOrPrefix);
    if (request.status !== 'queued') {
      throw new RequestStateError(`Request ${request.id.slice(0, 8)} is ${request.status}, only a queued request can be cancelled`);
    }
    getDb().prepare("UPDATE agent_requests SET status = 'cancelled', done_at = ? WHERE id = ?").run(iso(now), request.id);
    return findRequest(request.id);
  });
}

/**
 * The thread request of thread `threadId` that still waits, if any. It
 * reads the thread when the agent takes it, so it covers later comments too.
 */
export function queuedThreadRequest(threadId: string): AgentRequest | null {
  return activeRequests().find((r) => r.status === 'queued' && r.mode === 'thread' && r.threadIds[0] === threadId) ?? null;
}

function rowToListener(row: ListenerRow): Listener {
  return { id: row.id, pid: row.pid, startedAt: row.started_at, seenAt: row.seen_at };
}

/** Records a waiting agent, dropping listeners whose heartbeat stopped, e.g. after a kill. */
export function registerListener(pid = process.pid, now = Date.now()): Listener {
  const listener: Listener = { id: randomUUID(), pid, startedAt: iso(now), seenAt: iso(now) };
  transaction(() => {
    getDb().prepare('DELETE FROM agent_listeners WHERE seen_at < ?').run(iso(now - LISTENER_STALE_MS));
    getDb().prepare('INSERT INTO agent_listeners (id, pid, started_at, seen_at) VALUES (?, ?, ?, ?)')
      .run(listener.id, listener.pid, listener.startedAt, listener.seenAt);
  });
  return listener;
}

export function touchListener(id: string, now = Date.now()): void {
  getDb().prepare('UPDATE agent_listeners SET seen_at = ? WHERE id = ?').run(iso(now), id);
}

export function removeListener(id: string): void {
  getDb().prepare('DELETE FROM agent_listeners WHERE id = ?').run(id);
}

/** The listeners whose heartbeat is recent. */
export function liveListeners(now = Date.now()): Listener[] {
  return queryAll<ListenerRow>('SELECT * FROM agent_listeners WHERE seen_at >= ? ORDER BY started_at ASC', iso(now - LISTENER_STALE_MS))
    .map(rowToListener);
}

/** Whether an agent waits for requests right now, `null` when none does. */
export function listenerStatus(now = Date.now()): ListenerStatus | null {
  const live = liveListeners(now);
  if (live.length === 0) {
    return null;
  }
  return {
    since: live[0].startedAt,
    seenAt: live.map((l) => l.seenAt).sort().at(-1)!,
    count: live.length,
  };
}
