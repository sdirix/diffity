import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchDiffIgnoreRules, saveDiffIgnoreRules } from '../../lib/api';
import { updateSettings, useSettings, type Settings } from '../../lib/preferences';
import { errorMessage } from '../../lib/toast';
import { ChoiceGroup, SettingsButton, SettingsGroup, SettingsRow, Switch, settingsInputClass } from './settings-controls';

const LAYOUTS: { value: Settings['diffLayout']; label: string }[] = [
  { value: 'split', label: 'Split' },
  { value: 'unified', label: 'Unified' },
];

/** The patterns this repo hides from diffs besides `.diffityignore`. */
function HiddenFilesRow() {
  const queryClient = useQueryClient();
  const { data: saved, isPending } = useQuery({ queryKey: ['diff-ignore-rules'], queryFn: fetchDiffIgnoreRules });
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savedText = saved?.replace(/\n$/, '') ?? '';
  const text = draft ?? savedText;
  const dirty = draft !== null && draft !== savedText;

  const save = async () => {
    setSaving(true);
    try {
      await saveDiffIgnoreRules(text);
      await queryClient.invalidateQueries({ queryKey: ['diff-ignore-rules'] });
      for (const key of ['diff', 'status', 'tree-hidden']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      setDraft(null);
      toast.success('Hidden files saved');
    } catch (error) {
      toast.error('Failed to save hidden files', { description: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsRow
      id="hidden-files"
      stacked
      label="Hidden files"
      hint={<>Gitignore patterns hidden from diffs, on top of <code className="font-mono">.diffityignore</code>. Stored in <code className="font-mono">~/.diffity</code>, not in the repo.</>}
    >
      <div className="flex flex-col gap-2 w-full">
        <textarea
          value={text}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={'dist/\n*.generated.ts\n!dist/keep.js'}
          spellCheck={false}
          rows={5}
          aria-label="Patterns to hide from diffs"
          className={`${settingsInputClass} resize-y py-2 leading-5`}
        />
        <div className="flex justify-end gap-2">
          {dirty && (
            <SettingsButton onClick={() => setDraft(null)} disabled={saving}>
              Revert
            </SettingsButton>
          )}
          <SettingsButton variant="primary" onClick={save} disabled={saving || isPending || !dirty}>
            Save
          </SettingsButton>
        </div>
      </div>
    </SettingsRow>
  );
}

export function DiffSection() {
  const settings = useSettings();

  return (
    <>
      <SettingsGroup title="Defaults">
        <SettingsRow id="diff-layout" label="Layout" hint="How diffs open. u and s switch the open diff.">
          <ChoiceGroup label="Layout" value={settings.diffLayout} options={LAYOUTS} onChange={(diffLayout) => void updateSettings({ diffLayout })} />
        </SettingsRow>
        <SettingsRow id="whitespace" label="Hide whitespace changes" hint="Whether diffs open without them. The options menu switches the open diff.">
          <Switch
            label="Hide whitespace changes"
            checked={settings.hideWhitespace}
            onChange={(hideWhitespace) => void updateSettings({ hideWhitespace })}
          />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="This repository">
        <HiddenFilesRow />
      </SettingsGroup>
    </>
  );
}
