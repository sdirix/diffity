import { describe, expect, it } from 'vitest';
import type { DiffFile } from '@diffity/parser';
import { filePatchOptions } from '../src/queries/diff';

const file: DiffFile = {
  oldPath: 'big.txt',
  newPath: 'big.txt',
  status: 'modified',
  hunks: [],
  additions: 4000,
  deletions: 4000,
  isBinary: false,
  trimmed: true,
};

describe('filePatchOptions', () => {
  it('reads a trimmed file again once the diff changed, even with the same line counts', () => {
    const source = { ref: 'work', hideWhitespace: false, showHidden: false };
    const before = filePatchOptions(file, { ...source, fingerprint: 'a' }).queryKey;
    const after = filePatchOptions(file, { ...source, fingerprint: 'b' }).queryKey;
    expect(after).not.toEqual(before);
    expect(filePatchOptions(file, { ...source, fingerprint: 'a' }).queryKey).toEqual(before);
  });
});
