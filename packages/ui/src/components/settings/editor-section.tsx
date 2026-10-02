import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchEditors, type Editors } from '../../lib/api';
import { updateSettings, useSettings, type Settings } from '../../lib/preferences';
import { cn } from '../../lib/cn';
import { SettingsGroup, SettingsRow, settingsInputClass } from './settings-controls';

interface EditorOption {
  value: string;
  label: string;
  detail?: string;
}

function editorOptions(editors: Editors | undefined, chosen: string): EditorOption[] {
  const detected = editors?.detected ?? [];
  const options: EditorOption[] = [
    { value: 'auto', label: 'Automatic', detail: detected[0]?.name ?? 'none found' },
    ...detected.map((editor) => ({ value: editor.id, label: editor.name, detail: editor.command })),
  ];
  if (chosen !== 'custom' && !options.some((option) => option.value === chosen)) {
    options.push({ value: chosen, label: chosen, detail: 'not found, automatic instead' });
  }
  options.push({ value: 'custom', label: 'Custom command' });
  return options;
}

function status(editors: Editors | undefined, settings: Settings): string {
  if (!editors) {
    return 'Looking for editors…';
  }
  if (editors.active) {
    return `Files open in ${editors.active.name}.`;
  }
  if (settings.editor === 'custom') {
    return settings.editorCommand.trim() ? 'The custom command was not found.' : 'No custom command set.';
  }
  return 'No known editor found on PATH. Set a custom command.';
}

export function EditorSection() {
  const settings = useSettings();
  const queryClient = useQueryClient();
  const { data: editors } = useQuery({ queryKey: ['editors'], queryFn: fetchEditors });

  const save = async (patch: Partial<Settings>) => {
    await updateSettings(patch);
    for (const key of ['editors', 'repo-info', 'tree-info']) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  return (
    <SettingsGroup title="Open in editor">
      <SettingsRow id="editor" stacked label="Open files with" hint={status(editors, settings)}>
        <div role="radiogroup" aria-label="Open files with" className="flex flex-col w-full rounded-lg border border-border overflow-hidden">
          {editorOptions(editors, settings.editor).map((option) => {
            const active = option.value === settings.editor;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => void save({ editor: option.value })}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 text-left text-xs border-t border-border first:border-t-0 cursor-pointer transition-colors',
                  active ? 'bg-accent/10' : 'hover:bg-hover',
                )}
              >
                <span className={cn('w-3 h-3 rounded-full border shrink-0', active ? 'border-accent border-[4px]' : 'border-text-muted')} />
                <span className="text-text">{option.label}</span>
                {option.detail && (
                  <span className={cn('ml-auto text-[11px] text-text-muted', option.value !== 'auto' && 'font-mono')}>{option.detail}</span>
                )}
              </button>
            );
          })}
        </div>
      </SettingsRow>
      <SettingsRow
        id="editor-command"
        stacked
        label="Custom command"
        hint={<>Set with <code className="font-mono">diffity config editor "&lt;command&gt;"</code> or in <code className="font-mono">~/.diffity/settings.json</code>. Runs without a shell. <code className="font-mono">{'{file}'}</code>, <code className="font-mono">{'{line}'}</code> and <code className="font-mono">{'{column}'}</code> are filled in, the file is appended without <code className="font-mono">{'{file}'}</code>.</>}
      >
        <input
          value={settings.editorCommand}
          readOnly
          placeholder="Not set"
          aria-label="Custom editor command"
          spellCheck={false}
          className={cn(settingsInputClass, 'h-7 font-mono text-text-secondary')}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}
