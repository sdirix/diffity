import { toast } from 'sonner';
import { copyWithToast, errorMessage } from './toast';

export function absolutePath(root: string, path: string): string {
  const base = root.replace(/\/+$/, '');
  return path ? `${base}/${path}` : base;
}

/** Lines in `text`, not counting the empty one after a final newline. */
export function lineCount(text: string): number {
  if (!text) {
    return 0;
  }
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

/** Copies the text `load` resolves to, as lines split on newlines. Binary contents are refused. */
export async function copyFileContents(path: string, load: () => Promise<string[]>): Promise<boolean> {
  let text: string;
  try {
    text = (await load()).join('\n');
  } catch (error) {
    toast.error(`Failed to read ${path}`, { description: errorMessage(error) });
    return false;
  }
  if (text.includes('\u0000')) {
    toast.error('Binary file', { description: 'Only text files can be copied.' });
    return false;
  }
  const lines = lineCount(text);
  return copyWithToast(text, `Copied ${lines} line${lines === 1 ? '' : 's'}`);
}
