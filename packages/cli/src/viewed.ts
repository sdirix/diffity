import { getChangesSinceBlob, getNewSideBlobs, InputError, snapshotNewSide } from '@diffity/git';
import { getDb, queryAll, queryOne, transaction } from './db.js';
import type { Session } from './session.js';

export interface ViewedFile {
  path: string;
  /** The file's blob on the new side when it was marked viewed, `null` when it had none. */
  blob: string | null;
  /** The file's blob on the new side now. */
  current: string | null;
  /** The viewed version was kept, so the changes since can be shown. */
  kept: boolean;
}

interface ViewedRow {
  file_path: string;
  blob: string | null;
  kept: number;
}

/** The files of `session` marked viewed, each with the blob it has now, so callers can tell which changed since. */
export function getViewedFiles(session: Session): ViewedFile[] {
  const rows = queryAll<ViewedRow>(
    'SELECT file_path, blob, kept FROM viewed_files WHERE session_id = ? ORDER BY file_path',
    session.id,
  );
  const current = getNewSideBlobs(session.ref, rows.map((row) => row.file_path));
  return rows.map((row, i) => ({ path: row.file_path, blob: row.blob, current: current[i], kept: row.kept === 1 }));
}

/** Marks `paths` viewed as they are now, keeping their content so later changes can be diffed against it. */
export function markViewed(session: Session, paths: string[]): void {
  const snapshots = snapshotNewSide(session.ref, paths);
  transaction(() => {
    const upsert = getDb().prepare(`
      INSERT INTO viewed_files (session_id, file_path, blob, kept) VALUES (?, ?, ?, ?)
      ON CONFLICT (session_id, file_path) DO UPDATE
      SET blob = excluded.blob, kept = excluded.kept, viewed_at = datetime('now')
    `);
    paths.forEach((path, i) => upsert.run(session.id, path, snapshots[i].blob, snapshots[i].kept ? 1 : 0));
  });
}

export function unmarkViewed(session: Session, paths: string[]): void {
  transaction(() => {
    const remove = getDb().prepare('DELETE FROM viewed_files WHERE session_id = ? AND file_path = ?');
    for (const path of paths) {
      remove.run(session.id, path);
    }
  });
}

/** The patch from the version of `path` marked viewed to the current one, empty when they match. */
export function getChangesSinceViewed(session: Session, path: string): string {
  const row = queryOne<ViewedRow>(
    'SELECT file_path, blob, kept FROM viewed_files WHERE session_id = ? AND file_path = ?',
    session.id,
    path,
  );
  if (!row?.blob || !row.kept) {
    throw new InputError(`No viewed version of ${path} to compare with`, 'not_found');
  }
  return getChangesSinceBlob(session.ref, path, row.blob);
}
