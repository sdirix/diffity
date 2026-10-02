import { describe, it, expect } from 'vitest';
import * as graphql from '../src/graphql.js';
import { parseGraphqlResponse } from '../src/graphql.js';

describe('parseGraphqlResponse', () => {
  it('returns the data', () => {
    expect(parseGraphqlResponse('{"data":{"viewer":{"login":"me"}}}')).toEqual({ viewer: { login: 'me' } });
  });

  it('joins the error messages', () => {
    expect(() => parseGraphqlResponse('{"data":null,"errors":[{"message":"Could not resolve"},{"message":"other"}]}'))
      .toThrow('Could not resolve\nother');
  });

  it('rejects empty and malformed responses', () => {
    expect(() => parseGraphqlResponse('{"data":null}')).toThrow('Empty GitHub response');
    expect(() => parseGraphqlResponse('<html>')).toThrow('Unexpected GitHub response');
  });
});

describe('queries', () => {
  it('balance their braces', () => {
    const queries = Object.entries(graphql).filter(([name, value]) => /_(QUERY|MUTATION)$/.test(name) && typeof value === 'string');
    expect(queries.length).toBeGreaterThan(0);
    for (const [name, query] of queries) {
      let depth = 0;
      for (const char of query as string) {
        depth += char === '{' ? 1 : char === '}' ? -1 : 0;
        expect(depth, name).toBeGreaterThanOrEqual(0);
      }
      expect(depth, name).toBe(0);
    }
  });
});

describe('review inputs', () => {
  const line = { threadId: 't1', path: 'a.ts', body: 'fix', side: 'RIGHT' as const, startLine: 3, line: 7 };
  const single = { ...line, threadId: 't2', side: 'LEFT' as const, startLine: 5, line: 5 };
  const file = { ...line, threadId: 't3', startLine: 0, line: 0 };

  it('builds draft threads with a start only for ranges', () => {
    expect(graphql.draftThreadInput(line)).toEqual({ path: 'a.ts', body: 'fix', line: 7, side: 'RIGHT', startLine: 3, startSide: 'RIGHT' });
    expect(graphql.draftThreadInput(single)).toEqual({ path: 'a.ts', body: 'fix', line: 5, side: 'LEFT' });
  });

  it('adds whole file threads with the file subject', () => {
    expect(graphql.addThreadInput('R1', file)).toEqual({ pullRequestReviewId: 'R1', path: 'a.ts', body: 'fix', subjectType: 'FILE' });
    expect(graphql.addThreadInput('R1', single)).toEqual({
      pullRequestReviewId: 'R1', path: 'a.ts', body: 'fix', line: 5, side: 'LEFT', subjectType: 'LINE',
    });
  });

  it('leaves a review pending without an event', () => {
    expect(graphql.addReviewInput({ pullRequestId: 'PR', commitOID: 'abc', threads: [single] })).toEqual({
      pullRequestId: 'PR', commitOID: 'abc', threads: [{ path: 'a.ts', body: 'fix', line: 5, side: 'LEFT' }],
    });
    expect(graphql.addReviewInput({ pullRequestId: 'PR', commitOID: 'abc', threads: [], event: 'APPROVE', body: 'lgtm' })).toEqual({
      pullRequestId: 'PR', commitOID: 'abc', threads: [], event: 'APPROVE', body: 'lgtm',
    });
    expect(graphql.submitReviewInput('R1', 'COMMENT', '')).toEqual({ pullRequestReviewId: 'R1', event: 'COMMENT' });
  });
});
