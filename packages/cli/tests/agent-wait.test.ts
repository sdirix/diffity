import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { enqueueRequest, findRequest, listenerStatus, claimNextRequest } from '../src/agent-requests.js';
import { WAIT_TIMEOUT_EXIT } from '../src/agent-request-commands.js';
import { findOrCreateSession, type Session } from '../src/session.js';
import { createRepo, type TempRepo } from './helpers.js';

const require = createRequire(import.meta.url);
const TSX = require.resolve('tsx/cli');
const CLI = fileURLToPath(new URL('../src/index.ts', import.meta.url));

let repo: TempRepo;
let session: Session;
const children: ChildProcess[] = [];

interface Result {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/** Runs `diffity agent <args>` in the repo. `exited` settles when it ends. */
function agent(...args: string[]): { child: ChildProcess; exited: Promise<Result> } {
  const child = spawn(process.execPath, [TSX, CLI, 'agent', ...args], {
    cwd: repo.dir,
    env: { ...process.env, HOME: repo.home, DIFFITY_SESSION_ID: '' },
  });
  children.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout!.on('data', (chunk) => (stdout += chunk));
  child.stderr!.on('data', (chunk) => (stderr += chunk));
  const exited = new Promise<Result>((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, exited };
}

async function until(check: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for the condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

beforeEach(() => {
  repo = createRepo();
  session = findOrCreateSession('work');
});

afterEach(() => {
  for (const child of children.splice(0)) {
    child.kill('SIGKILL');
  }
  repo.remove();
});

describe('diffity agent wait', { timeout: 30_000 }, () => {
  it('waits for a request, claims it and prints what to do', async () => {
    const { exited } = agent('wait', '--json', '--timeout', '20');
    await until(() => listenerStatus() !== null);
    expect(listenerStatus()?.count).toBe(1);

    const request = enqueueRequest({ sessionId: session.id, ref: 'work', mode: 'review', focus: 'error handling' });
    const { code, stdout } = await exited;

    expect(code).toBe(0);
    const printed = JSON.parse(stdout);
    expect(printed).toMatchObject({ id: request.id, mode: 'review', ref: 'work', sessionId: session.id, status: 'claimed', focus: 'error handling' });
    expect(printed.instructions).toContain(`DIFFITY_SESSION_ID=${session.id} diffity agent diff`);
    expect(printed.instructions).toContain(`diffity agent done ${request.id} --summary`);
    expect(findRequest(request.id).status).toBe('claimed');
    expect(listenerStatus()).toBeNull();
  });

  it('prints the instructions as text without --json', async () => {
    enqueueRequest({ sessionId: session.id, ref: 'work', mode: 'summarize' });
    const { code, stdout } = await agent('wait', '--timeout', '5').exited;
    expect(code).toBe(0);
    expect(stdout).toMatch(/^# diffity request [0-9a-f]{8}: summarize\n/);
  });

  it('exits with its own code when no request comes', async () => {
    const { code, stdout } = await agent('wait', '--json', '--timeout', '1').exited;
    expect(code).toBe(WAIT_TIMEOUT_EXIT);
    expect(JSON.parse(stdout)).toEqual({
      timeout: true,
      message: 'No request in 1 second. Run diffity agent wait --json again as a background command.',
    });
    expect(listenerStatus()).toBeNull();
  });

  it('removes its heartbeat when stopped', async () => {
    const { child, exited } = agent('wait', '--timeout', '20');
    await until(() => listenerStatus() !== null);
    child.kill('SIGTERM');
    const { code } = await exited;
    expect(code).toBe(143);
    expect(listenerStatus()).toBeNull();
  });
});

describe('diffity agent progress, done and requests', { timeout: 30_000 }, () => {
  it('reports on a claimed request', async () => {
    const request = enqueueRequest({ sessionId: session.id, ref: 'work', mode: 'review' });
    const early = await agent('done', request.id).exited;
    expect(early.code).toBe(1);
    expect(early.stderr).toContain('is queued, only a claimed request can be done');

    claimNextRequest();
    expect((await agent('progress', request.id.slice(0, 8), 'Reading a.txt').exited).code).toBe(0);
    expect(findRequest(request.id).progress).toBe('Reading a.txt');

    const done = await agent('done', request.id, '--summary', 'No issues').exited;
    expect(done.code).toBe(0);
    expect(done.stdout).toContain('Run diffity agent wait --json as a background command');
    expect(findRequest(request.id)).toMatchObject({ status: 'done', result: 'No issues' });

    const listed = JSON.parse((await agent('requests', '--json').exited).stdout);
    expect(listed).toMatchObject({ listener: null, requests: [{ id: request.id, status: 'done' }] });
  });

  it('names a request that does not exist', async () => {
    const { code, stderr } = await agent('progress', 'deadbeef', 'x').exited;
    expect(code).toBe(1);
    expect(stderr).toContain('Request not found: deadbeef');
  });
});
