import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { parseDiff, type ParsedDiff } from '@diffity/parser';
import {
  getDiffFingerprint,
  getFilteredDiff,
  getRefDiff,
  getRepoInfo,
  getFileContent,
  getIndexFileContent,
  getBaseFileContent,
  getRecentCommits,
  getFileLineCounts,
  resolveBaseRef,
  resolveHeadRef,
  resolveDiffArgs,
  revertFile,
  revertHunk,
  getRefCapabilities,
  getHeadHash,
  isDirty,
  getTree,
  getTreeEntries,
  getTreeFingerprint,
  getWorkingTreeFileContent,
  getWorkingTreeRawFile,
  WORKING_TREE_REFS,
  InputError,
  type BaseSource,
  type DiffOptions,
} from '@diffity/git';
import {
  detectRemote as detectGitHubRemote,
  fetchDetails as fetchGitHubDetails,
  pushComments as pushGitHubComments,
  pullComments as pullGitHubComments,
  type PrComment,
} from '@diffity/github';
import { findOrCreateSession, setCurrentSession, TREE_REF } from './session.js';
import { createThread, addReply, getThreadsForSession } from './threads.js';
import { transaction } from './db.js';
import { handleReviewRoute } from './review-routes.js';
import { handleTourRoute } from './tour-routes.js';
import { handleRefRoute } from './ref-routes.js';
import { handleRepoThreadRoute } from './repo-thread-routes.js';
import { handleTreeStatusRoute } from './tree-status-routes.js';
import { handleDiffIgnoreRoute } from './diff-ignore-routes.js';
import { handleDiffFileRoute, LARGE_FILE_PATCH_LENGTH } from './diff-file-routes.js';
import { handleViewedRoute } from './viewed-routes.js';
import { handleSettingsRoute } from './settings-routes.js';
import { editorCapability, handleEditorRoute } from './editor-routes.js';
import { sendJson, sendError, readBody } from './http-utils.js';
import {
  registerInstance,
  deregisterInstance
} from './registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

export function getHost(): string {
  return process.env.DIFFITY_HOST?.trim() || 'localhost';
}

interface ServerOptions {
  port: number;
  portIsExplicit?: boolean;
  diffArgs: string[];
  description?: string;
  effectiveRef?: string;
  version?: string;
  registryInfo?: {
    repoRoot: string;
    repoHash: string;
    repoName: string;
  };
}

function serveStatic(res: ServerResponse, filePath: string) {
  if (!existsSync(filePath)) {
    sendError(res, 404, 'Not found');
    return;
  }
  const ext = extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const content = readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': mime });
  res.end(content);
}

/** Reads a file as it exists on the new side of the diff for `ref`. */
function readHeadSide(filePath: string, ref: string | undefined): string {
  const head = resolveHeadRef(ref || 'work');
  if (head.type === 'worktree') {
    return getWorkingTreeFileContent(filePath);
  }
  if (head.type === 'index') {
    return getIndexFileContent(filePath);
  }
  return getFileContent(filePath, head.ref);
}

/** Answers a failed file read with 400 for a rejected path and 404 otherwise. */
function sendFileError(res: ServerResponse, err: unknown, filePath: string) {
  if (err instanceof InputError && err.code === 'invalid') {
    sendError(res, 400, err.message);
    return;
  }
  sendError(res, 404, `File not found: ${filePath}`);
}

function decodePathParam(pathname: string, prefix: string): string {
  try {
    return decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    throw new InputError('Malformed path');
  }
}

/** `?hidden=1` shows the files `.diffityignore` hides. */
function diffOptionsFrom(url: URL): DiffOptions {
  return { showHidden: url.searchParams.get('hidden') === '1' };
}

function descriptionForRef(ref: string): string {
  if (WORKING_TREE_REFS.has(ref)) {
    const labels: Record<string, string> = {
      staged: 'Staged changes',
      unstaged: 'Unstaged changes',
      work: 'All changes',
      '.': 'All changes',
    };
    return labels[ref] || ref;
  }
  if (ref.includes('..')) {
    return ref;
  }
  return `Changes from ${ref}`;
}

interface ServerResult {
  port: number;
  close: () => void;
}

