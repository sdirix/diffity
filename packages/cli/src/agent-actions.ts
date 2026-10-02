import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parseDiff } from '@diffity/parser';
import {
  getRefDiff,
  getRepoRoot,
  getWorkingTreeFileContent,
  isGitRepo,
  isValidGitRef,
  resolveRef,
  WORKING_TREE_REFS,
  type FilteredDiff,
} from '@diffity/git';
import {
  AgentError,
  CLI_OPTIONS,
  CommentTargetError,
  resolveDiffTarget,
  resolveTreeTarget,
  withSeverity,
  type CommentTarget,
  type OptionNames,
  type Severity,
  type Side,
} from './agent-comment.js';
import { findOrCreateSession, getCurrentSession, getSessionById, TREE_REF, type Session } from './session.js';
import { createThread, updateThreadStatus, type Thread, type ThreadAuthor } from './threads.js';
import { GENERAL_THREAD_PATH } from './thread-location.js';

export const AGENT_AUTHOR: ThreadAuthor = { name: 'Agent', type: 'agent' };

export interface SessionOptions {
  ref?: string;
}

export interface AgentComment {
  path: string;
  side: Side;
  startLine: number;
  endLine: number;
  body: string;
  severity?: Severity;
}

export function assertRepo(): void {
  if (!isGitRepo()) {
    throw new AgentError('Not a git repository');
  }
}

/** The session named by `ref`, else by `DIFFITY_SESSION_ID`, else the one of the view opened last. */
export function resolveSession(opts: SessionOptions): Session {
  assertRepo();

  if (opts.ref !== undefined) {
    const ref = opts.ref === '.' ? 'work' : opts.ref;
    if (ref !== TREE_REF && !WORKING_TREE_REFS.has(ref) && !isValidGitRef(ref)) {
      throw new AgentError(`'${ref}' is not a valid git reference.`);
    }
    return findOrCreateSession(ref);
  }

  const envId = process.env.DIFFITY_SESSION_ID?.trim();
  if (envId) {
    const session = getSessionById(envId);
    if (!session) {
      throw new AgentError(`No session with id ${envId} (from DIFFITY_SESSION_ID).`);
    }
    return session;
  }

  const session = getCurrentSession();
  if (!session) {
    throw new AgentError('No active review session.', ['Start diffity first to create a session, or pass --ref <ref>.']);
  }
  return session;
}

export function assertRepoFile(path: string, names: OptionNames = CLI_OPTIONS): void {
  if (isAbsolute(path)) {
    throw new CommentTargetError(`${names.file} must be relative to the repo root, got absolute path: ${path}`, [], 'file');
  }
  const abs = join(getRepoRoot(), path);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    throw new CommentTargetError(`File not found at repo root: ${path}`, [`  Checked: ${abs}`], 'file');
  }
}

/** Where `comment` goes in the view of `session`, checked against its diff, or the file for the file browser. */
function placeComment(session: Session, comment: AgentComment, names: OptionNames): CommentTarget {
  const { startLine, endLine } = comment;
  if (startLine === 0 && endLine !== 0) {
    throw new AgentError(`A comment on the whole file (${names.line} 0) takes no ${names.endLine}`);
  }
  if (endLine < startLine) {
    throw new AgentError(`${names.endLine} ${endLine} is before ${names.line} ${startLine}`);
  }

  const request = { path: comment.path.replace(/^\.\//, ''), side: comment.side, startLine, endLine };
  if (session.ref === TREE_REF) {
    assertRepoFile(request.path, names);
    if (request.side === 'old') {
      throw new AgentError(`The file browser has no old side, use ${names.side} new`);
    }
    return resolveTreeTarget(getWorkingTreeFileContent(request.path), request, names);
  }
  try {
    return resolveDiffTarget(parseDiff(resolveRef(session.ref, [], { showHidden: true })), session.ref, request, names);
  } catch (err) {
    // A path that is not on disk either is more likely mistyped than missing from the diff.
    if (err instanceof CommentTargetError && err.kind === 'file' && !existsSync(join(getRepoRoot(), request.path))) {
      assertRepoFile(request.path, names);
    }
    throw err;
  }
}

/** Creates the agent's comment in `session`. Throws an `AgentError` when it cannot be placed. */
export function addAgentComment(session: Session, comment: AgentComment, names: OptionNames = CLI_OPTIONS): Thread {
  const body = withSeverity(comment.body, comment.severity, names);
  const target = placeComment(session, comment, names);
  return createThread(
    session.id,
    target.filePath,
    target.side,
    target.startLine,
    target.endLine,
    body,
    AGENT_AUTHOR,
    target.anchorContent,
  );
}

export function addGeneralComment(session: Session, body: string): Thread {
  return createThread(session.id, GENERAL_THREAD_PATH, 'new', 0, 0, body, AGENT_AUTHOR);
}

/** Sets the status of `thread`, with `note` as the agent's last comment when given. */
export function closeThread(thread: Thread, status: 'resolved' | 'dismissed', note?: string): void {
  updateThreadStatus(thread.id, status, note, note ? AGENT_AUTHOR : undefined);
}

/** The diff of `session` and the ref it is of, the working tree for the file browser. */
export function getSessionDiff(session: Session): FilteredDiff & { ref: string } {
  const ref = session.ref === TREE_REF ? 'work' : session.ref;
  return { ref, ...getRefDiff(ref) };
}
