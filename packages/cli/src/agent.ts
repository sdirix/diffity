import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { InvalidArgumentError, type Command } from 'commander';
import pc from 'picocolors';
import { getRepoRoot } from '@diffity/git';
import {
  AgentError,
  CommentTargetError,
  PATH_THREAD_PREFIX,
  SEVERITIES,
  parseSeverity,
  type Severity,
} from './agent-comment.js';
import {
  AGENT_AUTHOR,
  addAgentComment,
  addGeneralComment,
  assertRepo,
  assertRepoFile,
  closeThread,
  getSessionDiff,
  resolveSession,
  type SessionOptions,
} from './agent-actions.js';
import { TREE_REF, type Session } from './session.js';
import {
  getThreadsForSession,
  findThread,
  addReply,
  type ThreadStatus,
  type Thread,
} from './threads.js';
import { GENERAL_THREAD_PATH } from './thread-location.js';
import { createTour, addTourStep, updateTourStatus } from './tours.js';
import { registerAgentRequestCommands } from './agent-request-commands.js';

function fail(message: string, hint?: string): never {
  console.error(pc.red(`Error: ${message}`));
  if (hint) {
    console.error(pc.dim(hint));
  }
  process.exit(1);
}

const SHELL_TIP = [
  '  Tip: consecutive dots suggest a shell variable expanded to empty.',
  '  If your path contains "$" (e.g. "teams.$teamId.tsx"), single-quote the --file value',
  "  or escape it: --file 'apps/routes/teams.$teamId.tsx'",
];

/** Exits with the message and hints of `err`, plus a quoting tip when `path` is not found. */
function failWith(err: unknown, path?: string): never {
  if (!(err instanceof AgentError)) {
    fail(err instanceof Error ? err.message : String(err));
  }
  const mistyped = err instanceof CommentTargetError && err.kind === 'file' && path?.includes('..')
    && !existsSync(join(getRepoRoot(), path));
  const hints = mistyped ? [...err.hints, ...SHELL_TIP] : err.hints;
  fail(err.message, hints.join('\n') || undefined);
}

function requireRepo(): void {
  try {
    assertRepo();
  } catch (err) {
    failWith(err);
  }
}

function requireSession(opts: SessionOptions): Session {
  try {
    return resolveSession(opts);
  } catch (err) {
    failWith(err);
  }
}

function assertFileExists(filePath: string): void {
  try {
    assertRepoFile(filePath);
  } catch (err) {
    failWith(err, filePath);
  }
}

function parseLine(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError('Expected a line number.');
  }
  return Number(value);
}

function parseSeverityOption(value: string): Severity {
  const severity = parseSeverity(value);
  if (!severity) {
    throw new InvalidArgumentError(`Use one of ${SEVERITIES.join(', ')}.`);
  }
  return severity;
}

