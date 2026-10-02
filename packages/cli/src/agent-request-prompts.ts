import { basename } from 'node:path';
import { PATH_THREAD_PREFIX } from './agent-comment.js';
import type { AgentRequest } from './agent-requests.js';
import { TREE_REF } from './session.js';
import type { Thread } from './threads.js';
import { GENERAL_THREAD_PATH } from './thread-location.js';

/** The command the agent runs to wait for the next request. */
export function waitCommand(cli: string): string {
  return `${cli} agent wait --json`;
}

/** The name this CLI was started as, `diffity` unless it was a variant like `diffity-dev`. */
export function cliName(script = process.argv[1] ?? ''): string {
  const name = basename(script).replace(/\.[cm]?js$/, '');
  return /^diffity(-[\w-]+)?$/.test(name) ? name : 'diffity';
}

function quote(text: string): string {
  return text.trim().split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function firstLine(text: string, max = 100): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

/** Where `thread` sits, e.g. `src/a.ts:4-6 (new side)`. */
export function threadLocation(thread: Pick<Thread, 'filePath' | 'side' | 'startLine' | 'endLine'>): string {
  if (thread.filePath === GENERAL_THREAD_PATH) {
    return 'the whole change';
  }
  if (thread.filePath.startsWith(PATH_THREAD_PREFIX)) {
    return `\`${thread.filePath.slice(PATH_THREAD_PREFIX.length)}\``;
  }
  if (thread.startLine === 0) {
    return `\`${thread.filePath}\` (whole file)`;
  }
  const lines = thread.startLine === thread.endLine ? `${thread.startLine}` : `${thread.startLine}-${thread.endLine}`;
  return `\`${thread.filePath}:${lines}\` (${thread.side} side)`;
}

function viewName(ref: string): string {
  return ref === TREE_REF ? 'the file browser' : `the diff of \`${ref}\``;
}

interface Context {
  request: AgentRequest;
  /** `DIFFITY_SESSION_ID=<id> <cli>`, the prefix of every `agent` command of the request. */
  run: string;
  /** The threads of the request that still exist, by id. */
  threads: Map<string, Thread>;
}

function reviewTask({ request, run }: Context): string {
  const focus = request.focus
    ? `\nThe user's focus takes priority over the generic checks. Spend most of the review on it and say in your summary how you addressed it:\n\n${quote(request.focus)}\n`
    : '';
  const paths = request.paths.length > 0
    ? `\nReview only these files. Read others for context, but do not comment on them:\n\n${request.paths.map((p) => `- \`${p}\``).join('\n')}\n`
    : '';
  return `## Task: review

Review ${viewName(request.ref)} and leave review comments in diffity.
${focus}${paths}
Follow the diffity-review skill from Step 2 (review the diff) on. diffity runs and the user has the view open, so skip Step 1 and do not open the browser. Without the skill:

1. Read the diff with \`${run} agent diff\` and the existing comments with \`${run} agent list --json\`, so you do not repeat them.
2. Read each changed file in full and the project instruction files (CLAUDE.md, AGENTS.md). Look for bugs, broken contracts with callers, security issues, missing tests and violated project rules. Check each finding against the code before you comment.
3. Comment on each finding, the most severe first:
   \`${run} agent comment --file <path> --line <n> [--end-line <n>] [--side new|old] --severity must-fix|suggestion|nit|question --body "<text>"\`
4. With 3 or more findings, sum up their themes in \`${run} agent general-comment --body "<text>"\`. With none, post "No issues found." as the general comment.`;
}

function threadList({ request, threads }: Context): string {
  return request.threadIds.map((id) => {
    const thread = threads.get(id);
    if (!thread) {
      return `- \`${shortId(id)}\` no longer exists, skip it`;
    }
    const last = thread.comments.at(-1);
    const said = last ? `: ${last.author.name} said "${firstLine(last.body)}"` : '';
    return `- \`${shortId(id)}\` on ${threadLocation(thread)}${thread.status === 'open' ? '' : ` (${thread.status})`}${said}`;
  }).join('\n');
}

