import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseRequestInput, submitRequest } from './agent-request-input.js';
import { RequestStateError, cancelRequest, listenerStatus, listRequests } from './agent-requests.js';
import { readJsonObject, sendError, sendJson } from './http-utils.js';

const RECENT_REQUESTS = 30;

/**
 * Requests for the user's own agent: queue one, list the recent ones with
 * whether an agent waits for them, and cancel one that still waits. The
 * browser polls the list. Errors reach the server's handler, which answers
 * `InputError` with 400 or 404.
 */
export async function handleAgentRequestRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  if (pathname === '/api/agent/requests' && req.method === 'GET') {
    sendJson(res, { requests: listRequests(RECENT_REQUESTS), listener: listenerStatus() });
    return true;
  }

  if (pathname === '/api/agent/requests' && req.method === 'POST') {
    sendJson(res, submitRequest(parseRequestInput(await readJsonObject(req))));
    return true;
  }

  const cancelMatch = pathname.match(/^\/api\/agent\/requests\/([^/]+)\/cancel$/);
  if (cancelMatch && req.method === 'POST') {
    try {
      sendJson(res, cancelRequest(cancelMatch[1]));
    } catch (err) {
      if (!(err instanceof RequestStateError)) {
        throw err;
      }
      sendError(res, 409, err.message);
    }
    return true;
  }

  return false;
}
