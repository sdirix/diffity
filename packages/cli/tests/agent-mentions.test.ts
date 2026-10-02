import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mentionsAgent } from '../src/agent-mentions.js';
import { activeRequests, claimNextRequest } from '../src/agent-requests.js';
import { startServer } from '../src/server.js';
import { findOrCreateSession, type Session } from '../src/session.js';
import { updateSettings } from '../src/settings.js';
import { createRepo, type TempRepo } from './helpers.js';

describe('mentionsAgent', () => {
  it('detects plain mentions of either handle', () => {
    expect(mentionsAgent('@claude can you fix this?')).toBe(true);
    expect(mentionsAgent('hey @Claude, why?')).toBe(true);
    expect(mentionsAgent('ping @CLAUDE')).toBe(true);
    expect(mentionsAgent('thoughts @claude.')).toBe(true);
    expect(mentionsAgent('(@claude) please')).toBe(true);
    expect(mentionsAgent('line one\n@claude: rename it')).toBe(true);
    expect(mentionsAgent('@agent take a look')).toBe(true);
    expect(mentionsAgent('what do you think, @Agent?')).toBe(true);
  });

  it('requires word boundaries', () => {
    expect(mentionsAgent('mail me at bob@claude.ai')).toBe(false);
    expect(mentionsAgent('@claudette said so')).toBe(false);
    expect(mentionsAgent('@claude_bot')).toBe(false);
    expect(mentionsAgent('@claude-code')).toBe(false);
    expect(mentionsAgent('see @@claude')).toBe(false);
    expect(mentionsAgent('claude should fix it')).toBe(false);
    expect(mentionsAgent('npm i @claude/sdk')).toBe(false);
    expect(mentionsAgent('the @agents of change')).toBe(false);
    expect(mentionsAgent('user@agent.example')).toBe(false);
  });

  it('ignores code', () => {
    expect(mentionsAgent('use `@claude` in comments')).toBe(false);
    expect(mentionsAgent('``a `@claude` b``')).toBe(false);
    expect(mentionsAgent('```\n@claude\n```')).toBe(false);
    expect(mentionsAgent('~~~md\nhello @agent\n~~~\n')).toBe(false);
    expect(mentionsAgent('```\ncode\n```\n@claude after the fence')).toBe(true);
    expect(mentionsAgent('unclosed ` tick @claude')).toBe(true);
    expect(mentionsAgent('````\n```\n@claude\n````')).toBe(false);
  });
});

describe('comments that mention the agent', () => {
  let repo: TempRepo;
  let session: Session;
  let server: { port: number; close: () => void };

  async function api(method: string, path: string, body: unknown): Promise<any> {
    const res = await fetch(`http://localhost:${server.port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  function comment(body: string, author = { name: 'You', type: 'user' }) {
    return api('POST', '/api/threads', { sessionId: session.id, filePath: 'a.txt', side: 'new', startLine: 1, endLine: 1, body, author });
  }

  beforeEach(async () => {
    repo = createRepo();
    repo.write('a.txt', 'changed\n');
    session = findOrCreateSession('work');
    server = await startServer({ port: 0, diffArgs: [] });
  });

  afterEach(() => {
    server.close();
    repo.remove();
  });

  it('queue a thread request for a new thread or reply', async () => {
    const thread = await comment('@claude why this change?');
    expect(activeRequests()).toMatchObject([{ mode: 'thread', trigger: 'mention', threadIds: [thread.id], sessionId: session.id, ref: 'work' }]);

    await api('POST', `/api/threads/${thread.id}/reply`, { body: '@agent and this?', author: { name: 'You', type: 'user' } });
    expect(activeRequests()).toHaveLength(1);

    claimNextRequest();
    await api('POST', `/api/threads/${thread.id}/reply`, { body: 'Also, @agent: the name?', author: { name: 'You', type: 'user' } });
    expect(activeRequests().map((r) => r.status)).toEqual(['claimed', 'queued']);
  });

  it('ask once when an edit adds the mention', async () => {
    const thread = await comment('Why this change?');
    expect(activeRequests()).toEqual([]);

    const commentId = thread.comments[0].id;
    await api('PATCH', `/api/comments/${commentId}`, { body: 'Why this change? @claude' });
    expect(activeRequests()).toHaveLength(1);
    claimNextRequest();
    await api('PATCH', `/api/comments/${commentId}`, { body: 'Why this change, @claude?' });
    expect(activeRequests().map((r) => r.status)).toEqual(['claimed']);
  });

  it('leave code, agent comments and a disabled setting alone', async () => {
    await comment('Use `@claude` here');
    await comment('@claude look', { name: 'Agent', type: 'agent' });
    updateSettings({ agentMentions: false });
    await comment('@claude look');
    expect(activeRequests()).toEqual([]);
  });
});
