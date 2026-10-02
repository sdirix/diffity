import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cliName, requestInstructions, threadLocation } from '../src/agent-request-prompts.js';
import { enqueueRequest, type NewRequest } from '../src/agent-requests.js';
import { AGENT_AUTHOR } from '../src/agent-actions.js';
import { findOrCreateSession, TREE_REF, type Session } from '../src/session.js';
import { addReply, createThread, getThreadsForSession } from '../src/threads.js';
import { createRepo, type TempRepo } from './helpers.js';

const USER = { name: 'You', type: 'user' as const };

let repo: TempRepo;
let session: Session;

beforeEach(() => {
  repo = createRepo();
  session = findOrCreateSession('work');
});

afterEach(() => {
  repo.remove();
});

function instructions(request: Partial<NewRequest> & Pick<NewRequest, 'mode'>, sessionOf = session): string {
  const queued = enqueueRequest({ sessionId: sessionOf.id, ref: sessionOf.ref, ...request });
  return requestInstructions(queued, getThreadsForSession(sessionOf.id), 'diffity');
}

describe('requestInstructions', () => {
  it('scopes every command to the session of the request', () => {
    const text = instructions({ mode: 'review', focus: 'Error handling\nand retries', paths: ['a.txt'] });
    expect(text).toMatch(/^# diffity request [0-9a-f]{8}: review\n/);
    expect(text).toContain(`- View: the diff of \`work\`, session \`${session.id}\``);
    expect(text).toContain(`with \`DIFFITY_SESSION_ID=${session.id}\` in front and without \`--ref\``);
    expect(text).toContain('> Error handling\n> and retries');
    expect(text).toContain('Review only these files');
    expect(text).toContain('- `a.txt`');
    expect(text).toContain('Follow the diffity-review skill from Step 2');
    expect(text).toContain('run `diffity agent wait --json` again as a background command');
    expect(instructions({ mode: 'review' })).not.toContain('Review only these files');
  });

  it('lists the threads to resolve with their last comment', () => {
    const thread = createThread(session.id, 'a.txt', 'new', 2, 3, 'Rename this', USER);
    addReply(thread.id, 'Why?', AGENT_AUTHOR);
    const text = instructions({ mode: 'resolve', threadIds: [thread.id, 'gone-thread-id'], note: 'Keep it small' });
    expect(text).toContain(`- \`${thread.id.slice(0, 8)}\` on \`a.txt:2-3\` (new side): Agent said "Why?"`);
    expect(text).toContain('- `gone-thr` no longer exists, skip it');
    expect(text).toContain('Note from the user for these threads:\n\n> Keep it small');
    expect(text).toContain('Follow the instructions of the diffity-resolve skill');
  });

  it('points comments of the file browser at the tree skill', () => {
    const tree = findOrCreateSession(TREE_REF);
    const thread = createThread(tree.id, 'a.txt', 'new', 0, 0, 'Split this', USER);
    const text = instructions({ mode: 'resolve', threadIds: [thread.id] }, tree);
    expect(text).toContain('diffity-resolve-tree skill');
    expect(text).toContain('the file browser');
    expect(text).toContain('`a.txt` (whole file)');
  });

  it('quotes the conversation of a thread', () => {
    const thread = createThread(session.id, '__general__', 'new', 0, 0, '@claude is this safe?\n\nSee the loop.', USER);
    const text = instructions({ mode: 'thread', threadIds: [thread.id], trigger: 'mention' });
    expect(text).toContain('The user mentioned you in this thread');
    expect(text).toContain(`Thread \`${thread.id}\` on the whole change, open:`);
    expect(text).toContain('**You** (user):\n\n> @claude is this safe?\n>\n> See the loop.');
    expect(text).toContain(`agent reply ${thread.id.slice(0, 8)} --body`);
    expect(instructions({ mode: 'thread', threadIds: ['missing'] })).toContain('no longer exists');
  });

  it('summarizes with the summarize skill', () => {
    expect(instructions({ mode: 'summarize' })).toContain('Follow the diffity-summarize skill from Step 2 on.');
  });
});

describe('threadLocation', () => {
  it('names lines, files, folders and general comments', () => {
    expect(threadLocation({ filePath: 'a.ts', side: 'old', startLine: 4, endLine: 4 })).toBe('`a.ts:4` (old side)');
    expect(threadLocation({ filePath: '__path__:src', side: 'new', startLine: 0, endLine: 0 })).toBe('`src`');
  });
});

describe('cliName', () => {
  it('keeps a diffity variant and falls back to diffity', () => {
    expect(cliName('/usr/local/bin/diffity')).toBe('diffity');
    expect(cliName('/home/me/.bin/diffity-dev')).toBe('diffity-dev');
    expect(cliName('/repo/packages/cli/dist/index.js')).toBe('diffity');
    expect(cliName('')).toBe('diffity');
  });
});
