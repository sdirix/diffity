import { describe, expect, it } from 'vitest';
import { withSharedParams } from '../src/lib/view-state';

describe('withSharedParams', () => {
  it('carries the theme and diff layout over to the other view', () => {
    expect(withSharedParams('', '?ref=work&theme=dark&view=split')).toBe('?theme=dark&view=split');
    expect(withSharedParams('?path=src&type=dir', '?theme=dark')).toBe('?path=src&type=dir&theme=dark');
  });

  it('replaces the values the other view was left with', () => {
    expect(withSharedParams('?ref=feature/x&theme=light', '?theme=dark')).toBe('?ref=feature/x&theme=dark');
  });

  it('keeps the location as it was when there is nothing to carry', () => {
    expect(withSharedParams('?ref=feature/x', '?path=src')).toBe('?ref=feature/x');
    expect(withSharedParams('?ref=work&theme=dark', '?theme=dark')).toBe('?ref=work&theme=dark');
  });
});
