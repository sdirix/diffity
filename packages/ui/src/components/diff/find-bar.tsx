import { useEffect, useMemo, useRef, useState } from 'react';
import type { DiffFile } from '@diffity/parser';
import { cn } from '../../lib/cn';
import { carryCurrent, diffFindLines, firstMatchFrom, searchLines, stepIndex, type FindMatch } from '../../lib/find';
import { clearMatches, groupMatches, paintMatches } from '../../lib/find-highlight';
import { isModPressed, MOD_KEY } from '../../lib/platform';
import { IconButton } from '../ui/icon-button';
import { SearchIcon } from '../icons/search-icon';
import { ChevronUpIcon } from '../icons/chevron-up-icon';
import { ChevronDownIcon } from '../icons/chevron-down-icon';
import { XIcon } from '../icons/x-icon';

const SEARCH_DEBOUNCE_MS = 120;

interface FindBarProps {
  files: DiffFile[];
  /** The file being read. A new search starts at its first match. */
  activeFile: string | null;
  onReveal: (match: FindMatch) => void;
  onClose: () => void;
  /** Opens and focuses the bar whenever it changes, like the find shortcut. */
  openRequest?: number;
}

interface FindResultState {
  matches: FindMatch[];
  truncated: boolean;
  current: number;
}

const EMPTY_RESULT: FindResultState = { matches: [], truncated: false, current: -1 };

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT' || element.isContentEditable;
}

function statusLabel(query: string, result: FindResultState): string {
  if (!query) {
    return '';
  }
  const count = result.matches.length;
  if (count === 0) {
    return 'No results';
  }
  const current = result.current >= 0 ? (result.current + 1).toLocaleString() : '-';
  return `${current} of ${count.toLocaleString()}${result.truncated ? '+' : ''}`;
}

/** Find in all files of the diff, searching the diff data so collapsed and unmounted files are included. */
export function FindBar(props: FindBarProps) {
  const { files, activeFile, onReveal, onClose, openRequest } = props;
  const [open, setOpen] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [result, setResult] = useState<FindResultState>(EMPTY_RESULT);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchedRef = useRef<string | null>(null);
  const latest = useRef({ open, result, activeFile, onReveal, onClose });
  latest.current = { open, result, activeFile, onReveal, onClose };

  const lines = useMemo(() => (open ? diffFindLines(files) : []), [open, files]);
  const byLine = useMemo(() => groupMatches(result.matches), [result.matches]);

  const step = (direction: 1 | -1) => {
    const { matches, current } = latest.current.result;
    if (matches.length === 0) {
      return;
    }
    const next = stepIndex(current, matches.length, direction);
    setResult((prev) => ({ ...prev, current: next }));
    latest.current.onReveal(matches[next]);
  };

  const close = () => {
    setOpen(false);
    latest.current.onClose();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && latest.current.open && !isTyping(event.target)) {
        close();
        return;
      }
      if (!isModPressed(event) || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'f' && !event.shiftKey && !document.querySelector('dialog:modal')) {
        event.preventDefault();
        setOpen(true);
        setFocusTick((tick) => tick + 1);
      } else if (key === 'g' && latest.current.open) {
        event.preventDefault();
        step(event.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (openRequest) {
      setOpen(true);
      setFocusTick((tick) => tick + 1);
    }
  }, [openRequest]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open, focusTick]);

  useEffect(() => {
    if (!open) {
      searchedRef.current = null;
      return;
    }
    const signature = `${caseSensitive ? 1 : 0}${query}`;
    const run = () => {
      const found = searchLines(lines, query, caseSensitive);
      const previous = latest.current.result;
      const fresh = searchedRef.current !== signature;
      searchedRef.current = signature;
      let next = fresh ? -1 : carryCurrent(previous.matches[previous.current] ?? null, found.matches);
      let reveal = fresh;
      if (next < 0 && found.matches.length > 0) {
        next = firstMatchFrom(lines, found.matches, latest.current.activeFile);
        reveal = reveal || previous.current < 0;
      }
      setResult({ matches: found.matches, truncated: found.truncated, current: next });
      if (reveal && next >= 0) {
        latest.current.onReveal(found.matches[next]);
      }
    };
    const timer = window.setTimeout(run, searchedRef.current === null || !query ? 0 : SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, lines, query, caseSensitive]);

  useEffect(() => {
    if (!open || result.matches.length === 0) {
      clearMatches();
      return;
    }
    const current = result.matches[result.current] ?? null;
    let frame = 0;
    const schedule = () => {
      if (frame) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        paintMatches(document, byLine, current);
      });
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [open, result, byLine]);

  useEffect(() => clearMatches, []);

  if (!open) {
    return null;
  }

  const count = result.matches.length;
  const navButtonClass = 'w-6 h-6 shrink-0 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent';

  return (
    <div
      role="search"
      className="absolute top-2 right-5 z-30 flex items-center gap-1 h-9 pl-2.5 pr-1 bg-bg-secondary border border-border rounded-md shadow-md"
    >
      <SearchIcon className="w-3.5 h-3.5 shrink-0 text-text-muted" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
        placeholder="Find in diff"
        aria-label="Find in diff"
        spellCheck={false}
        autoComplete="off"
        className="w-56 h-7 min-w-0 px-1 bg-transparent text-xs text-text outline-none placeholder:text-text-muted"
      />
      <span className="min-w-16 shrink-0 text-right text-[11px] tabular-nums text-text-muted" aria-live="polite">
        {statusLabel(query, result)}
      </span>
      <button
        type="button"
        aria-pressed={caseSensitive}
        onClick={() => setCaseSensitive(!caseSensitive)}
        title="Match case"
        className={cn(
          'ml-1 h-6 w-7 shrink-0 rounded font-mono text-[11px] font-semibold transition-colors cursor-pointer',
          caseSensitive ? 'bg-accent text-white' : 'text-text-muted hover:bg-hover hover:text-text',
        )}
      >
        Aa
      </button>
      <IconButton
        onClick={() => step(-1)}
        disabled={count === 0}
        title={`Previous match (Shift+Enter, ${MOD_KEY}+Shift+G)`}
        aria-label="Previous match"
        className={navButtonClass}
      >
        <ChevronUpIcon className="w-3.5 h-3.5" />
      </IconButton>
      <IconButton
        onClick={() => step(1)}
        disabled={count === 0}
        title={`Next match (Enter, ${MOD_KEY}+G)`}
        aria-label="Next match"
        className={navButtonClass}
      >
        <ChevronDownIcon className="w-3.5 h-3.5" />
      </IconButton>
      <IconButton onClick={close} title="Close (Esc)" aria-label="Close find" className="w-6 h-6 shrink-0">
        <XIcon className="w-3.5 h-3.5" />
      </IconButton>
    </div>
  );
}
