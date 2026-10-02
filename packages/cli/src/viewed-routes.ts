import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseDiff } from '@diffity/parser';
import { InputError } from '@diffity/git';
import { getSessionById, type Session } from './session.js';
import { getChangesSinceViewed, getViewedFiles, markViewed, unmarkViewed } from './viewed.js';
import { readJsonObject, sendJson } from './http-utils.js';

function requireSession(id: unknown): Session {
  const session = typeof id === 'string' ? getSessionById(id) : null;
  if (!session) {
    throw new InputError('Unknown session', 'not_found');
  }
  return session;
}

function requirePaths(paths: unknown): string[] {
  if (!Array.isArray(paths) || !paths.every((path) => typeof path === 'string')) {
    throw new InputError('Missing paths');
  }
  return paths;
}

/** Viewed files of a review session. Errors reach the server's handler, which answers `InputError` with 400 or 404. */
export async function handleViewedRoute(req: IncomingMessage, res: ServerResponse, pathname: string, url: URL): Promise<boolean> {
  if (pathname === '/api/viewed' && req.method === 'GET') {
    sendJson(res, { files: getViewedFiles(requireSession(url.searchParams.get('session'))) });
    return true;
  }

  if (pathname === '/api/viewed' && (req.method === 'POST' || req.method === 'DELETE')) {
    const body = await readJsonObject(req);
    const session = requireSession(body.sessionId);
    const paths = requirePaths(body.paths);
    if (req.method === 'POST') {
      markViewed(session, paths);
    } else {
      unmarkViewed(session, paths);
    }
    sendJson(res, { files: getViewedFiles(session) });
    return true;
  }

  if (pathname === '/api/viewed/changes' && req.method === 'GET') {
    const session = requireSession(url.searchParams.get('session'));
    const path = url.searchParams.get('path');
    if (!path) {
      throw new InputError('Missing path');
    }
    const patch = getChangesSinceViewed(session, path);
    sendJson(res, { file: patch ? parseDiff(patch).files[0] ?? null : null });
    return true;
  }

  return false;
}
