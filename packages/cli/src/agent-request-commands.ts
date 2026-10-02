import { constants } from 'node:os';
import { InvalidArgumentError, type Command } from 'commander';
import pc from 'picocolors';
import { assertRepo } from './agent-actions.js';
import { cliName, requestInstructions, waitCommand } from './agent-request-prompts.js';
import {
  claimNextRequest,
  finishRequest,
  hasQueuedRequest,
  listenerStatus,
  listRequests,
  registerListener,
  removeListener,
  setRequestProgress,
  touchListener,
  type AgentRequest,
} from './agent-requests.js';
import { getThreadsForSession } from './threads.js';

/** The exit code of a wait that ran out of time, EX_TEMPFAIL: try again. */
export const WAIT_TIMEOUT_EXIT = 75;
/** Background commands of coding agents run for up to two hours, so a wait ends well before. */
const DEFAULT_TIMEOUT_SECONDS = 50 * 60;
const POLL_MS = 1000;
const HEARTBEAT_MS = 5000;
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

function fail(message: string): never {
  console.error(pc.red(`Error: ${message}`));
  process.exit(1);
}

function attempt<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

function parseSeconds(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError('Expected a number of seconds.');
  }
  return Number(value);
}

/**
 * Blocks until a request is queued and claims it, or returns `null` once
 * `timeoutMs` passed. A listener heartbeat shows the browser that an agent
 * waits, and goes away with the wait, also on a signal.
 */
export async function waitForRequest(timeoutMs: number): Promise<AgentRequest | null> {
  const listener = registerListener();
  const stop = () => {
    try {
      removeListener(listener.id);
    } catch {
      // The heartbeat goes stale on its own.
    }
  };
  const onSignal = (signal: NodeJS.Signals) => {
    stop();
    process.exit(128 + constants.signals[signal]);
  };
  for (const signal of SIGNALS) {
    process.on(signal, onSignal);
  }

  try {
    const deadline = Date.now() + timeoutMs;
    let beat = Date.now();
    for (;;) {
      const request = hasQueuedRequest() ? claimNextRequest() : null;
      if (request) {
        return request;
      }
      const now = Date.now();
      if (now >= deadline) {
        return null;
      }
      if (now - beat >= HEARTBEAT_MS) {
        touchListener(listener.id, now);
        beat = now;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_MS, deadline - now)));
    }
  } finally {
    for (const signal of SIGNALS) {
      process.off(signal, onSignal);
    }
    stop();
  }
}

function duration(seconds: number): string {
  const [count, unit] = seconds >= 120 ? [Math.round(seconds / 60), 'minute'] : [seconds, 'second'];
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

function statusColor(status: AgentRequest['status']): (text: string) => string {
  return { queued: pc.yellow, claimed: pc.cyan, done: pc.green, cancelled: pc.dim }[status];
}

function describe(request: AgentRequest): string {
  const count = request.threadIds.length;
  switch (request.mode) {
    case 'resolve':
      return `resolve ${count} thread${count === 1 ? '' : 's'}`;
    case 'thread':
      return `thread ${request.threadIds[0]?.slice(0, 8) ?? ''}`;
    default:
      return request.mode;
  }
}

function formatRequest(request: AgentRequest): string {
  const status = statusColor(request.status)(`[${request.status}]`);
  const detail = request.status === 'claimed' ? request.progress : request.result;
  const lines = [`${status.padEnd(22)} ${pc.dim(request.id.slice(0, 8))}  ${describe(request)} on ${request.ref}  ${pc.dim(request.createdAt)}`];
  if (detail) {
    lines.push(`${''.padEnd(15)}${pc.dim(detail)}`);
  }
  return lines.join('\n');
}

/** `diffity agent wait`, `progress`, `done` and `requests`: how the user's agent takes requests from the browser. */
export function registerAgentRequestCommands(agent: Command): void {
  agent
    .command('wait')
    .description('Wait for the next request from the browser, claim it and print what to do (run it in the background)')
    .option('--timeout <seconds>', `Give up after this long, exit ${WAIT_TIMEOUT_EXIT}`, parseSeconds, DEFAULT_TIMEOUT_SECONDS)
    .option('--json', 'Output as JSON')
    .action(async (opts: { timeout: number; json?: boolean }) => {
      attempt(assertRepo);
      const cli = cliName();
      const request = await waitForRequest(opts.timeout * 1000);
      if (!request) {
        const message = `No request in ${duration(opts.timeout)}. Run ${waitCommand(cli)} again as a background command.`;
        console.log(opts.json ? JSON.stringify({ timeout: true, message }) : message);
        process.exitCode = WAIT_TIMEOUT_EXIT;
        return;
      }
      const instructions = requestInstructions(request, getThreadsForSession(request.sessionId), cli);
      console.log(opts.json ? JSON.stringify({ ...request, instructions }, null, 2) : instructions);
    });

  agent
    .command('progress')
    .description('Report progress on a request, shown in the browser')
    .argument('<request-id>', 'Request ID or a unique prefix of at least 8 characters')
    .argument('<text>', 'What the agent is doing')
    .action((id: string, text: string) => {
      attempt(assertRepo);
      const request = attempt(() => setRequestProgress(id, text));
      console.log(pc.green(`Progress of request ${request.id.slice(0, 8)} recorded`));
    });

  agent
    .command('done')
    .description('Mark a request done')
    .argument('<request-id>', 'Request ID or a unique prefix of at least 8 characters')
    .option('--summary <text>', 'What the agent did, shown in the browser')
    .action((id: string, opts: { summary?: string }) => {
      attempt(assertRepo);
      const request = attempt(() => finishRequest(id, opts.summary));
      console.log(pc.green(`Request ${request.id.slice(0, 8)} done`));
      console.log(`Run ${waitCommand(cliName())} as a background command for the next request.`);
    });

  agent
    .command('requests')
    .description('List recent requests from the browser and whether an agent waits for them')
    .option('--json', 'Output as JSON')
    .action((opts: { json?: boolean }) => {
      attempt(assertRepo);
      const requests = listRequests(20);
      const listener = listenerStatus();
      if (opts.json) {
        console.log(JSON.stringify({ listener, requests }, null, 2));
        return;
      }
      console.log(listener ? pc.green(`Agent waiting since ${listener.since}`) : pc.dim('No agent waiting'));
      if (requests.length === 0) {
        console.log(pc.dim('No requests.'));
        return;
      }
      for (const request of requests) {
        console.log(formatRequest(request));
      }
    });
}
