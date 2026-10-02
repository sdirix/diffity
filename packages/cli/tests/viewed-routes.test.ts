import { describe, it, expect } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { InputError } from '@diffity/git';
import { handleViewedRoute } from '../src/viewed-routes.js';

function request(method: string, body: string): IncomingMessage {
  return Object.assign(Readable.from([Buffer.from(body)]), { method, headers: {}, complete: true }) as unknown as IncomingMessage;
}

describe('handleViewedRoute', () => {
  it('rejects a body that is not a JSON object as invalid input', async () => {
    for (const body of ['{', 'null', '[]', '"paths"']) {
      for (const method of ['POST', 'DELETE']) {
        const handled = handleViewedRoute(request(method, body), {} as ServerResponse, '/api/viewed', new URL('http://localhost/api/viewed'));
        await expect(handled, `${method} ${body}`).rejects.toThrow(InputError);
        await expect(handled).rejects.toMatchObject({ code: 'invalid' });
      }
    }
  });
});