export function startServer(options: ServerOptions): Promise<ServerResult> {
  const {
    port,
    portIsExplicit,
    diffArgs,
    description,
    effectiveRef,
    version,
    registryInfo,
  } = options;

  const includeUntracked = diffArgs.length === 0;

  function enrichWithLineCounts(diff: ParsedDiff, base: BaseSource): ParsedDiff {
    const files = diff.files.filter((file) => file.status !== 'added' && !file.isBinary);
    const counts = getFileLineCounts(files.map((file) => file.oldPath || file.newPath), base);
    files.forEach((file, i) => {
      const count = counts[i];
      if (count !== null) {
        file.oldFileLineCount = count;
      }
    });
    return diff;
  }

  /** The fingerprint of the diff `/api/diff` returns for `ref`, read before the diff itself. */
  function fingerprintFor(ref: string | null, options: DiffOptions): string {
    return getDiffFingerprint(ref || diffArgs[0] || 'work', options);
  }

  const githubRemote = detectGitHubRemote();
  const uiDir = join(__dirname, 'ui/client');

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url || '/', `http://${getHost()}:${port}`);
        const pathname = url.pathname;

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader(
          'Access-Control-Allow-Methods',
          'GET, POST, PATCH, DELETE, OPTIONS',
        );
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        if (pathname === '/api/revert-file' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req));
            const { filePath: path } = body;
            if (!path || typeof path !== 'string') {
              sendError(res, 400, 'Missing filePath');
              return;
            }
            revertFile(path);
            sendJson(res, { ok: true });
          } catch (err) {
            if (err instanceof InputError) {
              sendError(res, 400, err.message);
              return;
            }
            sendError(res, 500, `Failed to revert file: ${err}`);
          }
          return;
        }

        if (pathname === '/api/revert-hunk' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req));
            const { patch } = body;
            if (!patch || typeof patch !== 'string') {
              sendError(res, 400, 'Missing patch');
              return;
            }
            revertHunk(patch);
            sendJson(res, { ok: true });
          } catch (err) {
            sendError(res, 500, `Failed to revert hunk: ${err}`);
          }
          return;
        }

        if (pathname === '/api/commits') {
          const count = parseInt(url.searchParams.get('count') || '10', 10);
          const skip = parseInt(url.searchParams.get('skip') || '0', 10);
          const search = url.searchParams.get('search') || undefined;
          try {
            const commits = getRecentCommits({ count, skip, search });
            sendJson(res, { commits, hasMore: commits.length === count });
          } catch (err) {
            sendError(res, 500, `Failed to get commits: ${err}`);
          }
          return;
        }

        if (pathname === '/api/diff-fingerprint') {
          sendJson(res, { fingerprint: fingerprintFor(url.searchParams.get('ref'), diffOptionsFrom(url)) });
          return;
        }

        if (pathname === '/api/diff/ref') {
          const ref = url.searchParams.get('ref');
          const resolved = ref ? resolveDiffArgs(ref) : null;

          if (resolved) {
            sendJson(res, { args: resolved.args.join(' ') });
          } else {
            const args = diffArgs.length > 0 ? diffArgs : ['HEAD'];
            sendJson(res, { args: args.join(' ') });
          }
          return;
        }

        if (pathname === '/api/diff') {
          const ref = url.searchParams.get('ref');
          const diffOptions = diffOptionsFrom(url);
          const fingerprint = fingerprintFor(ref, diffOptions);
          const whitespace = url.searchParams.get('whitespace');
          const extraArgs = whitespace === 'hide' ? ['-w'] : [];
          const base = resolveBaseRef(ref || 'work');
          const { patch, hiddenFiles } = ref
            ? getRefDiff(ref, extraArgs, diffOptions)
            : getFilteredDiff([...diffArgs, ...extraArgs], includeUntracked, diffOptions);
          sendJson(res, {
            ...enrichWithLineCounts(parseDiff(patch, { maxFilePatchLength: LARGE_FILE_PATCH_LENGTH }), base),
            fingerprint,
            hiddenFiles,
          });
          return;
        }

        if (pathname.startsWith('/api/file/')) {
          const filePath = decodePathParam(pathname, '/api/file/');
          const ref = url.searchParams.get('ref') || undefined;
          const side = url.searchParams.get('side') === 'new' ? 'new' : 'old';
          try {
            const content =
              side === 'new'
                ? readHeadSide(filePath, ref)
                : getBaseFileContent(filePath, resolveBaseRef(ref || 'work'));
            sendJson(res, { path: filePath, content: content.split('\n') });
          } catch (err) {
            sendFileError(res, err, filePath);
          }
          return;
        }

        if (pathname === '/api/info') {
          const ref = url.searchParams.get('ref') || effectiveRef;
          const info = getRepoInfo();
          let refDescription =
            description || diffArgs.join(' ') || 'Unstaged changes';
          if (url.searchParams.get('ref')) {
            refDescription = descriptionForRef(url.searchParams.get('ref')!);
          }
          const capabilities = getRefCapabilities(ref);
          let sessionId: string | null = null;
          if (ref) {
            const session = findOrCreateSession(ref);
            setCurrentSession(session);
            sessionId = session.id;
          }
          sendJson(res, {
            ...info,
            description: refDescription,
            capabilities,
            sessionId,
            github: githubRemote,
            editor: editorCapability(),
          });
          return;
        }

        if (pathname === '/api/github/details') {
          if (!githubRemote) {
            sendJson(res, null);
            return;
          }
          const details = fetchGitHubDetails(githubRemote.owner, githubRemote.repo);
          sendJson(res, details);
          return;
        }

        if (pathname === '/api/github/push-comments' && req.method === 'POST') {
          const details = githubRemote ? fetchGitHubDetails(githubRemote.owner, githubRemote.repo) : null;
          if (!githubRemote || !details?.headSha) {
            sendError(res, 400, 'No GitHub PR detected');
            return;
          }
          const localHead = getHeadHash();
          if (localHead !== details.headSha) {
            sendError(res, 409, 'Local branch is out of sync with the PR. Push or pull your git changes first.');
            return;
          }
          if (isDirty()) {
            sendError(res, 409, 'You have uncommitted local changes. Commit or stash them first.');
            return;
          }
          const body = JSON.parse(await readBody(req));
          const comments = body.comments as PrComment[];
          if (!Array.isArray(comments) || comments.length === 0) {
            sendError(res, 400, 'No comments provided');
            return;
          }
          const result = pushGitHubComments(
            githubRemote.owner,
            githubRemote.repo,
            details.prNumber,
            details.headSha,
            comments,
          );
          sendJson(res, result);
          return;
        }

        if (pathname === '/api/github/pull-comments' && req.method === 'POST') {
          if (!githubRemote) {
            sendError(res, 400, 'No GitHub repo detected');
            return;
          }
          const details = fetchGitHubDetails(githubRemote.owner, githubRemote.repo);
          if (!details) {
            sendError(res, 400, 'No GitHub PR detected');
            return;
          }
          const body = JSON.parse(await readBody(req));
          const { sessionId: sid } = body;
          if (!sid) {
            sendError(res, 400, 'Missing sessionId');
            return;
          }

          const localHead = getHeadHash();
          if (localHead !== details.headSha) {
            sendError(res, 409, 'Local branch is out of sync with the PR. Push or pull your git changes first.');
            return;
          }
          if (isDirty()) {
            sendError(res, 409, 'You have uncommitted local changes. Commit or stash them first.');
            return;
          }

          const remoteThreads = pullGitHubComments(githubRemote.owner, githubRemote.repo, details.prNumber);
          const localThreads = getThreadsForSession(sid);

          let pulled = 0;
          let skipped = 0;
          transaction(() => {
            for (const rt of remoteThreads) {
              const firstComment = rt.comments[0];
              const alreadyExists = localThreads.some(t =>
                t.filePath === rt.filePath &&
                t.side === rt.side &&
                t.startLine === rt.startLine &&
                t.endLine === rt.endLine &&
                t.comments.some(c => c.body === firstComment.body),
              );
              if (alreadyExists) {
                skipped++;
                continue;
              }
              const thread = createThread(sid, rt.filePath, rt.side, rt.startLine, rt.endLine, firstComment.body, {
                name: firstComment.authorName,
                type: firstComment.authorType,
              });
              for (let i = 1; i < rt.comments.length; i++) {
                const reply = rt.comments[i];
                addReply(thread.id, reply.body, {
                  name: reply.authorName,
                  type: reply.authorType,
                });
              }
              pulled++;
            }
          });
          sendJson(res, { pulled, skipped });
          return;
        }

        if (pathname === '/api/tree/fingerprint') {
          sendJson(res, { fingerprint: getTreeFingerprint() });
          return;
        }

        if (pathname === '/api/tree') {
          try {
            const fingerprint = getTreeFingerprint();
            const paths = getTree();
            sendJson(res, { paths, fingerprint });
          } catch (err) {
            sendError(res, 500, `Failed to get tree: ${err}`);
          }
          return;
        }

        if (pathname === '/api/tree/entries') {
          try {
            const dirPath = url.searchParams.get('path') || undefined;
            const entries = getTreeEntries('HEAD', dirPath);
            sendJson(res, { entries });
          } catch (err) {
            if (err instanceof InputError) {
              sendError(res, 400, err.message);
              return;
            }
            sendError(res, 500, `Failed to get tree entries: ${err}`);
          }
          return;
        }

        if (pathname.startsWith('/api/tree/file/')) {
          const filePath = decodePathParam(pathname, '/api/tree/file/');
          try {
            const content = getWorkingTreeFileContent(filePath);
            sendJson(res, { path: filePath, content: content.split('\n') });
          } catch (err) {
            sendFileError(res, err, filePath);
          }
          return;
        }

        if (pathname.startsWith('/api/tree/raw/')) {
          const filePath = decodePathParam(pathname, '/api/tree/raw/');
          try {
            const { data } = getWorkingTreeRawFile(filePath);
            const ext = extname(filePath);
            const mime = MIME_TYPES[ext] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': mime });
            res.end(data);
          } catch (err) {
            sendFileError(res, err, filePath);
          }
          return;
        }

        if (pathname === '/api/tree/info') {
          const info = getRepoInfo();
          const session = findOrCreateSession(TREE_REF);
          setCurrentSession(session);
          sendJson(res, {
            ...info,
            description: 'Repository file browser',
            capabilities: { reviews: true, revert: false, staleness: false },
            sessionId: session.id,
            github: githubRemote,
            editor: editorCapability(),
          });
          return;
        }

        if (handleReviewRoute(req, res, pathname, url)) {
          return;
        }

        if (handleTourRoute(req, res, pathname, url)) {
          return;
        }

        if (handleRefRoute(req, res, pathname, url)) {
          return;
        }

        if (handleRepoThreadRoute(req, res, pathname, url)) {
          return;
        }

        if (handleTreeStatusRoute(req, res, pathname)) {
          return;
        }

        if (handleDiffIgnoreRoute(req, res, pathname)) {
          return;
        }

        if (handleDiffFileRoute(req, res, pathname, url)) {
          return;
        }

        if (await handleViewedRoute(req, res, pathname, url)) {
          return;
        }

        if (await handleSettingsRoute(req, res, pathname)) {
          return;
        }

        if (await handleEditorRoute(req, res, pathname)) {
          return;
        }

        let filePath = join(uiDir, pathname === '/' ? 'index.html' : pathname);
        if (!existsSync(filePath)) {
          filePath = join(uiDir, 'index.html');
        }
        serveStatic(res, filePath);
      } catch (err) {
        if (!res.headersSent) {
          if (err instanceof InputError) {
            sendError(res, err.code === 'not_found' ? 404 : 400, err.message);
            return;
          }
          sendError(res, 500, `${err instanceof Error ? err.message : err}`);
        }
      }
    },
  );

  const closeFn = () => {
    deregisterInstance(process.pid);
    server.close();
  };

  return new Promise((resolve, reject) => {
    let currentPort = port;
    let retries = 0;
    const maxRetries = portIsExplicit ? 0 : 10;

    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && retries < maxRetries) {
        retries++;
        server.close();
        currentPort++;
        setTimeout(() => server.listen(currentPort), 200);
      } else if (err.code === 'EADDRINUSE' && portIsExplicit) {
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(err);
      }
    };

    server.on('error', onError);
    server.on('listening', () => {
      const addr = server.address();
      if (addr && typeof addr !== 'string') {
        if (effectiveRef) {
          setCurrentSession(findOrCreateSession(effectiveRef));
        }
        if (registryInfo) {
          registerInstance({
            pid: process.pid,
            port: addr.port,
            repoRoot: registryInfo.repoRoot,
            repoHash: registryInfo.repoHash,
            repoName: registryInfo.repoName,
            ref: effectiveRef || 'work',
            description: description || 'Unstaged changes',
            startedAt: new Date().toISOString(),
            version,
          });
        }
        resolve({ port: addr.port, close: closeFn });
      }
    });

    server.listen(currentPort);
  });
}
