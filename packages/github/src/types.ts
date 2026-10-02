export interface GitHubRemote {
  owner: string;
  repo: string;
}

export interface RepoSlug {
  owner: string;
  name: string;
}

export interface PullRequest {
  slug: RepoSlug;
  /** The GraphQL node id. */
  id: string;
  number: number;
  title: string;
  url: string;
  /** `OPEN`, `CLOSED` or `MERGED`. */
  state: string;
  isDraft: boolean;
  body: string;
  createdAt: string;
  author: string;
  authorAvatarUrl: string | null;
  baseRefName: string;
  baseRefOid: string;
  headRefName: string;
  headRefOid: string;
  reviewDecision: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewThreadCount: number;
  /** The account gh is signed in with. */
  viewerLogin: string | null;
}
