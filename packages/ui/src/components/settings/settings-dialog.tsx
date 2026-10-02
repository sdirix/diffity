import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cn } from '../../lib/cn';
import { isModPressed } from '../../lib/platform';
import { isModalOpen } from '../../lib/dom-utils';
import { SECTION_LABELS, searchSettings, type SettingsItem } from '../../lib/settings-index';
import {
  closeSettings,
  getSettingsDialogState,
  openSettings,
  useSettingsDialog,
  type SettingsSection,
} from '../../hooks/use-settings-dialog';
import { CodeIcon } from '../icons/code-icon';
import { ContrastIcon } from '../icons/contrast-icon';
import { GitCompareIcon } from '../icons/git-compare-icon';
import { SearchIcon } from '../icons/search-icon';
import { TrashIcon } from '../icons/trash-icon';
import { XIcon } from '../icons/x-icon';
import { SparkleIcon } from '../agent/agent-icons';
import { AgentSettingsSection } from '../agent/agent-settings';
import { AppearanceSection } from './appearance-section';
import { DataSection } from './data-section';
import { DiffSection } from './diff-section';
import { EditorSection } from './editor-section';
import { settingElementId } from './settings-controls';

const SECTIONS: { id: SettingsSection; icon: ComponentType<{ className?: string }>; pane: ComponentType }[] = [
  { id: 'appearance', icon: ContrastIcon, pane: AppearanceSection },
  { id: 'diff', icon: GitCompareIcon, pane: DiffSection },
  { id: 'editor', icon: CodeIcon, pane: EditorSection },
  { id: 'agent', icon: SparkleIcon, pane: AgentSettingsSection },
  { id: 'data', icon: TrashIcon, pane: DataSection },
];

function isSettingsShortcut(event: KeyboardEvent | ReactKeyboardEvent): boolean {
  return event.key === ',' && isModPressed(event) && !event.altKey && !event.shiftKey;
}

/** Mod+, opens the settings, or closes them. */
function useSettingsShortcut() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isSettingsShortcut(event)) {
        return;
      }
      const open = getSettingsDialogState().open;
      if (!open && isModalOpen()) {
        return;
      }
      event.preventDefault();
      if (event.repeat) {
        return;
      }
      if (open) {
        closeSettings();
      } else {
        openSettings();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}

export function SettingsDialog() {
  const { open } = useSettingsDialog();
  useSettingsShortcut();

  if (!open) {
    return null;
  }
  return <SettingsDialogBody />;
}

function SettingsDialogBody() {
  const { section, item } = useSettingsDialog();
  const [query, setQuery] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => searchSettings(query), [query]);
  const searching = query.trim() !== '';
  const Pane = SECTIONS.find((entry) => entry.id === section)!.pane;

  // A layout effect closes the dialog before it leaves the document, so focus goes back where it was.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    dialog.showModal();
    return () => dialog.close();
  }, []);

  useEffect(() => {
    if (!item) {
      paneRef.current?.scrollTo({ top: 0 });
      return;
    }
    const row = document.getElementById(settingElementId(item));
    row?.scrollIntoView({ block: 'nearest' });
    row?.querySelector<HTMLElement>('textarea, input, button:not(:disabled)')?.focus();
  }, [section, item]);

  const choose = (result: SettingsItem | undefined) => {
    if (result) {
      setQuery('');
      openSettings(result.section, result.id);
    }
  };

  // Keys stay in the dialog, so the page behind does not act on them.
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    event.stopPropagation();
    if (isSettingsShortcut(event)) {
      event.preventDefault();
      closeSettings();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label="Settings"
      onKeyDown={handleKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        if (query) {
          setQuery('');
        } else {
          closeSettings();
        }
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          closeSettings();
        }
      }}
      className="fixed inset-0 m-auto p-0 w-[760px] max-w-[calc(100vw-2rem)] h-[min(560px,calc(100vh-4rem))] bg-bg text-text border border-border rounded-xl shadow-lg overflow-hidden font-sans backdrop:bg-black/40"
    >
      <div className="flex h-full">
        <nav className="w-[200px] shrink-0 flex flex-col gap-3 p-2 pt-3 border-r border-border bg-bg-secondary overflow-y-auto">
          <div className="flex items-center gap-1.5 h-7 px-2 rounded-md border border-border bg-bg focus-within:border-accent">
            <SearchIcon className="w-3.5 h-3.5 shrink-0 text-text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  choose(results[0]);
                }
              }}
              placeholder="Find a setting"
              aria-label="Find a setting"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 min-w-0 bg-transparent text-xs text-text outline-none placeholder:text-text-muted"
            />
          </div>
          {searching ? (
            <div className="flex flex-col gap-0.5">
              {results.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => choose(result)}
                  className="flex flex-col items-start px-2 py-1 rounded-md text-left hover:bg-hover cursor-pointer"
                >
                  <span className="text-[13px] text-text">{result.label}</span>
                  <span className="text-[11px] text-text-muted">{SECTION_LABELS[result.section]}</span>
                </button>
              ))}
              {results.length === 0 && <p className="px-2 py-1 text-xs text-text-muted">No matches</p>}
            </div>
          ) : (
            <div role="tablist" aria-orientation="vertical" aria-label="Settings sections" className="flex flex-col gap-0.5">
              {SECTIONS.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={id === section}
                  onClick={() => openSettings(id)}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-left transition-colors cursor-pointer',
                    id === section ? 'bg-active text-text' : 'text-text-secondary hover:bg-hover hover:text-text',
                  )}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {SECTION_LABELS[id]}
                </button>
              ))}
            </div>
          )}
          <p className="mt-auto px-2 pb-1 text-[11px] leading-snug text-text-muted">
            Shared by every repo, except under This repository.
          </p>
        </nav>
        <div ref={paneRef} role="tabpanel" aria-label={SECTION_LABELS[section]} className="flex-1 min-w-0 overflow-y-auto px-6 pt-3 pb-6">
          <div className="flex items-center justify-between h-7 mb-4">
            <h2 className="text-[15px] font-semibold text-text">{SECTION_LABELS[section]}</h2>
            <button
              type="button"
              onClick={closeSettings}
              aria-label="Close settings"
              className="p-1 rounded-md text-text-muted hover:text-text hover:bg-hover cursor-pointer"
            >
              <XIcon className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-col gap-6">
            <Pane />
          </div>
        </div>
      </div>
    </dialog>
  );
}
