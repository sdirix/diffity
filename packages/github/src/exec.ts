import { execFileSync } from 'node:child_process';
import { GitHubError } from './errors.js';
import { parseGraphqlResponse } from './graphql.js';

/** Runs the GitHub CLI with an argument vector, never through a shell. */
export function gh(args: string[], input?: string): string {
  return execFileSync('gh', args, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    input,
    maxBuffer: 50 * 1024 * 1024,
  });
}

export function ghSucceeds(args: string[]): boolean {
  try {
    gh(args);
    return true;
  } catch {
    return false;
  }
}

/** The message gh printed for a failed command. */
export function ghErrorMessage(err: unknown): string {
  const stderr = (err as { stderr?: string }).stderr?.trim();
  if (stderr) {
    const lines = stderr.split('\n').map((line) => line.trim()).filter(Boolean);
    return (lines.find((line) => line.startsWith('gh:')) ?? lines[lines.length - 1]).replace(/^gh:\s*/, '');
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Runs a GraphQL query or mutation through `gh api graphql`, so gh supplies the
 * token. gh exits non-zero on GraphQL errors and still prints the response.
 */
export function graphql<T>(query: string, variables: Record<string, unknown>): T {
  let out: string;
  try {
    out = gh(['api', 'graphql', '--input', '-'], JSON.stringify({ query, variables }));
  } catch (err) {
    const stdout = (err as { stdout?: string }).stdout?.trim();
    if (stdout?.startsWith('{')) {
      return parseGraphqlResponse<T>(stdout);
    }
    throw new GitHubError(ghErrorMessage(err));
  }
  return parseGraphqlResponse<T>(out);
}
