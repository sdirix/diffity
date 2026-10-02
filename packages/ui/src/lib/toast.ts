import { toast } from 'sonner';
import { openInEditor } from './api';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface TaskMessages {
  loading: string;
  success: string;
  error: string;
}

/** Shows `loading` while `task` runs, then its success or error in the same toast. Resolves to whether it worked. */
export async function withToast(task: Promise<unknown>, messages: TaskMessages): Promise<boolean> {
  const id = toast.loading(messages.loading);
  try {
    await task;
    toast.success(messages.success, { id });
    return true;
  } catch (error) {
    toast.error(messages.error, { id, description: errorMessage(error) });
    return false;
  }
}

/** Opens `path` in the editor, the repository when it is empty. */
export function openInEditorWithToast(path: string, line?: number): Promise<boolean> {
  const name = path ? path.split('/').pop()! : 'the repository';
  return withToast(openInEditor(path, line), {
    loading: `Opening ${name}…`,
    success: `Opened ${name} in the editor`,
    error: 'Failed to open the editor',
  });
}

/** Copies `text` and confirms with `message`. Resolves to whether it worked. */
export async function copyWithToast(text: string, message: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) {
      throw new Error('Clipboard access needs HTTPS or localhost');
    }
    await navigator.clipboard.writeText(text);
    toast.success(message);
    return true;
  } catch (error) {
    toast.error('Failed to copy', { description: errorMessage(error) });
    return false;
  }
}
