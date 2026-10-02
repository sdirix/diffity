import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod';
import { parseDiff } from '@diffity/parser';
import { AgentError, PATH_THREAD_PREFIX, SEVERITIES, type OptionNames } from './agent-comment.js';
import {
  AGENT_AUTHOR,
  addAgentComment,
  addGeneralComment,
  closeThread,
  getSessionDiff,
  resolveSession,
  type SessionOptions,
} from './agent-actions.js';
import type { Session } from './session.js';
import { addReply, findThread, getThreadsForSession, type Thread } from './threads.js';

const TOOL_OPTIONS: OptionNames = {
  file: 'file',
  line: 'startLine',
  endLine: 'endLine',
  side: 'side',
  severity: 'severity',
};

const THREAD_ID = z.string().min(1).describe('Thread id from list_threads, or its first 8 characters.');

function run(action: () => string): CallToolResult {
  try {
    return { content: [{ type: 'text', text: action() }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hints = err instanceof AgentError ? err.hints : [];
    return { content: [{ type: 'text', text: [message, ...hints].join('\n') }], isError: true };
  }
}

function shortId(thread: Thread): string {
  return thread.id.slice(0, 8);
}

/** The path of `thread`, without the prefix of a file browser comment on a whole file or folder. */
function threadPath(thread: Thread): string {
  return thread.filePath.startsWith(PATH_THREAD_PREFIX) ? thread.filePath.slice(PATH_THREAD_PREFIX.length) : thread.filePath;
}

function threadJson(thread: Thread) {
  return {
    id: thread.id,
    filePath: threadPath(thread),
    side: thread.side,
    startLine: thread.startLine,
    endLine: thread.endLine,
    status: thread.status,
    comments: thread.comments.map((c) => ({ author: c.author, body: c.body })),
  };
}

function location(thread: Thread): string {
  const path = threadPath(thread);
  if (thread.startLine === 0) {
    return path;
  }
  const lines = thread.startLine === thread.endLine ? `${thread.startLine}` : `${thread.startLine}-${thread.endLine}`;
  return `${path}:${lines} (${thread.side})`;
}

function diffText(session: Session): string {
  const { ref, patch, hiddenFiles } = getSessionDiff(session);
  const files = parseDiff(patch).files.map((f) => {
    const path = f.status === 'deleted' ? f.oldPath : f.newPath;
    const from = f.status === 'renamed' || f.status === 'copied' ? ` from ${f.oldPath}` : '';
    return `${f.status} ${path}${from} (+${f.additions} -${f.deletions})${f.isBinary ? ' binary' : ''}`;
  });
  const hidden = hiddenFiles.length > 0 ? `, ${hiddenFiles.length} hidden by .diffityignore` : '';
  const header = `Diff for \`${ref}\` (${files.length} files${hidden}):`;
  return patch.trim() ? `${header}\n${files.join('\n')}\n\n${patch}` : `${header}\n(empty diff)`;
}

/** The diffity tools for the session `opts` selects, looked up again on every call. */
export function createMcpServer(opts: SessionOptions, version: string): McpServer {
  const server = new McpServer(
    { name: 'diffity', version },
    {
      instructions: 'Tools for the diffity review session the user has open: read the diff under review, '
        + 'list review threads, and leave, reply to, resolve or dismiss review comments. '
        + 'Comments show up in the diffity browser view right away.',
    },
  );
  const session = () => resolveSession(opts);

  server.registerTool('get_diff', {
    description: 'Get the unified diff of the review session, preceded by the list of changed files. '
      + 'Line numbers for comments come from the @@ hunk headers: new side lines for added and context code, '
      + 'old side lines for removed code.',
    annotations: { readOnlyHint: true },
  }, () => run(() => diffText(session())));

  server.registerTool('list_threads', {
    description: 'List the review threads of the session with their comments, file, line range, side and status. '
      + 'filePath "__general__" marks a comment on the whole diff, startLine 0 a comment on the whole file.',
    inputSchema: {
      status: z.enum(['open', 'resolved', 'dismissed']).optional().describe('Only threads with this status. Omit for all.'),
    },
    annotations: { readOnlyHint: true },
  }, ({ status }) => run(() => JSON.stringify(getThreadsForSession(session().id, status).map(threadJson))));

  server.registerTool('add_comment', {
    description: 'Leave a review comment on lines of a file in the diff. The lines have to lie within one hunk '
      + 'on the chosen side. In the file browser session any lines of the file work. '
      + 'Put the category in severity, not in the body.',
    inputSchema: {
      file: z.string().min(1).describe('Repository relative path of a file in the diff.'),
      startLine: z.number().int().min(0).describe('First line (1 based) on the chosen side, 0 for a comment on the whole file.'),
      endLine: z.number().int().min(0).optional().describe('Last line of the range. Defaults to startLine.'),
      side: z.enum(['new', 'old']).optional().describe('"new" (default) for added or unchanged code, "old" for removed code.'),
      body: z.string().min(1).describe('Markdown comment. Lead with the problem, be specific and actionable.'),
      severity: z.enum(SEVERITIES).optional().describe(
        'must-fix: bugs, security, data loss. suggestion: concrete improvement with a clear reason. '
        + 'nit: minor. question: needs the author\'s clarification.',
      ),
    },
    annotations: { readOnlyHint: false },
  }, (args) => run(() => {
    const thread = addAgentComment(session(), {
      path: args.file,
      side: args.side ?? 'new',
      startLine: args.startLine,
      endLine: args.endLine ?? args.startLine,
      body: args.body,
      severity: args.severity,
    }, TOOL_OPTIONS);
    return `Created thread ${shortId(thread)} on ${location(thread)}`;
  }));

  server.registerTool('add_general_comment', {
    description: 'Leave a comment on the whole diff, not tied to a file or line, e.g. the review summary.',
    inputSchema: {
      body: z.string().min(1).describe('Markdown comment.'),
    },
    annotations: { readOnlyHint: false },
  }, ({ body }) => run(() => `Created general comment ${shortId(addGeneralComment(session(), body))}`));

  server.registerTool('reply', {
    description: 'Reply to a review thread, e.g. to answer a question or ask the reviewer for clarification.',
    inputSchema: {
      threadId: THREAD_ID,
      body: z.string().min(1).describe('Markdown reply.'),
    },
    annotations: { readOnlyHint: false },
  }, ({ threadId, body }) => run(() => {
    const thread = findThread(session().id, threadId);
    addReply(thread.id, body, AGENT_AUTHOR);
    return `Replied to thread ${shortId(thread)}`;
  }));

  server.registerTool('resolve', {
    description: 'Mark a review thread as resolved, optionally with a summary of what was changed or the answer to a question.',
    inputSchema: {
      threadId: THREAD_ID,
      summary: z.string().optional().describe('What was done, e.g. "Fixed: added a null check before ...".'),
    },
    annotations: { readOnlyHint: false },
  }, ({ threadId, summary }) => run(() => {
    const thread = findThread(session().id, threadId);
    closeThread(thread, 'resolved', summary);
    return `Resolved thread ${shortId(thread)}`;
  }));

  server.registerTool('dismiss', {
    description: 'Dismiss a review thread that should not be acted on, optionally with a reason.',
    inputSchema: {
      threadId: THREAD_ID,
      reason: z.string().optional().describe('Why the thread is dismissed.'),
    },
    annotations: { readOnlyHint: false },
  }, ({ threadId, reason }) => run(() => {
    const thread = findThread(session().id, threadId);
    closeThread(thread, 'dismissed', reason);
    return `Dismissed thread ${shortId(thread)}`;
  }));

  return server;
}

/** Serves the diffity tools over stdio until the client disconnects. */
export async function runMcpServer(opts: SessionOptions, version: string): Promise<void> {
  await createMcpServer(opts, version).connect(new StdioServerTransport());
}
