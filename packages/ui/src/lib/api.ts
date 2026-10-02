import type { DiffFile, ParsedDiff } from '@diffity/parser';
import type { CommentThread, CommentAuthor, CommentSide, Comment } from '../components/comments/types';

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiVoid(url: string, init?: RequestInit): Promise<void> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
}

function buildUrl(path: string, params?: Record<string, string | undefined>): string {
  if (!params) {
    return path;
  }
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, value);
    }
  }
  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

export interface GitHubRemote {
  owner: string;
  repo: string;
}

export interface GitHubDetails {
  prNumber: number;
  prTitle: string;
  prUrl: string;
  prCreatedAt: string;
  headSha: string;
  commentCount: number;
}

export interface RepoInfo {
  name: string;
  branch: string;
  root: string;
  description: string;
  capabilities?: { reviews: boolean; revert: boolean; staleness: boolean };
  sessionId?: string | null;
  github?: GitHubRemote | null;
  /** The editor that opens files, `null` without one. */
  editor?: EditorInfo | null;
}

export interface EditorInfo {
  /** A known editor's id, or `custom`. */
  id: string;
  name: string;
}

export interface DetectedEditor extends EditorInfo {
  command: string;
}

export interface Editors {
  /** The known editors installed on the server's PATH. */
  detected: DetectedEditor[];
  active: EditorInfo | null;
}

export function fetchEditors(): Promise<Editors> {
  return apiFetch('/api/editors');
}

export interface Commit {
  hash: string;
  shortHash: string;
  message: string;
  relativeDate: string;
  authorName: string;
  authorEmail: string;
}

export interface CommitsPage {
  commits: Commit[];
  hasMore: boolean;
}

export interface RepoStatus {
  branch: string;
  base: string | null;
  work: number;
  staged: number;
  unstaged: number;
}

export interface RefLookup {
  ref: string;
  commit: Commit | null;
}

/**
 * A diff with the fingerprint of the files it was read from and the changed
 * files `.diffityignore` hides, left out unless they are shown.
 */
export type DiffResponse = ParsedDiff & { fingerprint: string; hiddenFiles: string[] };

export function fetchDiff(hideWhitespace: boolean, ref?: string, showHidden = false): Promise<DiffResponse> {
  return apiFetch(buildUrl('/api/diff', {
    whitespace: hideWhitespace ? 'hide' : undefined,
    ref,
    hidden: showHidden ? '1' : undefined,
  }));
}

/** The hunks of a file `fetchDiff` sent without them (`trimmed`), parsed on their own. */
export async function fetchFilePatch(file: DiffFile, hideWhitespace: boolean, ref?: string, showHidden = false): Promise<DiffFile> {
  const path = file.status === 'deleted' ? file.oldPath : file.newPath;
  const json = await apiFetch<{ file: DiffFile | null }>(buildUrl('/api/diff/file', {
    path,
    oldPath: file.status === 'renamed' && file.oldPath !== path ? file.oldPath : undefined,
    whitespace: hideWhitespace ? 'hide' : undefined,
    ref,
    hidden: showHidden ? '1' : undefined,
  }));
  if (!json.file) {
    return { ...file, trimmed: false };
  }
  return { ...json.file, oldFileLineCount: file.oldFileLineCount };
}

export async function fetchDiffFingerprint(ref?: string, showHidden = false): Promise<string> {
  const json = await apiFetch<{ fingerprint: string }>(buildUrl('/api/diff-fingerprint', {
    ref,
    hidden: showHidden ? '1' : undefined,
  }));
  return json.fingerprint;
}

/** The patterns this repo hides from diffs besides `.diffityignore`. */
export async function fetchDiffIgnoreRules(): Promise<string> {
  const json = await apiFetch<{ rules: string }>('/api/diff-ignore');
  return json.rules;
}

export function saveDiffIgnoreRules(rules: string): Promise<void> {
  return apiVoid('/api/diff-ignore', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules }),
  });
}

/** The global settings, checked by `parseSettings`. */
export function fetchSettings(): Promise<unknown> {
  return apiFetch('/api/settings');
}

