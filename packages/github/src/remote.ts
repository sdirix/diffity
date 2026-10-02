import type { GitHubRemote } from './types.js';

const GITHUB_HOSTS = ['github.com', 'www.github.com', 'ssh.github.com'];

/**
 * Owner and repo of a github.com remote in https, ssh, git or scp-like form,
 * with or without `.git` and a trailing slash.
 */
export function parseRemoteUrl(url: string): GitHubRemote | null {
  const trimmed = url.trim();
  let host: string;
  let path: string;

  const schemeEnd = trimmed.indexOf('://');
  if (schemeEnd !== -1) {
    const rest = trimmed.slice(schemeEnd + 3);
    const slash = rest.indexOf('/');
    if (slash === -1) {
      return null;
    }
    const authority = rest.slice(0, slash);
    host = authority.slice(authority.lastIndexOf('@') + 1).split(':')[0];
    path = rest.slice(slash + 1);
  } else {
    const rest = trimmed.slice(trimmed.lastIndexOf('@') + 1);
    const colon = rest.indexOf(':');
    if (colon === -1) {
      return null;
    }
    host = rest.slice(0, colon);
    path = rest.slice(colon + 1);
  }

  if (!GITHUB_HOSTS.includes(host.toLowerCase())) {
    return null;
  }
  const parts = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '').split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  return { owner: parts[0], repo: parts[1] };
}