function resolveThreadId(shortId: string, sessionId: string): Thread {
  try {
    return findThread(sessionId, shortId);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

function formatThreadLine(thread: Thread): string {
  const shortId = thread.id.slice(0, 8);
  const isGeneral = thread.filePath === GENERAL_THREAD_PATH;
  const statusColor = thread.status === 'open' ? pc.yellow : thread.status === 'resolved' ? pc.green : thread.status === 'dismissed' ? pc.dim : pc.cyan;
  const statusLabel = statusColor(`[${thread.status}]`);
  const firstComment = thread.comments[0]?.body || '';
  const truncated = firstComment.length > 80 ? firstComment.slice(0, 77) + '...' : firstComment;

  if (isGeneral) {
    return `${statusLabel.padEnd(22)} ${pc.dim(shortId)}  ${pc.bold('General comment')}\n${''.padEnd(15)}${pc.dim('"')}${truncated}${pc.dim('"')}`;
  }

  const isPath = thread.filePath.startsWith(PATH_THREAD_PREFIX);
  const lineRange = thread.startLine === thread.endLine
    ? `${thread.startLine}`
    : `${thread.startLine}-${thread.endLine}`;
  const location = isPath
    ? thread.filePath.slice(PATH_THREAD_PREFIX.length)
    : thread.startLine === 0 ? thread.filePath : `${thread.filePath}:${lineRange}`;
  const sideLabel = isPath || thread.startLine === 0 ? '(file)' : thread.side === 'old' ? '(old)' : '(new)';

  return `${statusLabel.padEnd(22)} ${pc.dim(shortId)}  ${location} ${pc.dim(sideLabel)}\n${''.padEnd(15)}${pc.dim('"')}${truncated}${pc.dim('"')}`;
}

const REF_FLAGS = '--ref <ref>';
const REF_HELP = `Session of this ref, ${TREE_REF} for the file browser`;

export function registerAgentCommands(program: Command): void {
  const agent = program
    .command('agent')
    .description('Agent commands for interacting with review comments')
    .addHelpText('after', `
Session (first match wins):
  --ref <ref>            Session of this ref
  DIFFITY_SESSION_ID     Session with this id
  default                Last opened diff view, else the file browser

Examples:
  $ diffity agent list --status open --json
  $ diffity agent list --ref main
  $ diffity agent comment --file src/app.ts --line 42 --severity must-fix --body "Missing null check"
  $ diffity agent comment --file src/app.ts --line 0 --body "Split this file"
  $ diffity agent resolve abc12345 --summary "Added null check"
  $ diffity agent reply abc12345 --body "Good catch, fixed"
  $ diffity agent general-comment --body "Overall this looks good, just a few nits"
  $ diffity agent tour-start --topic "How does auth work?" --body "Overview of the auth flow"
  $ diffity agent tour-step --tour <id> --file src/auth.ts --line 10 --body "Entry point"
  $ diffity agent tour-done --tour <id>
  $ diffity agent wait --json
  $ diffity agent progress <request-id> "Reviewing src/app.ts"
  $ diffity agent done <request-id> --summary "2 must-fix, 1 nit"`);

  agent
    .command('list')
    .description('List comment threads in the current session (use --json for full details)')
    .option('--status <status>', 'Filter by status (open, resolved, dismissed)')
    .option('--json', 'Output as JSON')
    .option(REF_FLAGS, REF_HELP)
    .action((opts) => {
      const validStatuses = ['open', 'resolved', 'dismissed'];
      if (opts.status && !validStatuses.includes(opts.status)) {
        console.error(pc.red(`Error: Invalid status "${opts.status}". Must be one of: ${validStatuses.join(', ')}`));
        process.exit(1);
      }
      const session = requireSession(opts);
      const threads = getThreadsForSession(session.id, opts.status as ThreadStatus | undefined);

      if (opts.json) {
        console.log(JSON.stringify(threads, null, 2));
        return;
      }

      if (threads.length === 0) {
        console.log(pc.dim('No threads found.'));
        return;
      }

      for (const thread of threads) {
        console.log(formatThreadLine(thread));
      }
    });

  agent
    .command('comment')
    .description('Create a new comment thread')
    .requiredOption('--file <path>', 'File path (relative to repo root)')
    .option('--line <n>', 'Start line (1-indexed), 0 for a comment on the whole file', parseLine)
    .option('--start-line <n>', 'Same as --line', parseLine)
    .option('--end-line <n>', 'End line for multi-line comments (1-indexed)', parseLine)
    .option('--side <side>', 'Which side of the diff (new or old)', 'new')
    .option('--severity <level>', `Tag the body with [level]: ${SEVERITIES.join(', ')}`, parseSeverityOption)
    .requiredOption('--body <text>', 'Comment body')
    .option(REF_FLAGS, REF_HELP)
    .action((opts) => {
      if (opts.side !== 'new' && opts.side !== 'old') {
        fail(`Invalid side "${opts.side}". Must be "new" or "old"`);
      }
      if (opts.line !== undefined && opts.startLine !== undefined && opts.line !== opts.startLine) {
        fail('--line and --start-line differ, pass one of them');
      }
      const startLine: number | undefined = opts.line ?? opts.startLine;
      if (startLine === undefined) {
        fail('Missing --line <n>, use 0 for the whole file');
      }
      const endLine: number = opts.endLine ?? startLine;
      const session = requireSession(opts);
      const path = String(opts.file);
      let thread: Thread;
      try {
        thread = addAgentComment(session, { path, side: opts.side, startLine, endLine, body: opts.body, severity: opts.severity });
      } catch (err) {
        failWith(err, path);
      }
      console.log(pc.green(`Created thread ${thread.id.slice(0, 8)}`));
    });

  agent
    .command('resolve')
    .description('Resolve a thread (marks as fixed)')
    .argument('<thread-id>', 'Thread ID or a unique prefix of at least 8 characters')
    .option('--summary <text>', 'What was done to resolve it')
    .option(REF_FLAGS, REF_HELP)
    .action((id: string, opts) => {
      const session = requireSession(opts);
      const thread = resolveThreadId(id, session.id);
      closeThread(thread, 'resolved', opts.summary);
      console.log(pc.green(`Resolved thread ${thread.id.slice(0, 8)}`));
    });

  agent
    .command('dismiss')
    .description('Dismiss a thread (marks as won\'t fix)')
    .argument('<thread-id>', 'Thread ID or a unique prefix of at least 8 characters')
    .option('--reason <text>', 'Why the thread is being dismissed')
    .option(REF_FLAGS, REF_HELP)
    .action((id: string, opts) => {
      const session = requireSession(opts);
      const thread = resolveThreadId(id, session.id);
      closeThread(thread, 'dismissed', opts.reason);
      console.log(pc.green(`Dismissed thread ${thread.id.slice(0, 8)}`));
    });

  agent
    .command('reply')
    .description('Reply to a comment thread')
    .argument('<thread-id>', 'Thread ID or a unique prefix of at least 8 characters')
    .requiredOption('--body <text>', 'Reply body')
    .option(REF_FLAGS, REF_HELP)
    .action((id: string, opts) => {
      const session = requireSession(opts);
      const thread = resolveThreadId(id, session.id);
      addReply(thread.id, opts.body, AGENT_AUTHOR);
      console.log(pc.green(`Replied to thread ${thread.id.slice(0, 8)}`));
    });

  agent
    .command('general-comment')
    .description('Create a general comment on the entire diff (not tied to a specific file or line)')
    .requiredOption('--body <text>', 'Comment body')
    .option(REF_FLAGS, REF_HELP)
    .action((opts) => {
      const session = requireSession(opts);
      const thread = addGeneralComment(session, opts.body);
      console.log(pc.green(`Created general comment ${thread.id.slice(0, 8)}`));
    });

  agent
    .command('diff')
    .description('Output the unified diff for the current session (includes untracked files)')
    .option(REF_FLAGS, REF_HELP)
    .action((opts) => {
      const session = requireSession(opts);
      const { patch, hiddenFiles } = getSessionDiff(session);
      if (hiddenFiles.length > 0) {
        console.error(pc.dim(`${hiddenFiles.length} file${hiddenFiles.length === 1 ? '' : 's'} hidden by .diffityignore`));
      }
      if (!patch.trim()) {
        console.error(pc.dim('No diff content for current session.'));
        process.exit(0);
      }
      process.stdout.write(patch);
    });

  agent
    .command('tour-start')
    .description('Start a new guided tour of the codebase')
    .requiredOption('--topic <text>', 'The question or topic for the tour')
    .option('--body <text>', 'Introductory text for the tour', '')
    .option('--json', 'Output as JSON')
    .option(REF_FLAGS, REF_HELP)
    .action((opts) => {
      const session = requireSession(opts);
      const tour = createTour(session.id, opts.topic, opts.body);
      if (opts.json) {
        console.log(JSON.stringify(tour, null, 2));
        return;
      }
      console.log(pc.green(`Created tour ${tour.id}`));
    });

  agent
    .command('tour-step')
    .description('Add a step to a guided tour')
    .requiredOption('--tour <id>', 'Tour ID')
    .requiredOption('--file <path>', 'File path (relative to repo root)')
    .requiredOption('--line <n>', 'Start line number (1-indexed)', parseInt)
    .option('--end-line <n>', 'End line number (1-indexed)', parseInt)
    .option('--body <text>', 'Narrative text shown in sidebar', '')
    .option('--annotation <text>', 'Short inline annotation on highlighted code', '')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      requireRepo();
      assertFileExists(opts.file);
      const endLine = opts.endLine ?? opts.line;
      const step = addTourStep(opts.tour, opts.file, opts.line, endLine, opts.body, opts.annotation);
      if (opts.json) {
        console.log(JSON.stringify(step, null, 2));
        return;
      }
      console.log(pc.green(`Added step ${step.sortOrder} to tour`));
    });

  agent
    .command('tour-done')
    .description('Mark a tour as ready for viewing')
    .requiredOption('--tour <id>', 'Tour ID')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      requireRepo();
      updateTourStatus(opts.tour, 'ready');
      if (opts.json) {
        console.log(JSON.stringify({ ok: true }));
        return;
      }
      console.log(pc.green('Tour marked as ready'));
    });

  registerAgentRequestCommands(agent);
}
