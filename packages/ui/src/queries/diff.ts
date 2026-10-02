import { queryOptions } from '@tanstack/react-query';
import type { DiffFile } from '@diffity/parser';
import { fetchDiff, fetchFilePatch } from '../lib/api';
import { getFilePath } from '../lib/diff-utils';

export function diffOptions(hideWhitespace: boolean, ref?: string, showHidden = false) {
  return queryOptions({
    queryKey: ['diff', hideWhitespace, ref ?? null, showHidden],
    queryFn: () => fetchDiff(hideWhitespace, ref, showHidden),
  });
}

/** What a diff was read with, to read one of its files again. */
export interface DiffSource {
  ref?: string;
  hideWhitespace: boolean;
  showHidden: boolean;
  /** The fingerprint the diff came with, so its files are read again once it changed. */
  fingerprint?: string;
}

/** The hunks of a file the diff came without (`trimmed`). */
export function filePatchOptions(file: DiffFile, source: DiffSource) {
  const { ref, hideWhitespace, showHidden, fingerprint } = source;
  return queryOptions({
    queryKey: ['diff', 'file', ref ?? null, hideWhitespace, showHidden, fingerprint ?? null, getFilePath(file), file.oldPath, file.additions, file.deletions],
    queryFn: () => fetchFilePatch(file, hideWhitespace, ref, showHidden),
    staleTime: Infinity,
  });
}
