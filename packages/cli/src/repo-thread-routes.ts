import type { IncomingMessage, ServerResponse } from 'node:http';
import { listLocatedThreads } from './repo-threads.js';
import { sendJson } from './http-utils.js';

export function handleRepoThreadRoute(req: IncomingMessage, res: ServerResponse, pathname: string, url: URL): boolean {
  if (pathname === '/api/repo-threads' && req.method === 'GET') {
    sendJson(res, listLocatedThreads(url.searchParams.get('session') || undefined));
    return true;
  }

  return false;
}
