import { MOD_KEY } from './platform';

export interface Shortcut {
  /** Set when the command palette shows this key next to its own row. */
  id?: string;
  label: string;
  /** Keys that each do this. */
  keys: string[];
}

export interface ShortcutSection {
  title: string;
  shortcuts: Shortcut[];
}

/** `key` pressed with the platform mod key, e.g. `Ctrl+F` or `Ctrl+Shift+G`. */
export function chord(key: string, modifiers: { shift?: boolean } = {}): string {
  return [MOD_KEY, modifiers.shift && 'Shift', key].filter(Boolean).join('+');
}

/**
 * Every key the app answers. The shortcuts sheet and the hints in the command
 * palette read this list, so a key added to a handler is added here too.
 */
export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: 'Palette',
    shortcuts: [
      { id: 'palette', label: 'Commands, refs and comments', keys: [chord('K')] },
      { id: 'go-to-file', label: 'Go to file', keys: [chord('P')] },
      { label: 'Move between rows', keys: ['↑', '↓'] },
      { label: 'Run the row', keys: ['Enter'] },
      { id: 'palette-editor', label: 'Open the file in the editor', keys: [chord('Enter')] },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { id: 'file-next', label: 'Next file', keys: ['j'] },
      { id: 'file-prev', label: 'Previous file', keys: ['k'] },
      { id: 'file-next-unviewed', label: 'Next unviewed file', keys: ['Shift+j'] },
      { id: 'hunk-next', label: 'Next changed hunk', keys: ['n'] },
      { id: 'hunk-prev', label: 'Previous changed hunk', keys: ['p'] },
      { id: 'ref-menu', label: 'Choose what to review', keys: ['w'] },
    ],
  },
  {
    title: 'View',
    shortcuts: [
      { id: 'view-unified', label: 'Unified view', keys: ['u'] },
      { id: 'view-split', label: 'Split view', keys: ['s'] },
      { label: 'Collapse/expand file', keys: ['x'] },
      { id: 'collapse-all', label: 'Collapse/expand all files', keys: ['Shift+x'] },
      { id: 'toggle-viewed', label: 'Toggle file as viewed', keys: ['r'] },
      { id: 'mark-all-viewed', label: 'Mark all files as viewed', keys: ['Shift+r'] },
      { id: 'comments-panel', label: 'Toggle comments panel', keys: ['c'] },
    ],
  },
  {
    title: 'Find',
    shortcuts: [
      { id: 'find', label: 'Find in diff', keys: [chord('F')] },
      { label: 'Next match', keys: ['Enter', chord('G')] },
      { label: 'Previous match', keys: ['Shift+Enter', chord('G', { shift: true })] },
      { label: 'Close find', keys: ['Esc'] },
    ],
  },
  {
    title: 'Other',
    shortcuts: [
      { id: 'filter-files', label: 'Focus search', keys: ['/'] },
      { label: 'Actions for the focused file or folder', keys: ['Shift+F10', 'Menu'] },
      { id: 'shortcuts', label: 'Show shortcuts', keys: ['?'] },
      { id: 'settings', label: 'Settings', keys: [chord(',')] },
      { label: 'Close modal / clear', keys: ['Esc'] },
    ],
  },
];

const BY_ID = new Map(
  SHORTCUT_SECTIONS.flatMap((section) => section.shortcuts)
    .filter((shortcut) => shortcut.id)
    .map((shortcut) => [shortcut.id, shortcut]),
);

/** The first key of a shortcut, as the command palette shows it next to a row. */
export function shortcutHint(id: string): string | undefined {
  return BY_ID.get(id)?.keys[0];
}
