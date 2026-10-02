import type { IncomingMessage, ServerResponse } from 'node:http';
import { getWorkingTreeStatus } from '@diffity/git';
import { sendJson } from './http-utils.js';

export function handleTreeStatusRoute(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  if (pathname === '/api/tree/status' && req.method === 'GET') {
    sendJson(res, { files: getWorkingTreeStatus() });
    return true;
  }

  return false;
}
