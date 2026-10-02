import type { IncomingMessage, ServerResponse } from 'node:http';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { assertRepoPath, getRepoRoot, InputError } from '@diffity/git';
import { detectEditors, launchEditor, resolveEditor, type ResolvedEditor } from './editor.js';
import { readSettings } from './settings.js';
import { readJsonObject, sendError, sendJson } from './http-utils.js';

function currentEditor(): ResolvedEditor | null {
  return resolveEditor(readSettings(), getRepoRoot());
}

/** The `editor` capability of `/api/info`: the editor that opens files now, `null` without one. */
export function editorCapability(): { id: string; name: string } | null {
  const editor = currentEditor();
  return editor && { id: editor.id, name: editor.name };
}

function optionalPosition(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new InputError(`Invalid ${name}`);
  }
  return value as number;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Opening files in the editor of the settings. Errors reach the server's handler, which answers `InputError` with 400. */
export async function handleEditorRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  if (pathname === '/api/editors' && req.method === 'GET') {
    sendJson(res, { detected: detectEditors(), active: editorCapability() });
    return true;
  }

  if (pathname === '/api/open-in-editor' && req.method === 'POST') {
    const body = await readJsonObject(req);
    if (typeof body.filePath !== 'string') {
      throw new InputError('Missing filePath');
    }
    const line = optionalPosition(body.line, 'line');
    const column = optionalPosition(body.column, 'column');
    if (body.filePath) {
      assertRepoPath(body.filePath);
    }
    const editor = currentEditor();
    if (!editor) {
      sendError(res, 404, 'No editor available');
      return true;
    }
    const root = getRepoRoot();
    const path = body.filePath ? join(root, body.filePath) : root;
    try {
      await launchEditor(editor.launch({ root, path, isDir: isDirectory(path), line, column }), root);
    } catch (err) {
      sendError(res, 500, `Failed to start ${editor.name}: ${err instanceof Error ? err.message : err}`);
      return true;
    }
    sendJson(res, { ok: true });
    return true;
  }

  return false;
}
