import type { IncomingMessage } from 'node:http';

const LOOPBACK_NAMES = ['localhost', '127.0.0.1', '[::1]'];

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** `Sec-Fetch-Site` values of a request from the UI itself or typed into the address bar. */
const OWN_FETCH_SITES = new Set(['same-origin', 'none']);

export interface Rejection {
  status: number;
  message: string;
}

/** The name part of a Host header, `[::1]` style for IPv6. */
function hostname(host: string): string {
  return host.replace(/:\d+$/, '');
}

function header(req: Pick<IncomingMessage, 'headers'>, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Why `req` is refused, or `null` to serve it. Only pages of the server's own
 * origin may use it: a foreign Host name means DNS rebinding, a foreign
 * Origin or a cross-site `Sec-Fetch-Site` another website, and JSON bodies
 * keep cross-origin writes behind a preflight that is never granted. Ports
 * are not compared, so a mapped container port keeps working.
 * `host` is the name the server is opened with besides the loopback ones.
 */
export function rejectRequest(
  req: Pick<IncomingMessage, 'method' | 'headers'>,
  pathname: string,
  host: string,
): Rejection | null {
  const requestHost = header(req, 'host')?.toLowerCase() ?? '';
  const names = new Set([...LOOPBACK_NAMES, host.toLowerCase()]);
  if (!/^[^@/\s]+$/.test(requestHost) || !names.has(hostname(requestHost))) {
    return { status: 403, message: 'Host not allowed, set DIFFITY_HOST' };
  }

  const origin = header(req, 'origin')?.toLowerCase();
  if (origin !== undefined && origin !== `http://${requestHost}` && origin !== `https://${requestHost}`) {
    return { status: 403, message: 'Origin not allowed' };
  }

  const site = header(req, 'sec-fetch-site');
  if (pathname.startsWith('/api/') && site !== undefined && !OWN_FETCH_SITES.has(site)) {
    return { status: 403, message: 'Cross-site request not allowed' };
  }

  const type = header(req, 'content-type')?.split(';')[0].trim().toLowerCase();
  if (BODY_METHODS.has(req.method ?? '') && type !== 'application/json') {
    return { status: 415, message: 'Expected application/json' };
  }

  return null;
}
