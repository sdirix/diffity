import { getRemoteUrl } from '@diffity/git';
import { gh, ghSucceeds } from './exec.js';
import { parseRemoteUrl } from './remote.js';
import type { GitHubRemote, GitHubDetails } from './types.js';

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

export function fetchDetails(owner: string, repo: string): GitHubDetails | null {
  if (!isCliInstalled() || !isAuthenticated()) {
    return null;
  }

  const pr = getPr();
  if (!pr) {
    return null;
  }

  const commentCount = getReviewCommentCount(owner, repo, pr.number);

  return {
    prNumber: pr.number,
    prTitle: pr.title,
    prUrl: pr.url,
    prCreatedAt: pr.createdAt,
    headSha: pr.headSha,
    commentCount,
  };
}

interface PrData {
  number: number;
  title: string;
  url: string;
  headSha: string;
  createdAt: string;
}

function getPr(): PrData | null {
  try {
    const json = gh(['pr', 'view', '--json', 'number,title,url,headRefOid,createdAt']);
    const data = JSON.parse(json);
    if (data.number && data.url && data.headRefOid) {
      return {
        number: data.number,
        title: data.title,
        url: data.url,
        headSha: data.headRefOid,
        createdAt: data.createdAt,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function getReviewCommentCount(owner: string, repo: string, prNumber: number): number {
  try {
    // With --paginate the filter runs once per page.
    const raw = gh(['api', `repos/${owner}/${repo}/pulls/${prNumber}/comments`, '--paginate', '--jq', 'length']);
    return raw.split('\n').reduce((sum, page) => sum + (parseInt(page, 10) || 0), 0);
  } catch {
    return 0;
  }
}
