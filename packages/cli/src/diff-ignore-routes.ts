import type { IncomingMessage, ServerResponse } from 'node:http';
import { getDiffIgnoredPaths, getTree, readLocalDiffIgnore, writeLocalDiffIgnore } from '@diffity/git';
import { sendError, sendJson, withJsonBody } from './http-utils.js';

export function handleDiffIgnoreRoute(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  if (pathname === '/api/tree/hidden' && req.method === 'GET') {
    sendJson(res, { paths: getDiffIgnoredPaths(getTree()) });
    return true;
  }

  if (pathname === '/api/diff-ignore' && req.method === 'GET') {
    sendJson(res, { rules: readLocalDiffIgnore() });
    return true;
  }

  if (pathname === '/api/diff-ignore' && req.method === 'PUT') {
    withJsonBody(res, req, 'Failed to save the hidden file patterns', (body) => {
      if (typeof body.rules !== 'string') {
        sendError(res, 400, 'Missing rules');
        return;
      }
      writeLocalDiffIgnore(body.rules);
      sendJson(res, { ok: true });
    });
    return true;
  }

  return false;
}