function resolveTask(context: Context): string {
  const { request, run } = context;
  const note = request.note ? `\nNote from the user for these threads:\n\n${quote(request.note)}\n` : '';
  const skill = request.ref === TREE_REF ? 'diffity-resolve-tree' : 'diffity-resolve';
  return `## Task: resolve comments

Address these review threads of ${viewName(request.ref)}: make the requested changes and report on each thread. Leave every other thread alone.

${threadList(context)}
${note}
Follow the instructions of the ${skill} skill for just these threads. Without the skill:

1. \`${run} agent list --status open --json\` has the full threads with their comments, lines and side.
2. A question or discussion: answer with \`${run} agent reply <thread-id> --body "<answer>"\`, grounded in the code (cite \`path:line\`), and leave the thread open.
3. A change request: make the change, then \`${run} agent resolve <thread-id> --summary "Fixed: <what changed>"\`. Never resolve a thread whose edit failed or was rejected. Reply with what you proposed instead.
4. Unclear: reply with a clarifying question.
5. Skip general comments an agent started, they are review summaries.`;
}

function conversation(thread: Thread): string {
  return thread.comments
    .map((comment) => `**${comment.author.name}** (${comment.author.type}):\n\n${quote(comment.body)}`)
    .join('\n\n');
}

function threadTask(context: Context): string {
  const { request, run, threads } = context;
  const id = request.threadIds[0] ?? '';
  const thread = threads.get(id);
  const asked = request.trigger === 'mention' ? 'mentioned you in' : 'asked you about';
  const note = request.note ? `\nNote from the user:\n\n${quote(request.note)}\n` : '';
  const body = thread
    ? `Thread \`${id}\` on ${threadLocation(thread)}, ${thread.status}:\n\n${conversation(thread)}`
    : `Thread \`${id}\` no longer exists. Mark the request done with the summary "Thread deleted".`;
  return `## Task: answer in a thread

The user ${asked} this thread of ${viewName(request.ref)}. Respond to its latest user comment, the earlier comments are context.

${body}
${note}
Handle it like the diffity-resolve skill handles a single thread:

- A question or discussion: read the code it points to and answer with \`${run} agent reply ${shortId(id)} --body "<answer>"\`, citing \`path:line\`. Leave the thread open.
- A change request: make the change, then \`${run} agent resolve ${shortId(id)} --summary "Fixed: <what changed>"\`. If the edit fails or is rejected, reply with what you proposed and leave the thread open.
- Unclear: reply with a clarifying question.

Leave exactly one response in the thread.`;
}

function summarizeTask({ request, run }: Context): string {
  return `## Task: summarize

Summarize ${viewName(request.ref)} for a reviewer and post the summary as a general comment.

Follow the diffity-summarize skill from Step 2 on. Skip Step 1 and do not open the browser. Without the skill: read \`${run} agent diff\`, write an overview, the changes by area, behavior changes and spots worth a closer look, dismiss an open agent comment that starts with **Summary** with \`${run} agent dismiss <id> --reason "Replaced by a new summary"\`, and post the new summary, starting with **Summary**, with \`${run} agent general-comment --body "<text>"\`.`;
}

const TITLES: Record<AgentRequest['mode'], string> = {
  review: 'review',
  resolve: 'resolve comments',
  thread: 'answer in a thread',
  summarize: 'summarize',
};

/**
 * What the agent is to do for `request`, as self-contained instructions:
 * the task, the session to work in, the commands to use and how to report
 * back. `threads` are the threads of its session.
 */
export function requestInstructions(request: AgentRequest, threads: Thread[], cli = cliName()): string {
  const run = `DIFFITY_SESSION_ID=${request.sessionId} ${cli}`;
  const context: Context = { request, run, threads: new Map(threads.map((t) => [t.id, t])) };
  const task = {
    review: reviewTask,
    resolve: resolveTask,
    thread: threadTask,
    summarize: summarizeTask,
  }[request.mode](context);

  return `# diffity request ${shortId(request.id)}: ${TITLES[request.mode]}

The user sent this from the diffity browser. Handle it now, in this session, with the context you already have.

- Request: \`${request.id}\`
- View: ${viewName(request.ref)}, session \`${request.sessionId}\`

## Session

Run every \`${cli} agent\` command of this request with \`DIFFITY_SESSION_ID=${request.sessionId}\` in front and without \`--ref\`, so it works on the view the user sent it from. For example:

    ${run} agent list --json

${task}

## Report

1. For longer work, report what you are doing. The browser shows it:
   \`${cli} agent progress ${request.id} "<what you are doing>"\`
2. When finished, mark the request done with a one line summary:
   \`${cli} agent done ${request.id} --summary "<what you did>"\`
3. Then wait for the next request: run \`${waitCommand(cli)}\` again as a background command.
`;
}
