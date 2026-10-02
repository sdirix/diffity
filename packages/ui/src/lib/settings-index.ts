import type { SettingsSection } from '../hooks/use-settings-dialog';

export const SECTION_LABELS: Record<SettingsSection, string> = {
  appearance: 'Appearance',
  diff: 'Diff',
  editor: 'Editor',
  agent: 'Agent',
  data: 'Data',
};

export interface SettingsItem {
  /** The row's id in its section. */
  id: string;
  label: string;
  section: SettingsSection;
  keywords: string;
}

/** Every setting the dialog's search finds. */
export const SETTINGS_ITEMS: SettingsItem[] = [
  { id: 'theme', label: 'Theme', section: 'appearance', keywords: 'dark light system mode colour color' },
  { id: 'diff-colours', label: 'Diff colours', section: 'appearance', keywords: 'colour-blind colorblind color palette accessibility green red blue orange' },
  { id: 'diff-layout', label: 'Default layout', section: 'diff', keywords: 'split unified view side by side' },
  { id: 'whitespace', label: 'Hide whitespace changes', section: 'diff', keywords: 'spaces indentation ignore default' },
  { id: 'hidden-files', label: 'Hidden files', section: 'diff', keywords: 'diffityignore ignore generated exclude patterns' },
  { id: 'editor', label: 'Open files with', section: 'editor', keywords: 'vs code vscode cursor zed sublime intellij idea automatic detect' },
  { id: 'editor-command', label: 'Custom editor command', section: 'editor', keywords: 'program arguments file line column placeholder diffity config cli' },
  { id: 'agent-mentions', label: 'Ask the agent with @mentions', section: 'agent', keywords: '@claude @agent mention comment reply queue request' },
  { id: 'clear-data', label: 'Clear comments and viewed files', section: 'data', keywords: 'delete reset remove threads reviewed storage' },
];

/** The settings whose label, keywords or section contain every word of `query`. */
export function searchSettings(query: string): SettingsItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return SETTINGS_ITEMS.filter((item) => {
    const text = `${item.label} ${item.keywords} ${SECTION_LABELS[item.section]}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
