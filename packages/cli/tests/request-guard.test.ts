import { describe, it, expect } from 'vitest';
import { rejectRequest } from '../src/request-guard.js';

function check(headers: Record<string, string>, method = 'GET', pathname = '/api/diff', host = 'localhost') {
  return rejectRequest({ method, headers }, pathname, host)?.status ?? null;
}

describe('rejectRequest', () => {
  it('serves the loopback names and DIFFITY_HOST on any port', () => {
    for (const host of ['localhost:5391', '127.0.0.1:5391', '[::1]:5391', 'LOCALHOST:5391', 'localhost:8080', 'localhost']) {
      expect(check({ host }), host).toBeNull();
    }
    expect(check({ host: 'diffity.local:5391' }, 'GET', '/', 'diffity.local')).toBeNull();
  });

  it('refuses other hosts against DNS rebinding', () => {
    for (const host of ['evil.example:5391', 'localhost.evil.example', 'localhost:5391@evil.example', 'localhost/x']) {
      expect(check({ host }), host).toBe(403);
    }
    expect(check({})).toBe(403);
    expect(check({ host: 'diffity.local:5391' })).toBe(403);
  });

  it('refuses an origin other than the requested host', () => {
    const host = 'localhost:5391';
    expect(check({ host, origin: 'http://localhost:5391' }, 'POST', '/api/threads')).toBe(415);
    expect(check({ host, origin: 'https://localhost:5391' })).toBeNull();
    expect(check({ host: 'localhost:8080', origin: 'http://localhost:8080' })).toBeNull();
    for (const origin of ['https://evil.example', 'http://localhost:3000', 'http://127.0.0.1:5391', 'null']) {
      expect(check({ host, origin }), origin).toBe(403);
    }
  });

  it('refuses cross-site API requests but not navigations to the UI', () => {
    const host = 'localhost:5391';
    expect(check({ host, 'sec-fetch-site': 'same-origin' })).toBeNull();
    expect(check({ host, 'sec-fetch-site': 'none' })).toBeNull();
    expect(check({ host, 'sec-fetch-site': 'cross-site' })).toBe(403);
    expect(check({ host, 'sec-fetch-site': 'same-site' }, 'GET', '/api/tree/raw/a.png')).toBe(403);
    expect(check({ host, 'sec-fetch-site': 'cross-site' }, 'GET', '/diff')).toBeNull();
  });

  it('requires JSON bodies for writes', () => {
    const host = 'localhost:5391';
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      expect(check({ host }, method), method).toBe(415);
      expect(check({ host, 'content-type': 'text/plain' }, method), method).toBe(415);
      expect(check({ host, 'content-type': 'application/json; charset=utf-8' }, method), method).toBeNull();
    }
  });
});
