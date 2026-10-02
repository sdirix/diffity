import { submitRequest } from './agent-request-input.js';
import type { AgentRequest } from './agent-requests.js';
import { readSettings } from './settings.js';
import type { ThreadAuthor } from './threads.js';

/** The handles that call the agent into a thread. */
export const AGENT_HANDLES = ['claude', 'agent'];

function fenceMarker(line: string): { char: string; length: number } | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  return match ? { char: match[1][0], length: match[1].length } : null;
}

/** The index of the next run of exactly `length` backticks in `line` from `from`, or -1. */
function closingRun(line: string, from: number, length: number): number {
  let i = from;
  while (i < line.length) {
    if (line[i] !== '`') {
      i++;
      continue;
    }
    let end = i;
    while (line[end] === '`') {
      end++;
    }
    if (end - i === length) {
      return i;
    }
    i = end;
  }
  return -1;
}

function stripInlineCode(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      out += line[i++];
      continue;
    }
    let end = i;
    while (line[end] === '`') {
      end++;
    }
    const close = closingRun(line, end, end - i);
    if (close === -1) {
      out += line.slice(i, end);
      i = end;
      continue;
    }
    out += ' ';
    i = close + (end - i);
  }
  return out;
}

/** `body` with fenced blocks and inline code spans blanked out. */
function stripCode(body: string): string {
  const out: string[] = [];
  let fence: { char: string; length: number } | null = null;
  for (const line of body.split('\n')) {
    const marker = fenceMarker(line);
    if (fence) {
      const char = fence.char;
      if (marker && marker.char === char && marker.length >= fence.length && [...line.trim()].every((c) => c === char)) {
        fence = null;
      }
      out.push('');
      continue;
    }
    if (marker) {
      fence = marker;
      out.push('');
      continue;
    }
    out.push(stripInlineCode(line));
  }
  return out.join('\n');
}

const WORD = /[\p{L}\p{N}_-]/u;

function hasMention(text: string, handle: string): boolean {
  const lower = text.toLowerCase();
  const needle = `@${handle}`;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + needle.length)) {
    const before = lower[at - 1];
    const after = lower[at + needle.length];
    const beforeOk = before === undefined || (!WORD.test(before) && !'@./'.includes(before));
    const afterOk = after === undefined
      || (after === '.' ? !WORD.test(lower[at + needle.length + 1] ?? ' ') : !WORD.test(after) && !'@/'.includes(after));
    if (beforeOk && afterOk) {
      return true;
    }
  }
  return false;
}

/** Whether `body` mentions `@claude` or `@agent` as a whole word, outside code. */
export function mentionsAgent(body: string): boolean {
  const prose = stripCode(body);
  return AGENT_HANDLES.some((handle) => hasMention(prose, handle));
}

export interface PostedComment {
  threadId: string;
  body: string;
  author: Pick<ThreadAuthor, 'type'>;
  /** The body before an edit, a mention it had already asked the agent. */
  previousBody?: string;
}

/**
 * Queues a thread request when the user's comment mentions the agent and
 * the mentions setting is on. Returns the request, or `null` when there is
 * none. Never throws: the comment is saved either way.
 */
export function requestOnMention(comment: PostedComment): AgentRequest | null {
  try {
    if (comment.author.type !== 'user' || !mentionsAgent(comment.body)) {
      return null;
    }
    if (comment.previousBody !== undefined && mentionsAgent(comment.previousBody)) {
      return null;
    }
    if (!readSettings().agentMentions) {
      return null;
    }
    return submitRequest({ mode: 'thread', threadIds: [comment.threadId], trigger: 'mention' });
  } catch {
    return null;
  }
}