/** Saves `patch` and answers with every setting. */
export function saveSettings(patch: Record<string, unknown>): Promise<unknown> {
  return apiFetch('/api/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** The comments and viewed marks stored for the repo, across all its views. */
export interface RepoData {
  name: string;
  root: string;
  threads: number;
  comments: number;
  viewed: number;
}

export function fetchRepoData(): Promise<RepoData> {
  return apiFetch('/api/repo-data');
}

/** Deletes the repo's comments and viewed marks. Tours stay. */
export function clearRepoData(): Promise<RepoData> {
  return apiFetch('/api/repo-data', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

export function fetchRepoInfo(ref?: string): Promise<RepoInfo> {
  return apiFetch(buildUrl('/api/info', { ref }));
}

export function openInEditor(filePath: string, line?: number): Promise<{ ok: boolean }> {
  return apiFetch('/api/open-in-editor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, line }),
  });
}

export function fetchCommits(skip = 0, count = 10, search?: string): Promise<CommitsPage> {
  return apiFetch(buildUrl('/api/commits', { skip: String(skip), count: String(count), search }));
}

export function fetchStatus(): Promise<RepoStatus> {
  return apiFetch('/api/status');
}

/** Another running diffity server, as the registry knows it. */
export interface DiffityInstance {
  port: number;
  name: string;
  root: string;
  branch: string | null;
}

export async function fetchInstances(): Promise<DiffityInstance[]> {
  const json = await apiFetch<{ instances: DiffityInstance[] }>('/api/instances');
  return json.instances;
}

/** Resolves `ref` like the diff does, failing with the server's message when it does not. */
export function fetchRef(ref: string): Promise<RefLookup> {
  return apiFetch(buildUrl('/api/ref', { ref }));
}

export async function fetchSession(): Promise<{ id: string; ref: string; headHash: string } | null> {
  const res = await fetch('/api/sessions/current');
  if (!res.ok) {
    return null;
  }
  return res.json();
}

/** Where a thread stands in the current diff of its view, see `thread-location.ts` in the CLI. */
export type ThreadLocation = 'current' | 'outdated' | 'file_gone' | 'view_empty' | 'unknown';

/** The commit that now holds the code a working tree thread was left on. */
export interface MovedTo {
  sha: string;
  shortSha: string;
  subject: string;
  ref: string;
}

export interface LocatedThread extends CommentThread {
  sessionId: string;
  ref: string;
  /** The branch of a view that belongs to another branch than the checked out one. */
  otherBranch: string | null;
  location: ThreadLocation;
  movedTo: MovedTo | null;
}

/** The threads of `sessionId`, or of every view of the repository, located in their current diffs. */
export function fetchRepoThreads(sessionId?: string): Promise<LocatedThread[]> {
  return apiFetch(buildUrl('/api/repo-threads', { session: sessionId }));
}

export async function fetchThreads(sessionId: string, status?: string): Promise<CommentThread[]> {
  const res = await fetch(buildUrl('/api/threads', { session: sessionId, status }));
  if (!res.ok) {
    return [];
  }
  return res.json();
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function createThread(data: {
  sessionId: string;
  filePath: string;
  side: CommentSide;
  startLine: number;
  endLine: number;
  body: string;
  author: CommentAuthor;
  anchorContent?: string;
}): Promise<CommentThread> {
  return apiFetch('/api/threads', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
}

export function replyToThread(threadId: string, body: string, author: CommentAuthor): Promise<Comment> {
  return apiFetch(`/api/threads/${threadId}/reply`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ body, author }),
  });
}

export function updateThreadStatus(threadId: string, status: string, summary?: string): Promise<void> {
  return apiVoid(`/api/threads/${threadId}/status`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ status, summary }),
  });
}

export function deleteAllThreads(sessionId: string): Promise<void> {
  return apiVoid('/api/threads', {
    method: 'DELETE',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId }),
  });
}

export function deleteThread(threadId: string): Promise<void> {
  return apiVoid(`/api/threads/${threadId}`, { method: 'DELETE', headers: JSON_HEADERS });
}

