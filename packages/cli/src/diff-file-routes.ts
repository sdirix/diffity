import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseDiff } from '@diffity/parser';
import { getRefFilePatch } from '@diffity/git';
import { sendError, sendJson } from './http-utils.js';

/** `/api/diff` sends files with a longer patch without hunks, the UI asks for them with `/api/diff/file`. */
export const LARGE_FILE_PATCH_LENGTH = 256 * 1024;

export function handleDiffFileRoute(req: IncomingMessage, res: ServerResponse, pathname: string, url: URL): boolean {
  if (pathname !== '/api/diff/file' || req.method !== 'GET') {
    return false;
  }
  const path = url.searchParams.get('path');
  if (!path) {
    sendError(res, 400, 'Missing path');
    return true;
  }
  const patch = getRefFilePatch(
    url.searchParams.get('ref') || 'work',
    path,
    url.searchParams.get('oldPath'),
    url.searchParams.get('whitespace') === 'hide' ? ['-w'] : [],
    { showHidden: url.searchParams.get('hidden') === '1' },
  );
  sendJson(res, { file: parseDiff(patch).files[0] ?? null });
  return true;
}
