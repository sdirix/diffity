import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { findOrCreateSession, setCurrentSession } from '../src/session.js';
import { getThreadsForSession } from '../src/threads.js';
import { createRepo, type TempRepo } from './helpers.js';

const require = createRequire(import.meta.url);
const TSX = require.resolve('tsx/cli');
const CLI = fileURLToPath(new URL('../src/index.ts', import.meta.url));

let repo: TempRepo;
let client: Client | null = null;

/** Starts `diffity mcp` in the repo and connects to it over stdio. */
async function connect(args: string[] = [], env: Record<string, string> = {}): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [TSX, CLI, 'mcp', ...args],
    cwd: repo.dir,
    env: { HOME: repo.home, ...env },
  });
  client = new Client({ name: 'diffity-test', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  const result = await client!.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  return { text: content.map((c) => c.text).join('\n'), isError: result.isError === true };
}

async function ok(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const { text, isError } = await call(name, args);
  expect(isError, text).toBe(false);
  return text;
}

function shortIdIn(text: string): string {
  return text.match(/thread ([0-9a-f]{8})/)![1];
}

beforeEach(() => {
  repo = createRepo();
  repo.write('big.txt', Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  repo.commit('big');
  repo.write('big.txt', Array.from({ length: 20 }, (_, i) => (i === 9 ? 'changed' : `line ${i + 1}`)).join('\n') + '\n');
});

afterEach(async () => {
  await client?.close();
  client = null;
  repo.remove();
});

describe('diffity mcp', { timeout: 30_000 }, () => {
  it('lists the review tools', async () => {
    await connect(['--ref', 'work']);
    const { tools } = await client!.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'get_diff', 'list_threads', 'add_comment', 'add_general_comment', 'reply', 'resolve', 'dismiss',
    ]);
    const addComment = tools.find((t) => t.name === 'add_comment')!;
    expect(addComment.inputSchema.required).toEqual(['file', 'startLine', 'body']);
  });

  it('comments, replies and resolves in the session of --ref', async () => {
    await connect(['--ref', 'work']);

    const diff = await ok('get_diff');
    expect(diff).toContain('Diff for `work` (1 files):\nmodified big.txt (+1 -1)\n\ndiff --git a/big.txt b/big.txt');

    const created = await ok('add_comment', { file: 'big.txt', startLine: 10, body: 'Restore the line', severity: 'must-fix' });
    expect(created).toMatch(/^Created thread [0-9a-f]{8} on big\.txt:10 \(new\)$/);
    const id = shortIdIn(created);
    const fileComment = await ok('add_comment', { file: 'big.txt', startLine: 0, body: 'Split this file' });
    expect(fileComment).toMatch(/ on big\.txt$/);

    const replied = await ok('reply', { threadId: id, body: 'On it' });
    expect(replied).toBe(`Replied to thread ${id}`);
    expect(await ok('resolve', { threadId: id, summary: 'Restored' })).toBe(`Resolved thread ${id}`);

    expect(await ok('dismiss', { threadId: shortIdIn(fileComment), reason: 'Too big a change' })).toMatch(/^Dismissed thread /);

    expect(JSON.parse(await ok('list_threads', { status: 'open' }))).toEqual([]);
    const [dismissed] = JSON.parse(await ok('list_threads', { status: 'dismissed' }));
    expect(dismissed).toMatchObject({ startLine: 0, endLine: 0, status: 'dismissed' });
    expect(dismissed.comments.at(-1)).toEqual({ author: { name: 'Agent', type: 'agent' }, body: 'Too big a change' });
    const [resolved] = JSON.parse(await ok('list_threads', { status: 'resolved' }));
    expect(resolved).toMatchObject({ filePath: 'big.txt', side: 'new', startLine: 10, endLine: 10, status: 'resolved' });
    expect(resolved.id.startsWith(id)).toBe(true);
    expect(resolved.comments.map((c: { body: string }) => c.body)).toEqual(['[must-fix] Restore the line', 'On it', 'Restored']);

    const stored = getThreadsForSession(findOrCreateSession('work').id).find((t) => t.startLine === 10);
    expect(stored).toMatchObject({ status: 'resolved', anchorContent: 'changed' });
  });

  it('rejects lines outside the diff with its ranges', async () => {
    await connect(['--ref', 'work']);
    const { text, isError } = await call('add_comment', { file: 'big.txt', startLine: 1, endLine: 2, body: 'x' });
    expect(isError).toBe(true);
    expect(text).toBe([
      'Lines 1-2 are outside the diff of "big.txt" on the new side.',
      'Lines on the new side of the diff: 7-13',
      'A comment has to stay within one of these ranges.',
      'Use startLine 0 to comment on the whole file.',
    ].join('\n'));
    expect((await call('add_comment', { file: 'nope.txt', startLine: 1, body: 'x' })).text).toContain('File not found');
    expect((await call('resolve', { threadId: 'deadbeef' })).text).toBe('Thread not found: deadbeef');
    expect(getThreadsForSession(findOrCreateSession('work').id)).toEqual([]);
  });

  it('binds to DIFFITY_SESSION_ID', async () => {
    const session = findOrCreateSession('HEAD~1');
    await connect([], { DIFFITY_SESSION_ID: session.id });
    expect(await ok('add_general_comment', { body: 'Looks good' })).toMatch(/^Created general comment [0-9a-f]{8}$/);
    expect(getThreadsForSession(session.id).map((t) => t.filePath)).toEqual(['__general__']);
  });

  it('falls back to the view opened last, looked up on every call', async () => {
    await connect();
    const missing = await call('list_threads');
    expect(missing).toEqual({ text: 'No active review session.\nStart diffity first to create a session, or pass --ref <ref>.', isError: true });

    const session = findOrCreateSession('work');
    setCurrentSession(session);
    const created = await ok('add_comment', { file: 'big.txt', startLine: 9, side: 'old', body: 'x' });
    expect(created).toContain('big.txt:9 (old)');
    expect(getThreadsForSession(session.id)).toHaveLength(1);
  });
});
