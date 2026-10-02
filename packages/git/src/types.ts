export interface Commit {
  hash: string;
  shortHash: string;
  message: string;
  relativeDate: string;
  authorName: string;
  authorEmail: string;
}

export interface RepoInfo {
  name: string;
  branch: string;
  root: string;
}
