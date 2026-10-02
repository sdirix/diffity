import type { IncomingMessage, ServerResponse } from 'node:http';
import { InputError } from '@diffity/git';

export function sendJson(res: ServerResponse, data: unknown) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function sendError(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

/** The body as text. Rejects when the client goes away before sending all of it. */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
    req.on('close', () => {
      if (!req.complete) {
        reject(new Error('Request aborted'));
      }
    });
  });
}

/** The JSON object of the body, `InputError` for anything else. */
export async function readJsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    throw new InputError('Invalid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new InputError('Expected an object');
  }
  return body as Record<string, unknown>;
}

export function withJsonBody(
  res: ServerResponse,
  req: IncomingMessage,
  errorPrefix: string,
  handler: (body: Record<string, unknown>) => void,
) {
  readBody(req).then(
    (raw) => {
      try {
        const body = JSON.parse(raw);
        handler(body);
      } catch (err) {
        sendError(res, 500, `${errorPrefix}: ${err}`);
      }
    },
    () => sendError(res, 400, 'Incomplete request body'),
  );
}
