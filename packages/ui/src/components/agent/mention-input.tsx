import { useEffect, useLayoutEffect, useState, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { useSettings } from '../../lib/preferences';
import { SparkleIcon } from './agent-icons';
import { mentionQuery, type MentionQuery } from './mentions';
import { AGENT_NAME } from './request-state';

interface MentionPopupProps {
  anchor: HTMLTextAreaElement;
  query: MentionQuery;
  active: number;
  onAccept: (handle: string) => void;
}

function MentionPopup(props: MentionPopupProps) {
  const { anchor, query, active, onAccept } = props;
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const below = rect.bottom + 80 < window.innerHeight;
    setPosition(below
      ? { left: rect.left + 8, top: rect.bottom + 4 }
      : { left: rect.left + 8, bottom: window.innerHeight - rect.top + 4 });
  }, [anchor, query]);

  if (!position) {
    return null;
  }

  return createPortal(
    <div
      role="listbox"
      style={position}
      className="fixed z-50 w-64 py-1 bg-bg-secondary rounded-md shadow-lg ring-1 ring-border font-sans text-xs"
    >
      {query.handles.map((handle, index) => (
        <button
          key={handle}
          type="button"
          role="option"
          aria-selected={index === active}
          onMouseDown={(e) => {
            e.preventDefault();
            onAccept(handle);
          }}
          className={cn('flex items-center gap-2 w-full px-3 py-1.5 text-left text-text cursor-pointer', index === active && 'bg-hover')}
        >
          <SparkleIcon className="w-3.5 h-3.5 text-accent" />
          <span className="font-semibold">@{handle}</span>
          <span className="text-text-muted truncate">Ask {AGENT_NAME}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

/**
 * Completes `@claude` and `@agent` in a comment textarea while mentions send
 * the thread to the agent. Pass `onKeyDown` first in the textarea's own key
 * handler and `onCaret` on change and select.
 */
export function useAgentMention(value: string, setValue: (value: string) => void, textareaRef: RefObject<HTMLTextAreaElement | null>) {
  const enabled = useSettings().agentMentions;
  const [query, setQuery] = useState<MentionQuery | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!query) {
      return;
    }
    const close = () => setQuery(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [query]);

  const onCaret = () => {
    const el = textareaRef.current;
    const next = enabled && el ? mentionQuery(el.value, el.selectionStart) : null;
    setQuery(next);
    if (!next || next.handles.join() !== query?.handles.join()) {
      setActive(0);
    }
  };

  const accept = (handle: string) => {
    if (!query) {
      return;
    }
    const insert = `@${handle} `;
    setValue(value.slice(0, query.start) + insert + value.slice(query.end));
    setQuery(null);
    const caret = query.start + insert.length;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  };

  /** Handles the keys of the open completion. Returns whether it took the key. */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!query || e.metaKey || e.ctrlKey || e.altKey) {
      return false;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + query.handles.length) % query.handles.length);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      accept(query.handles[active] ?? query.handles[0]);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setQuery(null);
      return true;
    }
    return false;
  };

  const anchor = textareaRef.current;

  return {
    onKeyDown,
    onCaret,
    onBlur: () => setQuery(null),
    popup: query && anchor ? <MentionPopup anchor={anchor} query={query} active={active} onAccept={accept} /> : null,
    hint: enabled ? <span className="text-[11px] text-text-muted truncate">@claude or @agent asks {AGENT_NAME}</span> : null,
  };
}