export function editComment(commentId: string, body: string): Promise<void> {
  return apiVoid(`/api/comments/${commentId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ body }),
  });
}

export function deleteComment(commentId: string): Promise<void> {
  return apiVoid(`/api/comments/${commentId}`, { method: 'DELETE', headers: JSON_HEADERS });
}

export function revertFile(filePath: string, isUntracked: boolean): Promise<void> {
  return apiVoid('/api/revert-file', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ filePath, isUntracked }),
  });
}

export function revertHunk(patch: string): Promise<void> {
  return apiVoid('/api/revert-hunk', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ patch }),
  });
}

export async function fetchFileContent(
  filePath: string,
  ref?: string,
  side?: 'old' | 'new',
): Promise<string[]> {
  const json = await apiFetch<{ content: string[] }>(
    buildUrl(`/api/file/${encodeURIComponent(filePath)}`, { ref, side }),
  );
  return json.content;
}

export interface PushCommentsResult {
  pushed: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface PrCommentPayload {
  filePath: string;
  side: 'LEFT' | 'RIGHT';
  startLine: number | null;
  endLine: number;
  body: string;
}

export async function fetchGitHubDetails(): Promise<GitHubDetails | null> {
  const res = await fetch('/api/github/details');
  if (!res.ok) {
    return null;
  }
  return res.json();
}

export function pushCommentsToGitHub(comments: PrCommentPayload[]): Promise<PushCommentsResult> {
  return apiFetch('/api/github/push-comments', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ comments }),
  });
}

export interface PullCommentsResult {
  pulled: number;
  skipped: number;
}

export function pullCommentsFromGitHub(sessionId: string): Promise<PullCommentsResult> {
  return apiFetch('/api/github/pull-comments', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId }),
  });
}

export interface TourStep {
  id: string;
  tourId: string;
  sortOrder: number;
  filePath: string;
  startLine: number;
  endLine: number;
  body: string;
  annotation: string;
  createdAt: string;
}

export interface Tour {
  id: string;
  sessionId: string;
  topic: string;
  body: string;
  status: string;
  createdAt: string;
  steps: TourStep[];
}

export function fetchTour(tourId: string): Promise<Tour> {
  return apiFetch(`/api/tours/${tourId}`);
}

export interface TreeEntryResponse {
  type: 'blob' | 'tree';
  path: string;
  name: string;
}

export function fetchTreePaths(): Promise<{ paths: string[]; fingerprint: string }> {
  return apiFetch('/api/tree');
}

export function fetchTreeEntries(dirPath?: string): Promise<{ entries: TreeEntryResponse[] }> {
  return apiFetch(buildUrl('/api/tree/entries', { path: dirPath }));
}

export function fetchTreeInfo(): Promise<RepoInfo> {
  return apiFetch('/api/tree/info');
}

export async function fetchTreeFingerprint(): Promise<string> {
  const json = await apiFetch<{ fingerprint: string }>('/api/tree/fingerprint');
  return json.fingerprint;
}

export type WorkingTreeStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';

/** Changed paths of the working tree and index, staged and unstaged combined. */
export async function fetchTreeStatus(): Promise<Record<string, WorkingTreeStatus>> {
  const json = await apiFetch<{ files: Record<string, WorkingTreeStatus> }>('/api/tree/status');
  return json.files;
}

/** Files and folders of the tree that `.diffityignore` hides from diffs. */
export async function fetchTreeHidden(): Promise<string[]> {
  const json = await apiFetch<{ paths: string[] }>('/api/tree/hidden');
  return json.paths;
}

export async function fetchTreeFileContent(filePath: string): Promise<string[]> {
  const json = await apiFetch<{ content: string[] }>(
    `/api/tree/file/${encodeURIComponent(filePath)}`,
  );
  return json.content;
}

/** A file marked viewed in a review session, see `viewed.ts` in the CLI. */
export interface ViewedFile {
  path: string;
  /** The file's blob on the new side when it was marked viewed, `null` when it had none. */
  blob: string | null;
  /** The file's blob on the new side now. */
  current: string | null;
  /** The viewed version was kept, so the changes since can be shown. */
  kept: boolean;
}

export async function fetchViewedFiles(sessionId: string): Promise<ViewedFile[]> {
  const json = await apiFetch<{ files: ViewedFile[] }>(buildUrl('/api/viewed', { session: sessionId }));
  return json.files;
}

/** Marks `paths` viewed as they are now, or unmarks them. Resolves to every viewed file of the session. */
export async function setFilesViewed(sessionId: string, paths: string[], viewed: boolean): Promise<ViewedFile[]> {
  const json = await apiFetch<{ files: ViewedFile[] }>('/api/viewed', {
    method: viewed ? 'POST' : 'DELETE',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId, paths }),
  });
  return json.files;
}

/** What changed in `path` since it was marked viewed, `null` when nothing did. */
export async function fetchViewedChanges(sessionId: string, path: string): Promise<DiffFile | null> {
  const json = await apiFetch<{ file: DiffFile | null }>(buildUrl('/api/viewed/changes', { session: sessionId, path }));
  return json.file;
}
