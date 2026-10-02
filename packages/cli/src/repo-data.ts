import { queryOne, transaction, getDb } from './db.js';

/** What the repo's database holds for its review sessions. */
export interface RepoDataCounts {
  threads: number;
  comments: number;
  viewed: number;
}

function count(table: string): number {
  return queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)?.count ?? 0;
}

export function countRepoData(): RepoDataCounts {
  return { threads: count('comment_threads'), comments: count('comments'), viewed: count('viewed_files') };
}

/** Deletes the comments and viewed marks of every session of the repo. Tours stay. */
export function clearRepoData(): void {
  transaction(() => {
    getDb().exec('DELETE FROM comments; DELETE FROM comment_threads; DELETE FROM viewed_files;');
  });
}
