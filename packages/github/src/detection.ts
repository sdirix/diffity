import { getRemoteUrl } from '@diffity/git';
import { ghSucceeds } from './exec.js';
import { parseRemoteUrl } from './remote.js';
import type { GitHubRemote } from './types.js';

export function getRemote(): GitHubRemote | null {
  const url = getRemoteUrl('origin');
  return url ? parseRemoteUrl(url) : null;
}

export function isCliInstalled(): boolean {
  return ghSucceeds(['--version']);
}

export function isAuthenticated(): boolean {
  return ghSucceeds(['auth', 'status']);
}

export function detectRemote(): GitHubRemote | null {
  const remote = getRemote();
  if (!remote) {
    return null;
  }
  return remote;
}
