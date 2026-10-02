import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createServer as createNetServer, type AddressInfo, type Server as NetServer } from 'node:net';
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
import { detectRemote as detectGitHubRemote } from '@diffity/github';
import { findOrCreateSession, setCurrentSession, TREE_REF } from './session.js';
import { handleReviewRoute } from './review-routes.js';
import { handleGitHubRoute } from './github-routes.js';
import { handleTourRoute } from './tour-routes.js';
import { handleRefRoute } from './ref-routes.js';
import { handleRepoThreadRoute } from './repo-thread-routes.js';
import { handleTreeStatusRoute } from './tree-status-routes.js';
import { handleDiffIgnoreRoute } from './diff-ignore-routes.js';
import { handleDiffFileRoute, LARGE_FILE_PATCH_LENGTH } from './diff-file-routes.js';
import { handleViewedRoute } from './viewed-routes.js';
import { handleSettingsRoute } from './settings-routes.js';
import { editorCapability, handleEditorRoute } from './editor-routes.js';
import { handleInstanceRoute } from './instance-routes.js';
import { handleAgentRequestRoute } from './agent-request-routes.js';
import { sendJson, sendError, readBody } from './http-utils.js';
import { rejectRequest } from './request-guard.js';
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

const TEXT = 'text/plain; charset=utf-8';

/** Types of the repo files `/api/tree/raw/` serves for previews. Markup and scripts read as text. */
const RAW_TYPES: Record<string, string> = { ...MIME_TYPES, '.html': TEXT, '.js': TEXT, '.css': TEXT, '.json': TEXT };

/**
 * A repo file runs nothing on the server's origin, which the request guard
 * trusts. Images, SVG styles and PDFs still show, inline or opened on their own.
 */
const RAW_POLICY = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";

export function getHost(): string {
  return process.env.DIFFITY_HOST?.trim() || 'localhost';
}

const LOOPBACK_ADDRESSES = ['127.0.0.1', '::1'];
const MAX_PORT_RETRIES = 10;

/** The addresses the server listens on, the loopback ones unless `DIFFITY_BIND` names another. */
export function getBindAddresses(): string[] {
  const bind = process.env.DIFFITY_BIND?.trim().replace(/^\[(.*)\]$/, '$1');
  return bind && bind !== 'localhost' ? [bind] : LOOPBACK_ADDRESSES;
}

/** The `DIFFITY_BIND` address when it lets other machines connect, else `null`. */
export function getExposedBindAddress(): string | null {
  const [address] = getBindAddresses();
  return address === '::1' || address.startsWith('127.') ? null : address;
}

/** Listens on `host`, resolving with the port or rejecting with the listen error. */
function listen(server: NetServer, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve((server.address() as AddressInfo).port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
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

let loggingRejections = false;

/** Logs a rejection that no handler caught and keeps serving, instead of letting it end the process. */
function logUnhandledRejections() {
  if (loggingRejections) {
    return;
  }
  loggingRejections = true;
  process.on('unhandledRejection', (reason) => {
    console.error('diffity: unhandled rejection', reason);
  });
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
  logUnhandledRejections();

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

        const rejection = rejectRequest(req, pathname, getHost());
        if (rejection) {
          sendError(res, rejection.status, rejection.message);
          return;
        }

        if (pathname === '/api/revert-file' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req));
            const { filePath: path, oldPath } = body;
            if (!path || typeof path !== 'string') {
              sendError(res, 400, 'Missing filePath');
              return;
            }
            if (oldPath != null && typeof oldPath !== 'string') {
              sendError(res, 400, 'Invalid oldPath');
              return;
            }
            revertFile(path, oldPath || undefined);
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

        if (await handleGitHubRoute(req, res, pathname, githubRemote)) {
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
            res.writeHead(200, {
              'Content-Type': RAW_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
              'Content-Security-Policy': RAW_POLICY,
              'X-Content-Type-Options': 'nosniff',
            });
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

        if (handleInstanceRoute(req, res, pathname)) {
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

        if (await handleAgentRequestRoute(req, res, pathname)) {
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

  const extraServers: NetServer[] = [];

  const closeFn = () => {
    deregisterInstance(process.pid);
    server.close();
    extraServers.forEach((extra) => extra.close());
  };

  /**
   * Listens on the first address and on the others with the same port, which
   * fails like a taken port when one of them has it. An address the machine
   * lacks, like `::1` without IPv6, is skipped.
   */
  async function listenAll(candidate: number): Promise<number> {
    const [host, ...otherHosts] = getBindAddresses();
    const actualPort = await listen(server, candidate, host);
    for (const otherHost of otherHosts) {
      const extra = createNetServer((socket) => server.emit('connection', socket));
      try {
        await listen(extra, actualPort, otherHost);
        extraServers.push(extra);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
          throw err;
        }
      }
    }
    return actualPort;
  }

  return (async () => {
    for (let retries = 0; ; retries++) {
      try {
        const actualPort = await listenAll(port === 0 ? 0 : port + retries);
        if (effectiveRef) {
          setCurrentSession(findOrCreateSession(effectiveRef));
        }
        if (registryInfo) {
          registerInstance({
            pid: process.pid,
            port: actualPort,
            repoRoot: registryInfo.repoRoot,
            repoHash: registryInfo.repoHash,
            repoName: registryInfo.repoName,
            ref: effectiveRef || 'work',
            description: description || 'Unstaged changes',
            startedAt: new Date().toISOString(),
            version,
          });
        }
        return { port: actualPort, close: closeFn };
      } catch (err) {
        server.close();
        extraServers.splice(0).forEach((extra) => extra.close());
        if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
          throw err;
        }
        if (portIsExplicit) {
          throw new Error(`Port ${port} is already in use`);
        }
        if (retries >= MAX_PORT_RETRIES) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  })();
}
