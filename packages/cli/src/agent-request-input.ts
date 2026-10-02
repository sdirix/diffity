import { InputError } from '@diffity/git';
import { resolveSession } from './agent-actions.js';
import {
  REQUEST_MODES,
  activeRequests,
  enqueueRequest,
  queuedThreadRequest,
  type AgentRequest,
  type RequestMode,
  type RequestTrigger,
} from './agent-requests.js';
import { queryOne } from './db.js';
import { getSessionById, TREE_REF, type Session } from './session.js';
import { findThread, getThreadsForSession, type Thread } from './threads.js';
import { GENERAL_THREAD_PATH } from './thread-location.js';

/** A request as the browser sends it. */
export interface RequestInput {
  mode: RequestMode;
  /** The view it is for. A thread request without one is for the view of its thread. */
  ref?: string;
  /** `resolve`: the threads to work on, picked like `resolveTargets` when empty. `thread`: the one thread. */
  threadIds?: string[];
  note?: string;
  focus?: string;
  paths?: string[];
  trigger?: RequestTrigger;
}

const MAX_TEXT = 10_000;

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length > MAX_TEXT) {
    throw new InputError(`${key} must be a string`);
  }
  return value.trim() || undefined;
}

function stringList(body: Record<string, unknown>, key: string): string[] | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new InputError(`${key} must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

/** Checks the JSON body of a new request. */
export function parseRequestInput(body: Record<string, unknown>): RequestInput {
  const mode = body.mode;
  if (typeof mode !== 'string' || !(REQUEST_MODES as readonly string[]).includes(mode)) {
    throw new InputError(`mode must be one of ${REQUEST_MODES.join(', ')}`);
  }
  return {
    mode: mode as RequestMode,
    ref: optionalString(body, 'ref'),
    threadIds: stringList(body, 'threadIds'),
    note: optionalString(body, 'note'),
    focus: optionalString(body, 'focus'),
    paths: stringList(body, 'paths'),
  };
}

/**
 * The open threads a resolve request takes up without a selection: those
 * whose last comment is the user's, else the agent's own review comments
 * nobody replied to yet. Threads in `busy` are left to the request they are in.
 */
export function resolveTargets(threads: Thread[], busy: ReadonlySet<string> = new Set()): Thread[] {
  const open = threads.filter((t) => t.status === 'open' && !busy.has(t.id) && t.comments.length > 0);
  const unaddressed = open.filter((t) => t.comments[t.comments.length - 1].author.type === 'user');
  if (unaddressed.length > 0) {
    return unaddressed;
  }
  return open.filter((t) => t.filePath !== GENERAL_THREAD_PATH && t.comments.every((c) => c.author.type === 'agent'));
}

function sessionOfRef(ref: string): Session {
  try {
    return resolveSession({ ref });
  } catch (err) {
    throw new InputError(err instanceof Error ? err.message : String(err));
  }
}

function sessionThread(sessionId: string, id: string): Thread {
  try {
    return findThread(sessionId, id);
  } catch (err) {
    throw new InputError(err instanceof Error ? err.message : String(err));
  }
}

/** The session thread `threadId` belongs to. */
function sessionOfThread(threadId: string): Session {
  const row = queryOne<{ session_id: string }>('SELECT session_id FROM comment_threads WHERE id = ?', threadId);
  const session = row ? getSessionById(row.session_id) : null;
  if (!session) {
    throw new InputError(`Thread not found: ${threadId}`, 'not_found');
  }
  return session;
}

function threadRequest(input: RequestInput): AgentRequest {
  if (input.threadIds?.length !== 1) {
    throw new InputError('A thread request takes exactly one thread id');
  }
  const session = input.ref ? sessionOfRef(input.ref) : sessionOfThread(input.threadIds[0]);
  const thread = sessionThread(session.id, input.threadIds[0]);
  const queued = queuedThreadRequest(thread.id);
  if (queued) {
    return queued;
  }
  return enqueueRequest({ ...input, sessionId: session.id, ref: session.ref, threadIds: [thread.id] });
}

/**
 * Queues `input` for the agent in the session of its ref. A thread whose
 * thread request still waits gets no second one.
 */
export function submitRequest(input: RequestInput): AgentRequest {
  if (input.mode === 'thread') {
    return threadRequest(input);
  }
  if (!input.ref) {
    throw new InputError('Missing ref');
  }
  const session = sessionOfRef(input.ref);
  const base = { ...input, sessionId: session.id, ref: session.ref };

  if (input.mode === 'resolve') {
    const busy = new Set(activeRequests().flatMap((request) => request.threadIds));
    const threads = input.threadIds?.length
      ? input.threadIds.map((id) => sessionThread(session.id, id))
      : resolveTargets(getThreadsForSession(session.id, 'open'), busy);
    if (threads.length === 0) {
      throw new InputError('No open threads to resolve');
    }
    return enqueueRequest({ ...base, threadIds: [...new Set(threads.map((t) => t.id))] });
  }

  if (session.ref === TREE_REF) {
    throw new InputError(`A ${input.mode} needs a diff, the file browser has none`);
  }
  return enqueueRequest({ ...base, threadIds: [] });
}
