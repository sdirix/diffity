import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

export interface TempRepo {
  dir: string;
  git: (...args: string[]) => string;
  write: (name: string, content: string | Buffer) => void;
  read: (name: string) => string;
  commit: (message: string) => void;
  remove: () => void;
}

export function createRepo(): TempRepo {
  const dir = mkdtempSync(join(tmpdir(), 'diffity-test-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' });

  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@test.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');

  return {
    dir,
    git,
    write(name, content) {
      const full = join(dir, name);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    },
    read(name) {
      return readFileSync(join(dir, name), 'utf-8');
    },
    commit(message) {
      git('add', '-A');
      git('commit', '-q', '-m', message);
    },
    remove() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
