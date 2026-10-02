import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRepoInfo } from '@diffity/git';
import { readSettings, updateSettingsFromRequest } from './settings.js';
import { clearRepoData, countRepoData } from './repo-data.js';
import { readJsonObject, sendJson } from './http-utils.js';

function sendRepoData(res: ServerResponse) {
  const { name, root } = getRepoInfo();
  sendJson(res, { name, root, ...countRepoData() });
}

/**
 * The global settings and this repo's stored data, for the settings dialog.
 * Errors reach the server's handler, which answers `InputError` with 400.
 */
export async function handleSettingsRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  if (pathname === '/api/settings' && req.method === 'GET') {
    sendJson(res, readSettings());
    return true;
  }

  if (pathname === '/api/settings' && req.method === 'PATCH') {
    sendJson(res, updateSettingsFromRequest(await readJsonObject(req)));
    return true;
  }

  if (pathname === '/api/repo-data' && req.method === 'GET') {
    sendRepoData(res);
    return true;
  }

  if (pathname === '/api/repo-data' && req.method === 'DELETE') {
    clearRepoData();
    sendRepoData(res);
    return true;
  }

  return false;
}
