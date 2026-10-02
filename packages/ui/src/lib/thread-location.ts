import type { ParsedDiff } from '@diffity/parser';
import { GENERAL_THREAD_FILE_PATH, type CommentThread, type ThreadStatus } from '../components/comments/types';
import type { LocatedThread, ThreadLocation } from './api';
import { getFilePath } from './diff-utils';
import { refLabel } from './refs';

/** Threads the diff has no place for: on files that left it, or all of them once it has no changes left. */
export function getOutsideThreads(threads: CommentThread[], diff: ParsedDiff): CommentThread[] {
  if (diff.files.length === 0) {
    return threads;
  }
  const paths = new Set(diff.files.map((file) => getFilePath(file)));
  return threads.filter((thread) => thread.filePath !== GENERAL_THREAD_FILE_PATH && !paths.has(thread.filePath));
}

export function threadLineLabel(thread: CommentThread): string {
  if (thread.filePath === GENERAL_THREAD_FILE_PATH) {
    return 'General';
  }
  if (thread.startLine === 0) {
    return 'File';
  }
  return thread.startLine === thread.endLine
    ? `Line ${thread.startLine}`
    : `Lines ${thread.startLine}–${thread.endLine}`;
}

export const TREE_REF = '__tree__';

const PATH_THREAD_PREFIX = '__path__:';

export type StatusFilter = 'all' | ThreadStatus;
export type AuthorFilter = 'all' | 'user' | 'agent';

export interface ThreadFilters {
  status: StatusFilter;
  author: AuthorFilter;
}

/** Who started the thread. */
export function threadAuthor(thread: CommentThread): 'user' | 'agent' {
  return thread.comments[0]?.author.type ?? 'user';
}

export function matchesFilters(thread: CommentThread, filters: ThreadFilters): boolean {
  return (filters.status === 'all' || thread.status === filters.status)
    && (filters.author === 'all' || threadAuthor(thread) === filters.author);
}

/**
 * The threads of the view on screen with the locations the server found.
 * A thread it has not located yet counts as current, or as outside the diff
 * when the page lists it there.
 */
export function locateViewThreads(
  threads: CommentThread[],
  locations: Map<string, LocatedThread>,
  outside: CommentThread[],
  view: { sessionId: string; ref: string; empty: boolean },
): LocatedThread[] {
  const outsideIds = new Set(outside.map((thread) => thread.id));
  return threads.map((thread) => {
    const located = locations.get(thread.id);
    const fallback: ThreadLocation = !outsideIds.has(thread.id) ? 'current' : view.empty ? 'view_empty' : 'file_gone';
    return {
      ...thread,
      sessionId: view.sessionId,
      ref: view.ref,
      otherBranch: null,
      location: located?.location ?? fallback,
      movedTo: located?.movedTo ?? null,
    };
  });
}

export interface FileThreads {
  path: string;
  threads: LocatedThread[];
}

export interface ViewGroup {
  sessionId: string;
  ref: string;
  otherBranch: string | null;
  /** The view on screen. */
  current: boolean;
  latest: string;
  count: number;
  /** Threads the diff of the view shows where they were left. */
  located: FileThreads[];
  /** Threads whose code changed or left the view. */
  outdated: FileThreads[];
}

function byFile(threads: LocatedThread[]): FileThreads[] {
  const files = new Map<string, LocatedThread[]>();
  for (const thread of threads) {
    files.set(thread.filePath, [...(files.get(thread.filePath) ?? []), thread]);
  }
  return [...files.entries()]
    .sort(([a], [b]) => {
      if (a === GENERAL_THREAD_FILE_PATH || b === GENERAL_THREAD_FILE_PATH) {
        return a === b ? 0 : a === GENERAL_THREAD_FILE_PATH ? -1 : 1;
      }
      return a.localeCompare(b);
    })
    .map(([path, list]) => ({ path, threads: list.sort((x, y) => x.startLine - y.startLine || x.endLine - y.endLine) }));
}

/** Groups threads by view, the one on screen first and then the most recently active, and within a view by file. */
export function groupThreads(threads: LocatedThread[], currentSessionId: string | null): ViewGroup[] {
  const sessions = new Map<string, LocatedThread[]>();
  for (const thread of threads) {
    sessions.set(thread.sessionId, [...(sessions.get(thread.sessionId) ?? []), thread]);
  }
  const groups = [...sessions.entries()].map(([sessionId, list]): ViewGroup => ({
    sessionId,
    ref: list[0].ref,
    otherBranch: list[0].otherBranch,
    current: sessionId === currentSessionId,
    latest: list.reduce((latest, thread) => (thread.updatedAt ?? '') > latest ? thread.updatedAt ?? '' : latest, ''),
    count: list.length,
    located: byFile(list.filter((thread) => thread.location === 'current')),
    outdated: byFile(list.filter((thread) => thread.location !== 'current')),
  }));
  return groups.sort((a, b) => Number(b.current) - Number(a.current) || b.latest.localeCompare(a.latest));
}

/** The file browser page of a file browser thread: its file, else the root. */
export function treePagePath(thread?: Pick<CommentThread, 'filePath'>): string {
  const path = thread?.filePath;
  if (!path || path === GENERAL_THREAD_FILE_PATH || path.startsWith(PATH_THREAD_PREFIX)) {
    return '/tree';
  }
  return `/tree?${new URLSearchParams({ path, type: 'file' })}`;
}

export function fileLabel(filePath: string): string {
  if (filePath === GENERAL_THREAD_FILE_PATH) {
    return 'General comments';
  }
  if (!filePath.startsWith(PATH_THREAD_PREFIX)) {
    return filePath;
  }
  const path = filePath.slice(PATH_THREAD_PREFIX.length);
  return path === '__root__' ? 'Repository' : path;
}

/** Why a thread is not where it was left, `null` when it is. */
export function locationNote(thread: LocatedThread): string | null {
  switch (thread.location) {
    case 'current':
      return null;
    case 'outdated':
      return 'Code changed';
    case 'file_gone':
      return 'File no longer in the diff';
    case 'view_empty':
      return 'No changes left in the view';
    case 'unknown':
      return thread.otherBranch ? `View of branch ${thread.otherBranch}` : 'View no longer available';
  }
}

/** The name of a view, with the branch it belongs to when that is not the checked out one. */
export function viewLabel(ref: string, branch: string | null, base: string | null, otherBranch: string | null = null): string {
  if (ref === TREE_REF) {
    return 'Files';
  }
  const { kind, label } = refLabel(ref, otherBranch ?? branch, base);
  return otherBranch && kind !== 'branch' ? `${label} on ${otherBranch}` : label;
}
