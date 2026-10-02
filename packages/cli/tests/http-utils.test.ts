import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { withJsonBody } from '../src/http-utils.js';

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

/** Sends the headers and half of the body of a JSON request, then hangs up. */
function abortMidBody(port: number): Promise<void> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(`PUT /api HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"rules":`);
      setTimeout(() => socket.destroy(), 50);
    });
    socket.on('close', () => resolve());
  });
}

describe('withJsonBody', () => {
  it('survives a client that hangs up before the body is complete', async () => {
    const handled: unknown[] = [];
    const closed = new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        req.on('close', () => setTimeout(resolve, 50));
        withJsonBody(res, req, 'Failed', (body) => handled.push(body));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));

    await abortMidBody((server!.address() as AddressInfo).port);
    await closed;
    expect(handled).toEqual([]);
  });
});
