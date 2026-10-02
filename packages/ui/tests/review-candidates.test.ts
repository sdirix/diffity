import { describe, it, expect } from 'vitest';
import type { ReviewCandidate } from '../src/lib/api';
import { candidateLocation, defaultExcluded, disabledReason, groupByFile, headerLine, postedToast } from '../src/lib/review-candidates';

function candidate(id: string, filePath: string, startLine: number, endLine: number, options: { reason?: string; agent?: boolean } = {}): ReviewCandidate {
  return {
    thread: {
      id,
      sessionId: 's',
      createdAt: '',
      filePath,
      side: 'new',
      startLine,
      endLine,
      status: 'open',
      comments: [{ id: `${id}-c`, author: { name: options.agent ? 'Claude' : 'You', type: options.agent ? 'agent' : 'user' }, body: 'b', createdAt: '' }],
    },
    ref: 'origin/main',
    reason: options.reason ?? null,
  };
}

describe('review candidates', () => {
  it('labels locations', () => {
    expect(candidateLocation({ filePath: '__general__', startLine: 0, endLine: 0 })).toBe('General');
    expect(candidateLocation({ filePath: 'a.ts', startLine: 0, endLine: 0 })).toBe('File');
    expect(candidateLocation({ filePath: 'a.ts', startLine: 4, endLine: 4 })).toBe('L4');
    expect(candidateLocation({ filePath: 'a.ts', startLine: 4, endLine: 6 })).toBe('L4–6');
  });

  it('leaves postable agent threads out until chosen', () => {
    const list = [candidate('mine', 'a.ts', 1, 1), candidate('agent', 'a.ts', 2, 2, { agent: true }), candidate('blocked', 'a.ts', 3, 3, { agent: true, reason: 'x' })];
    expect([...defaultExcluded(list)]).toEqual(['agent']);
  });

  it('groups by file with general comments first', () => {
    const groups = groupByFile([candidate('a1', 'a.ts', 1, 1), candidate('g', '__general__', 0, 0), candidate('b', 'b.ts', 1, 1), candidate('a2', 'a.ts', 5, 5)]);
    expect(groups.map(([path, list]) => [path, list.map((c) => c.thread.id)])).toEqual([
      ['__general__', ['g']],
      ['a.ts', ['a1', 'a2']],
      ['b.ts', ['b']],
    ]);
  });

  it('says what is missing before submitting', () => {
    const ready = { blocker: null, selected: 1, hasBody: false, event: 'COMMENT' as const, needsPendingChoice: false };
    expect(disabledReason(ready)).toBeNull();
    expect(disabledReason({ ...ready, blocker: 'Local HEAD differs' })).toBe('Local HEAD differs');
    expect(disabledReason({ ...ready, selected: 0 })).toMatch(/^Select a comment/);
    expect(disabledReason({ ...ready, selected: 0, event: 'APPROVE' })).toBeNull();
    expect(disabledReason({ ...ready, needsPendingChoice: true })).toMatch(/pending review/);
    expect(headerLine(2, 1)).toBe("2 comments to post · 1 can't be posted");
  });

  it('summarizes a posted review', () => {
    expect(postedToast(7, 'APPROVE', { posted: 0, skipped: [], errors: [], url: null })).toEqual({ title: 'Approved #7' });
    expect(postedToast(7, 'COMMENT', { posted: 2, skipped: ['a.ts:1: Lines are outside the PR diff'], errors: [], url: null })).toEqual({
      title: 'Reviewed #7 with 2 comments',
      description: 'Skipped a.ts:1: Lines are outside the PR diff',
    });
  });
});
