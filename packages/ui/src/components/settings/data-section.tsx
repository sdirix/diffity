import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clearRepoData, fetchRepoData, type RepoData } from '../../lib/api';
import { errorMessage } from '../../lib/toast';
import { SettingsButton, SettingsGroup, SettingsRow } from './settings-controls';

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function summary(data: RepoData): string {
  return `${plural(data.threads, 'thread')} with ${plural(data.comments, 'comment')} and ${plural(data.viewed, 'viewed file')}`;
}

export function DataSection() {
  const queryClient = useQueryClient();
  const { data, error } = useQuery({ queryKey: ['repo-data'], queryFn: fetchRepoData });
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const empty = !data || (data.threads === 0 && data.viewed === 0);

  const clear = async () => {
    setClearing(true);
    try {
      queryClient.setQueryData(['repo-data'], await clearRepoData());
      for (const key of ['threads', 'repo-threads', 'viewed']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast.success(`Cleared the comments and viewed files of ${data?.name}`);
      setConfirming(false);
    } catch (clearError) {
      toast.error('Failed to clear the data', { description: errorMessage(clearError) });
    } finally {
      setClearing(false);
    }
  };

  let hint = 'Loading…';
  if (error) {
    hint = `Failed to load: ${errorMessage(error)}`;
  } else if (data) {
    hint = `${summary(data)}, across all views of ${data.name}.`;
  }

  return (
    <SettingsGroup title="This repository">
      <SettingsRow id="clear-data" label="Comments and viewed files" hint={hint}>
        <SettingsButton variant="danger" onClick={() => setConfirming(true)} disabled={empty || confirming}>
          Clear…
        </SettingsButton>
      </SettingsRow>
      {confirming && data && (
        <div role="alertdialog" aria-label="Clear data" className="flex flex-col gap-3 p-3 rounded-lg border border-border bg-bg-secondary text-xs">
          <p className="text-text leading-relaxed">
            Delete {summary(data)} stored for <code className="font-mono">{data.root}</code>? Resolved threads are included.
            Tours, settings and hidden files stay. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <SettingsButton autoFocus onClick={() => setConfirming(false)} disabled={clearing}>
              Cancel
            </SettingsButton>
            <SettingsButton variant="danger" onClick={clear} disabled={clearing}>
              Clear data
            </SettingsButton>
          </div>
        </div>
      )}
    </SettingsGroup>
  );
}
