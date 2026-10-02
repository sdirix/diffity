import { describe, it, expect } from 'vitest';
import { parseDiff } from '@diffity/parser';
import { extractLinesFromDiff } from '../../ui/src/lib/diff-utils';
import {
  CommentTargetError,
  parseSeverity,
  resolveDiffTarget,
  resolveTreeTarget,
  withSeverity,
  type CommentRequest,
} from '../src/agent-comment.js';

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,5 @@
 one
-two
+TWO
+two and a half
 three
 four
@@ -20,3 +21,3 @@ function x() {
 twenty
-twenty-one
+TWENTY-ONE
 twenty-two
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 3333333..0000000
--- a/gone.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-bye
-now
diff --git a/img.png b/img.png
index 4444444..5555555 100644
Binary files a/img.png and b/img.png differ
`;

const diff = parseDiff(PATCH);

function place(path: string, side: 'old' | 'new', startLine: number, endLine = startLine) {
  return resolveDiffTarget(diff, 'work', { path, side, startLine, endLine });
}

function placeError(request: CommentRequest): CommentTargetError {
  try {
    resolveDiffTarget(diff, 'work', request);
  } catch (err) {
    if (err instanceof CommentTargetError) {
      return err;
    }
    throw err;
  }
  throw new Error('expected the comment to be rejected');
}

describe('resolveDiffTarget', () => {
  it('anchors lines inside a hunk the way the UI does', () => {
    const hunks = diff.files[0].hunks;
    for (const [side, start, end] of [['new', 2, 3], ['old', 2, 2], ['new', 1, 5], ['old', 20, 22]] as const) {
      const target = place('src/a.ts', side, start, end);
      expect(target.anchorContent).toBe(extractLinesFromDiff(hunks, side, start, end));
    }
    expect(place('src/a.ts', 'new', 2, 3)).toEqual({
      filePath: 'src/a.ts', side: 'new', startLine: 2, endLine: 3, anchorContent: 'TWO\ntwo and a half',
    });
  });

  it('lists the diff ranges when the lines are outside or span hunks', () => {
    for (const [start, end] of [[6, 8], [4, 22], [24, 24]]) {
      const err = placeError({ path: 'src/a.ts', side: 'new', startLine: start, endLine: end });
      expect(err.message).toMatch(/^Lines? [0-9-]+ (is|are) outside the diff of "src\/a.ts" on the new side\.$/);
      expect(err.hints).toContain('Lines on the new side of the diff: 1-5, 21-23');
    }
    expect(placeError({ path: 'src/a.ts', side: 'old', startLine: 5, endLine: 5 }).hints)
      .toContain('Lines on the old side of the diff: 1-4, 20-22');
  });

  it('makes line 0 a comment on the whole file', () => {
    expect(place('img.png', 'new', 0)).toEqual({ filePath: 'img.png', side: 'new', startLine: 0, endLine: 0 });
    expect(placeError({ path: 'img.png', side: 'new', startLine: 1, endLine: 1 }).message).toContain('binary');
  });

  it('places comments on a deleted file on its old side', () => {
    expect(place('gone.txt', 'old', 1, 2).anchorContent).toBe('bye\nnow');
    expect(placeError({ path: 'gone.txt', side: 'new', startLine: 1, endLine: 1 }).hints).toEqual(['Use --side old or --line 0.']);
  });

  it('names the files of the diff for an unknown file', () => {
    const err = placeError({ path: 'nope.ts', side: 'new', startLine: 1, endLine: 1 });
    expect(err.kind).toBe('file');
    expect(err.hints).toEqual(['The diff for ref "work" contains 3 file(s):', '  src/a.ts', '  gone.txt', '  img.png']);
  });
});

describe('resolveTreeTarget', () => {
  const content = 'a\nb\nc\n';

  it('anchors lines of the file', () => {
    expect(resolveTreeTarget(content, { path: 'x.txt', side: 'new', startLine: 2, endLine: 3 }).anchorContent).toBe('b\nc');
  });

  it('rejects lines past the end and makes line 0 a path comment', () => {
    expect(() => resolveTreeTarget(content, { path: 'x.txt', side: 'new', startLine: 3, endLine: 4 }))
      .toThrow('which has 3 line(s)');
    expect(resolveTreeTarget(content, { path: 'x.txt', side: 'new', startLine: 0, endLine: 0 }).filePath).toBe('__path__:x.txt');
  });
});

describe('severity', () => {
  it('parses the levels in any common spelling', () => {
    expect(parseSeverity('must-fix')).toBe('must-fix');
    expect(parseSeverity('[Must_Fix]')).toBe('must-fix');
    expect(parseSeverity('mustfix')).toBe('must-fix');
    expect(parseSeverity('NIT')).toBe('nit');
    expect(parseSeverity('blocker')).toBeNull();
  });

  it('tags the body once', () => {
    expect(withSeverity('Missing null check', 'must-fix')).toBe('[must-fix] Missing null check');
    expect(withSeverity('[nit] Rename', 'nit')).toBe('[nit] Rename');
    expect(withSeverity('Body', undefined)).toBe('Body');
    expect(() => withSeverity('[nit] Rename', 'question')).toThrow('contradicts --severity question');
  });
});
