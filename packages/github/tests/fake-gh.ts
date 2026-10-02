import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface CannedResponse {
  stdout?: string;
  stderr?: string;
  code?: number;
}

export interface GhCall {
  args: string[];
  input: string;
}

export interface FakeGh {
  calls: () => GhCall[];
  /** The parsed request body of each `gh api graphql` call. */
  graphqlCalls: () => { query: string; variables: Record<string, unknown> }[];
  restore: () => void;
}

const SCRIPT = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const input = fs.readFileSync(0, 'utf8');
fs.appendFileSync(path.join(__dirname, 'calls.jsonl'), JSON.stringify({ args: process.argv.slice(2), input }) + '\\n');
const file = path.join(__dirname, 'responses.json');
const queue = JSON.parse(fs.readFileSync(file, 'utf8'));
const next = queue.shift();
fs.writeFileSync(file, JSON.stringify(queue));
if (!next) {
  process.stderr.write('gh: no canned response\\n');
  process.exit(1);
}
if (next.stdout) process.stdout.write(next.stdout);
if (next.stderr) process.stderr.write(next.stderr);
process.exit(next.code || 0);
`;

/** Puts a \`gh\` first on PATH that records its arguments and answers with \`responses\` in order. */
export function fakeGh(responses: (CannedResponse | object)[]): FakeGh {
  const dir = mkdtempSync(join(tmpdir(), 'diffity-fake-gh-'));
  const script = join(dir, 'gh');
  writeFileSync(script, SCRIPT);
  chmodSync(script, 0o755);
  writeFileSync(join(dir, 'calls.jsonl'), '');
  const canned = responses.map((r) => ('stdout' in r || 'stderr' in r || 'code' in r ? r : { stdout: JSON.stringify(r) }));
  writeFileSync(join(dir, 'responses.json'), JSON.stringify(canned));
  const origPath = process.env.PATH;
  process.env.PATH = `${dir}:${origPath}`;
  const calls = () => readFileSync(join(dir, 'calls.jsonl'), 'utf-8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as GhCall);
  return {
    calls,
    graphqlCalls: () => calls().filter((c) => c.args[0] === 'api' && c.args[1] === 'graphql').map((c) => JSON.parse(c.input)),
    restore() {
      process.env.PATH = origPath;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
