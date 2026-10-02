import { describe, expect, it } from 'vitest';
import type { ViewedFile } from '../src/lib/api';
import { applyViewed, computeViewedState, initialCollapsed, nextUnviewedFile } from '../src/lib/viewed-state';

const mark = (path: string, blob: string | null, current: string | null, kept = true): ViewedFile => ({ path, blob, current, kept });

describe('computeViewedState', () => {
  const paths = ['a.ts', 'b.ts', 'c.ts'];

  it('keeps files whose new side is unchanged viewed', () => {
    const state = computeViewedState([mark('b.ts', 'h3', 'h3'), mark('c.ts', null, null, false)], paths);
    expect([...state.viewed]).toEqual(['b.ts', 'c.ts']);
    expect(state.changed.size).toBe(0);
  });

  it('flags files that changed after being viewed, unticked', () => {
    const changed = mark('a.ts', 'h1', 'h2');
    const state = computeViewedState([changed, mark('c.ts', 'h4', null, false), mark('d.ts', 'h9', 'h8')], paths);
    expect(state.viewed.size).toBe(0);
    expect(state.changed.get('a.ts')).toBe(changed);
    expect(state.changed.get('c.ts')?.kept).toBe(false);
    expect(state.changed.has('d.ts')).toBe(false);
  });

  it('clears the flag once the file is marked viewed again', () => {
    const entries = applyViewed([mark('a.ts', 'h1', 'h2')], ['a.ts'], true);
    const state = computeViewedState(entries, paths);
    expect(state.viewed.has('a.ts')).toBe(true);
    expect(state.changed.has('a.ts')).toBe(false);
  });
});

describe('applyViewed', () => {
  it('marks and unmarks before the server answers', () => {
    const entries = [mark('a.ts', 'h1', 'h1'), mark('b.ts', 'h2', 'h3')];
    expect(applyViewed(entries, ['a.ts', 'b.ts'], false)).toEqual([]);
    expect(applyViewed(entries, ['c.ts'], true).map((entry) => entry.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});

describe('initialCollapsed', () => {
  const paths = ['viewed.ts', 'changed.lock', 'package-lock.json', 'commented.lock', 'open.ts'];
  const auto = new Set(['changed.lock', 'package-lock.json', 'commented.lock']);
  const state = computeViewedState(
    [mark('viewed.ts', 'h1', 'h1'), mark('changed.lock', 'h1', 'h2')],
    paths,
  );

  it('collapses viewed and generated files, not ones with comments or changes since viewed', () => {
    const collapsed = initialCollapsed(paths, auto, new Set(['commented.lock']), state, new Set());
    expect([...collapsed]).toEqual(['viewed.ts', 'package-lock.json']);
  });

  it('flips files toggled by hand', () => {
    const collapsed = initialCollapsed(paths, auto, new Set(), state, new Set(['viewed.ts', 'open.ts']));
    expect([...collapsed]).toEqual(['package-lock.json', 'commented.lock', 'open.ts']);
  });
});

describe('nextUnviewedFile', () => {
  const paths = ['a.ts', 'b.ts', 'c.ts', 'd.ts'];

  it('skips viewed files and wraps around', () => {
    const viewed = new Set(['b.ts', 'd.ts']);
    expect(nextUnviewedFile(paths, 0, viewed)).toBe('c.ts');
    expect(nextUnviewedFile(paths, 2, viewed)).toBe('a.ts');
    expect(nextUnviewedFile(paths, 0, new Set(['b.ts', 'c.ts', 'd.ts']))).toBe('a.ts');
  });

  it('finds nothing when every file is viewed', () => {
    expect(nextUnviewedFile(paths, 1, new Set(paths))).toBeNull();
    expect(nextUnviewedFile([], 0, new Set())).toBeNull();
  });
});
