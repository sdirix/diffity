import type { IncomingMessage, ServerResponse } from 'node:http';
import { spawnSync } from 'node:child_process';
import { readRegistry } from './registry.js';
import { sendJson } from './http-utils.js';

/** The checked out branch of `root` like `getCurrentBranch`, `null` when git fails there. */
function branchOf(root: string): string | null {
  const result = spawnSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.status === 0) {
    return result.stdout.trim();
  }
  return result.status === 1 ? 'HEAD' : null;
}

/** The other running instances, for the repo switcher. The registry drops the ones whose process is gone. */
export function handleInstanceRoute(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  if (pathname === '/api/instances' && req.method === 'GET') {
    const instances = readRegistry()
      .filter((entry) => entry.pid !== process.pid)
      .map((entry) => ({
        port: entry.port,
        name: entry.repoName,
        root: entry.repoRoot,
        branch: branchOf(entry.repoRoot),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.port - b.port);
    sendJson(res, { instances });
    return true;
  }

  return false;
}
