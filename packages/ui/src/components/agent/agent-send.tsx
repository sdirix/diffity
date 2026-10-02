import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { getThreadLineLabel } from '../../lib/comment-navigation';
import { isModPressed } from '../../lib/platform';
import { shortcutHint } from '../../lib/shortcuts';
import { fileLabel } from '../../lib/thread-location';
import { errorMessage } from '../../lib/toast';
import type { CommentThread } from '../comments/types';
import { SendIcon, SparkleIcon } from './agent-icons';
import { AgentPopover } from './agent-popover';
import { requestSend, setSendCount, useAgentUi } from './agent-store';
import { OfflineHint } from './agent-status';
import { AGENT_NAME, busyThreadIds, canSendTo, plural, preselected, sendCandidates } from './request-state';
import { fieldClass, primaryButtonClass, secondaryButtonClass, toolbarButtonClass } from './styles';
import { queueRequest, useAgentRequests } from './use-agent';

function byFile(threads: CommentThread[]): [string, CommentThread[]][] {
  const groups = new Map<string, CommentThread[]>();
  for (const thread of threads) {
    groups.set(thread.filePath, [...(groups.get(thread.filePath) ?? []), thread]);
  }
  return [...groups.entries()];
}

function ThreadGroups(props: { threads: CommentThread[]; isChecked: (id: string) => boolean; onToggle: (id: string) => void }) {
  const { threads, isChecked, onToggle } = props;

  return byFile(threads).map(([file, items]) => (
    <div key={file} className="pb-1">
      <div className="px-2 pt-1.5 pb-1 font-mono text-[11px] text-text-muted truncate" title={file}>{fileLabel(file)}</div>
      {items.map((thread) => (
        <label key={thread.id} className="flex items-start gap-2 px-2 py-1 rounded-md hover:bg-hover cursor-pointer">
          <input type="checkbox" checked={isChecked(thread.id)} onChange={() => onToggle(thread.id)} className="mt-0.5 accent-accent" />
          <span className="shrink-0 w-12 pt-px font-mono text-[11px] text-text-muted">{getThreadLineLabel(thread)}</span>
          <span className="min-w-0 flex-1 leading-5 text-text line-clamp-2 break-words">{thread.comments.at(-1)?.body}</span>
        </label>
      ))}
    </div>
  ));
}

function toggled(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(id)) {
    next.add(id);
  }
  return next;
}

interface SendFormProps {
  diffRef: string;
  yours: CommentThread[];
  agents: CommentThread[];
  onClose: () => void;
}

function SendForm(props: SendFormProps) {
  const { diffRef, yours, agents, onClose } = props;
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(() => new Set(yours.length === 0 ? agents.map((t) => t.id) : []));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const selected = [...yours.filter((t) => !excluded.has(t.id)), ...agents.filter((t) => picked.has(t.id))];
  const allAgents = agents.every((t) => picked.has(t.id));

  const send = async () => {
    if (sending || selected.length === 0) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      await queueRequest({ mode: 'resolve', ref: diffRef, threadIds: selected.map((t) => t.id), note: note.trim() || undefined });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSending(false);
    }
  };

  return (
    <form
      className="flex flex-col w-[420px]"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && isModPressed(e)) {
          e.preventDefault();
          void send();
        }
      }}
    >
      <div className="px-3 pt-3 pb-2">
        <div className="text-[13px] font-medium">Send comments to {AGENT_NAME}</div>
        <p className="mt-0.5 text-text-secondary">{AGENT_NAME} makes the changes and replies on each thread.</p>
      </div>
      <div className="max-h-72 overflow-y-auto px-1.5 border-t border-border">
        {yours.length > 0 && agents.length > 0 && <div className="px-2 pt-2 text-[11px] font-medium text-text-muted">Your comments</div>}
        <ThreadGroups threads={yours} isChecked={(id) => !excluded.has(id)} onToggle={(id) => setExcluded(toggled(excluded, id))} />
        {agents.length > 0 && (
          <>
            <div className="flex items-center gap-1.5 px-2 pt-2 text-[11px] font-medium text-text-muted">
              <SparkleIcon className="w-3 h-3 text-accent" />
              <span className="flex-1">Comments of {AGENT_NAME}</span>
              <button
                type="button"
                onClick={() => setPicked(new Set(allAgents ? [] : agents.map((t) => t.id)))}
                className="text-text-secondary hover:text-text cursor-pointer"
              >
                {allAgents ? 'Select none' : 'Select all'}
              </button>
            </div>
            <ThreadGroups threads={agents} isChecked={(id) => picked.has(id)} onToggle={(id) => setPicked(toggled(picked, id))} />
          </>
        )}
      </div>
      <div className="flex flex-col gap-2 px-3 pt-2 pb-3 border-t border-border">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Optional note for all of them, e.g. keep changes minimal"
          className={fieldClass}
        />
        {error && <div className="px-2 py-1.5 rounded-md bg-deleted/10 text-deleted break-words">{error}</div>}
        <OfflineHint />
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>Cancel</button>
          <button type="submit" disabled={sending || selected.length === 0} className={primaryButtonClass}>
            <SendIcon className="w-3.5 h-3.5" />
            Send {selected.length} to {AGENT_NAME}
          </button>
        </div>
      </div>
    </form>
  );
}

interface AgentSendProps {
  diffRef: string;
  threads: CommentThread[];
}

/** "Send N" with a picker of the threads to resolve. Renders nothing without threads to send. */
export function AgentSend(props: AgentSendProps) {
  const { diffRef, threads } = props;
  const { requests } = useAgentRequests();
  const [open, setOpen] = useState(false);
  const request = useAgentUi((s) => s.sendRequest);
  const seenRequest = useRef(request);
  const allowed = canSendTo(diffRef);
  const candidates = useMemo(() => sendCandidates(threads, busyThreadIds(requests)), [threads, requests]);
  const count = allowed ? preselected(candidates).length : 0;
  const total = candidates.yours.length + candidates.agents.length;

  useEffect(() => {
    setSendCount(allowed && total > 0 ? count : null);
    return () => setSendCount(null);
  }, [allowed, total, count]);

  useEffect(() => {
    if (request !== seenRequest.current) {
      seenRequest.current = request;
      setOpen(allowed && total > 0);
    }
  }, [request, allowed, total]);

  if (!allowed || total === 0) {
    return null;
  }

  return (
    <AgentPopover
      open={open}
      onClose={() => setOpen(false)}
      className="p-0"
      trigger={(
        <button
          onClick={() => setOpen(!open)}
          className={cn(toolbarButtonClass, open && 'bg-accent/15 text-accent')}
          aria-expanded={open}
          title={`${AGENT_NAME} addresses ${plural(count, 'open comment')} and replies on each thread (${shortcutHint('agent-send')})`}
        >
          <SendIcon className="w-3.5 h-3.5 text-accent" />
          Send {count}
        </button>
      )}
    >
      <SendForm diffRef={diffRef} yours={candidates.yours} agents={candidates.agents} onClose={() => setOpen(false)} />
    </AgentPopover>
  );
}

/** The send button of the comments panel, which opens the picker of the diff toolbar. */
export function AgentPanelSend() {
  const count = useAgentUi((s) => s.sendCount);

  if (count === null) {
    return null;
  }

  return (
    <div className="px-3 py-2 border-t border-border">
      <button onClick={requestSend} className={cn(toolbarButtonClass, 'w-full justify-center')}>
        <SendIcon className="w-3.5 h-3.5 text-accent" />
        Send {count} to {AGENT_NAME}
      </button>
    </div>
  );
}
