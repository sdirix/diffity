import type { IncomingMessage, ServerResponse } from 'node:http';
import { getBaseBranch, getCommit, getCurrentBranch, getDiffFiles, resolveDiffArgs, WORKING_TREE_REFS } from '@diffity/git';
import { sendJson, sendError } from './http-utils.js';

export function handleRefRoute(req: IncomingMessage, res: ServerResponse, pathname: string, url: URL): boolean {
  if (pathname === '/api/status' && req.method === 'GET') {
    sendJson(res, {
      branch: getCurrentBranch(),
      base: getBaseBranch(),
      work: getDiffFiles('work').length,
      staged: getDiffFiles('staged').length,
      unstaged: getDiffFiles('unstaged').length,
    });
    return true;
  }

  if (pathname === '/api/ref' && req.method === 'GET') {
    const ref = url.searchParams.get('ref')?.trim();
    if (!ref) {
      sendError(res, 400, 'Missing ref');
      return true;
    }
    resolveDiffArgs(ref);
    const single = !WORKING_TREE_REFS.has(ref) && !ref.includes('..');
    sendJson(res, { ref, commit: single ? getCommit(ref) : null });
    return true;
  }

  return false;
}
