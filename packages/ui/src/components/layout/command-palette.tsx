import { useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { cn } from '../../lib/cn';
import { highlightSegments } from '../../lib/fuzzy';
import { rankItems, recentActions, recentFiles, rememberAction, rememberFile, type RankItem } from '../../lib/palette';
import { isModPressed } from '../../lib/platform';
import { commitRef, parseCommitRef, refLabel } from '../../lib/refs';
import { shortcutHint } from '../../lib/shortcuts';
import { openInEditorWithToast } from '../../lib/toast';
import { lastLocation } from '../../lib/view-state';
import { getThreadLineLabel, getThreadPreview, getUnresolvedFileThreads } from '../../lib/comment-navigation';
import { commitPagesOptions } from '../../queries/commits';
import { statusOptions } from '../../queries/refs';
import { treePathsOptions } from '../../queries/tree';
import {
  closePalette,
  getPaletteState,
  isPaletteAvailable,
  openPalette,
  usePaletteMode,
  usePaletteState,
  type PaletteFile,
  type PaletteMode,
} from '../../hooks/use-palette';
import type { CommentThread } from '../comments/types';
import { useNavigateToRef } from './ref-menu';
import { Kbd } from '../ui/kbd';
import { SearchIcon } from '../icons/search-icon';
import { FileIcon } from '../icons/file-icon';
import { CommentIcon } from '../icons/comment-icon';
import { CheckIcon } from '../icons/check-icon';
import { PencilIcon } from '../icons/pencil-icon';
import { GitCommitIcon } from '../icons/git-commit-icon';
import { GitCompareIcon } from '../icons/git-compare-icon';

interface Row extends RankItem {
  icon?: ReactNode;
  detail?: ReactNode;
  hint?: string;
  /** Shows the title as a file path, file name first. */
  path?: string;
  run: () => void;
  /** Runs instead of `run` on Mod+Enter. */
  alt?: () => void;
}

const COMMAND_GROUPS = ['Actions', 'View', 'Go to', 'Comments', 'Commits'];
const ALL_FILES_GROUP = 'All files';
const MAX_COMMITS = 20;
const MAX_ROWS = 200;
const PATH_PREFIX = '__path__:';

const iconClass = 'w-3.5 h-3.5';

/** Mod+K opens the commands, Mod+P the files, either closes its own mode. */
function usePaletteShortcuts() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isModPressed(event) || event.altKey || event.shiftKey) {
        return;
      }
      const key = event.key.toLowerCase();
      const mode: PaletteMode | null = key === 'k' ? 'commands' : key === 'p' ? 'files' : null;
      if (!mode || !isPaletteAvailable()) {
        return;
      }
      const current = getPaletteState().mode;
      if (!current && document.querySelector('dialog:modal')) {
        return;
      }
      event.preventDefault();
      if (event.repeat) {
        return;
      }
      if (current === mode) {
        closePalette();
      } else {
        openPalette(mode);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}

export function CommandPalette() {
  const mode = usePaletteMode();
  usePaletteShortcuts();

  if (!mode) {
    return null;
  }
  return <PaletteDialog mode={mode} />;
}

function threadLocation(thread: CommentThread): string {
  if (thread.filePath.startsWith(PATH_PREFIX)) {
    const path = thread.filePath.slice(PATH_PREFIX.length);
    return path === '__root__' ? 'Repository' : path;
  }
  return `${thread.filePath.split('/').pop()} ${getThreadLineLabel(thread)}`;
}

function Highlight(props: { text: string; positions: number[] }) {
  const { text, positions } = props;
  if (positions.length === 0) {
    return text;
  }
  return highlightSegments(text, positions).map((segment, index) => (
    segment.match
      ? <mark key={index} className="bg-transparent text-accent font-semibold">{segment.text}</mark>
      : <span key={index}>{segment.text}</span>
  ));
}

/** The file name, then its folder in muted text, with matches in either highlighted. */
function PathTitle(props: { path: string; positions: number[] }) {
  const { path, positions } = props;
  const cut = path.lastIndexOf('/') + 1;
  const dir = cut > 0 ? path.slice(0, cut - 1) : '';

  return (
    <span className="font-mono">
      <span className="text-text">
        <Highlight text={path.slice(cut)} positions={positions.filter((index) => index >= cut).map((index) => index - cut)} />
      </span>
      {dir && (
        <span className="ml-2 text-text-muted">
          <Highlight text={dir} positions={positions.filter((index) => index < dir.length)} />
        </span>
      )}
    </span>
  );
}

function FileDetail(props: { file: PaletteFile }) {
  const { file } = props;

  return (
    <>
      {!!file.comments && (
        <span className="inline-flex items-center gap-1" title={`${file.comments} open comment${file.comments === 1 ? '' : 's'}`}>
          <CommentIcon className="w-3 h-3" />
          {file.comments}
        </span>
      )}
      {!!file.additions && <span className="font-mono text-diff-added">+{file.additions}</span>}
      {!!file.deletions && <span className="font-mono text-diff-deleted">-{file.deletions}</span>}
      {file.viewed && <span>viewed</span>}
    </>
  );
}

function PaletteDialog(props: { mode: PaletteMode }) {
  const { mode } = props;
  const { actions, view } = usePaletteState();
  const navigate = useNavigate();
  const navigateToRef = useNavigateToRef();
  const { pathname, search } = useLocation();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const commands = mode === 'commands';

  const { data: status } = useQuery({ ...statusOptions(), enabled: commands });
  const { data: commitPages } = useInfiniteQuery({ ...commitPagesOptions(''), enabled: commands });
  const { data: tree } = useQuery({ ...treePathsOptions(), enabled: !commands });

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
    setActive(0);
  }, [deferredQuery, mode]);

  const onDiff = pathname === '/diff';
  const currentRef = onDiff ? new URLSearchParams(search).get('ref') || 'work' : null;
  const repo = view?.repo ?? '';

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];
    if (!commands) {
      const editFile = view?.editor
        ? (path: string) => {
          void openInEditorWithToast(path);
        }
        : null;
      const inView = new Set<string>();
      for (const file of view?.files ?? []) {
        inView.add(file.path);
        list.push({
          id: `file:${file.path}`,
          group: view!.filesLabel,
          title: file.path,
          path: file.path,
          icon: <FileIcon className={cn(iconClass, 'text-text-muted')} />,
          detail: <FileDetail file={file} />,
          run: () => view!.openFile(file.path),
          alt: editFile ? () => editFile(file.path) : undefined,
        });
      }
      for (const path of tree?.paths ?? []) {
        if (inView.has(path)) {
          continue;
        }
        list.push({
          id: `file:${path}`,
          group: ALL_FILES_GROUP,
          title: path,
          path,
          icon: <FileIcon className={cn(iconClass, 'text-text-muted opacity-60')} />,
          run: () => navigate(`/tree?${new URLSearchParams({ path, type: 'file' })}`),
          alt: editFile ? () => editFile(path) : undefined,
        });
      }
      return list;
    }

    for (const action of Object.values(actions).flat()) {
      list.push({ ...action, group: action.group ?? 'Actions' });
    }

    if (onDiff) {
      list.push({
        id: 'view-tree',
        group: 'Go to',
        title: 'Switch to Files',
        keywords: 'browse repository tree tab',
        icon: <FileIcon className={iconClass} />,
        run: () => navigate(lastLocation('tree', search)),
      });
    } else {
      list.push({
        id: 'view-diff',
        group: 'Go to',
        title: 'Switch to Diff',
        keywords: 'review changes tab',
        icon: <GitCompareIcon className={iconClass} />,
        run: () => navigate(lastLocation('diff', search)),
      });
    }

    const goToRef = (ref: string) => {
      if (ref === currentRef) {
        return;
      }
      if (onDiff) {
        navigateToRef(ref);
      } else {
        navigate(`/diff?ref=${encodeURIComponent(ref)}`);
      }
    };
    const branch = status?.branch ?? null;
    const base = status?.base ?? null;
    const refs: { ref: string; count?: number; icon: ReactNode; keywords: string }[] = [
      { ref: 'work', count: status?.work, icon: <PencilIcon className={iconClass} />, keywords: 'working tree diff' },
      { ref: 'staged', count: status?.staged, icon: <PencilIcon className={iconClass} />, keywords: 'index' },
      { ref: 'unstaged', count: status?.unstaged, icon: <PencilIcon className={iconClass} />, keywords: 'working tree' },
    ];
    if (base) {
      refs.push({ ref: base, icon: <GitCompareIcon className={iconClass} />, keywords: 'branch base compare' });
    }
    for (const entry of refs) {
      if (entry.ref !== 'work' && entry.count === 0) {
        continue;
      }
      const current = entry.ref === currentRef || (entry.ref === 'work' && currentRef === '.');
      list.push({
        id: entry.ref === base ? 'ref:branch' : `ref:${entry.ref}`,
        group: 'Go to',
        title: refLabel(entry.ref, branch, base).label,
        keywords: entry.keywords,
        icon: entry.icon,
        detail: current ? <CheckIcon className={iconClass} /> : entry.count !== undefined && <span className="tabular-nums">{entry.count}</span>,
        run: () => goToRef(entry.ref),
      });
    }

    const viewedCommit = currentRef ? parseCommitRef(currentRef)?.toLowerCase() : null;
    for (const commit of commitPages?.pages[0]?.commits.slice(0, MAX_COMMITS) ?? []) {
      list.push({
        id: `commit:${commit.hash}`,
        group: 'Commits',
        title: commit.message,
        keywords: `${commit.shortHash} ${commit.hash}`,
        icon: <GitCommitIcon className={iconClass} />,
        detail: (
          <>
            <code className="font-mono">{commit.shortHash}</code>
            <span className="whitespace-nowrap">{commit.relativeDate}</span>
            {viewedCommit && commit.hash.startsWith(viewedCommit) && <CheckIcon className={iconClass} />}
          </>
        ),
        run: () => goToRef(commitRef(commit.hash)),
      });
    }

    for (const thread of getUnresolvedFileThreads(view?.threads ?? [])) {
      const location = threadLocation(thread);
      list.push({
        id: `thread:${thread.id}`,
        group: 'Comments',
        title: getThreadPreview(thread),
        keywords: `${thread.filePath} ${thread.comments.map((comment) => comment.author.name).join(' ')}`,
        icon: <CommentIcon className={cn(iconClass, thread.comments[0]?.author.type === 'agent' && 'text-accent')} />,
        detail: <span className="font-mono truncate max-w-48">{location}</span>,
        run: () => view!.openThread(thread.id, thread.filePath),
      });
    }
    return list;
  }, [commands, actions, view, tree, onDiff, currentRef, search, status, commitPages, navigate, navigateToRef]);

  const rankOptions = useMemo(() => (commands
    ? { recent: recentActions(), groupOrder: COMMAND_GROUPS, limit: MAX_ROWS }
    : {
      recent: recentFiles(repo).map((path) => `file:${path}`),
      groupOrder: [view?.filesLabel ?? '', ALL_FILES_GROUP],
      fixedGroups: true,
      limit: MAX_ROWS,
    }), [commands, repo, view?.filesLabel]);
  const groups = useMemo(() => rankItems(rows, deferredQuery, rankOptions), [rows, deferredQuery, rankOptions]);

  const flat = groups.flatMap((group) => group.rows);
  const activeIndex = Math.min(active, flat.length - 1);
  const activeRow = flat[activeIndex]?.item;
  const optionId = (index: number) => `${listId}-${index}`;
  const canEdit = !commands && !!view?.editor;

  useEffect(() => {
    if (activeIndex <= 0) {
      listRef.current?.scrollTo({ top: 0 });
      return;
    }
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const choose = (row: Row | undefined, alt: boolean) => {
    if (!row) {
      return;
    }
    // Closing first gives focus back to where it was, before the row moves it.
    dialogRef.current?.close();
    closePalette();
    if (row.path) {
      rememberFile(repo, row.path);
    } else {
      rememberAction(row.id);
    }
    if (alt && row.alt) {
      row.alt();
    } else {
      row.run();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(Math.max(0, Math.min(flat.length - 1, activeIndex + step)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // The rows may still be ranked for an earlier query, Enter runs the best row for the one typed.
      const row = query === deferredQuery ? activeRow : rankItems(rows, query, rankOptions)[0]?.rows[0]?.item;
      choose(row, isModPressed(e));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    }
  };

  let index = -1;

  return (
    <dialog
      ref={dialogRef}
      aria-label={commands ? 'Command palette' : 'Go to file'}
      onCancel={(e) => {
        e.preventDefault();
        closePalette();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          closePalette();
        }
      }}
      className="fixed inset-0 h-fit w-[640px] max-w-[calc(100vw-2rem)] mx-auto mt-[12vh] p-0 bg-bg text-text border border-border rounded-xl shadow-lg overflow-hidden font-sans backdrop:bg-black/40"
    >
      <div
        className="flex flex-col max-h-[min(560px,72vh)]"
        onMouseDown={(e) => {
          if (e.target !== inputRef.current) {
            e.preventDefault();
          }
        }}
      >
        <div className="shrink-0 flex items-center gap-2.5 px-3.5 border-b border-border">
          {commands ? <SearchIcon className="w-4 h-4 shrink-0 text-text-muted" /> : <FileIcon className="w-4 h-4 shrink-0 text-text-muted" />}
          <input
            ref={inputRef}
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeRow ? optionId(activeIndex) : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={commands ? 'Search commands, refs, commits and comments' : 'Search files by name'}
            autoComplete="off"
            spellCheck={false}
            className="flex-1 min-w-0 h-11 bg-transparent text-sm text-text placeholder:text-text-muted focus:outline-none"
          />
        </div>
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={commands ? 'Commands' : 'Files'}
          className="flex-1 min-h-0 overflow-y-auto p-1.5 text-xs"
        >
          {flat.length === 0 && (
            <div className="px-3 py-6 text-center text-text-muted">{query ? 'No matches' : 'Nothing to show'}</div>
          )}
          {groups.map((group) => (
            <div key={group.group} role="group" aria-label={group.group}>
              <div role="presentation" className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-text-muted">{group.group}</div>
              {group.rows.map(({ item, positions }) => {
                index++;
                const rowIndex = index;
                const isActive = rowIndex === activeIndex;
                return (
                  <div
                    key={item.id}
                    id={optionId(rowIndex)}
                    role="option"
                    aria-selected={isActive}
                    onMouseMove={() => {
                      if (!isActive) {
                        setActive(rowIndex);
                      }
                    }}
                    onClick={(e) => choose(item, isModPressed(e))}
                    className={cn('flex items-center gap-2.5 h-8 px-2.5 rounded-md cursor-pointer', isActive && 'bg-active')}
                  >
                    <span className="flex w-4 justify-center shrink-0 text-text-secondary">{item.icon}</span>
                    <span className="flex-1 min-w-0 truncate text-text">
                      {item.path ? <PathTitle path={item.path} positions={positions} /> : <Highlight text={item.title} positions={positions} />}
                    </span>
                    {item.detail && <span className="shrink-0 flex items-center gap-2 text-[11px] text-text-muted">{item.detail}</span>}
                    {item.hint && <Kbd className="shrink-0">{item.hint}</Kbd>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="shrink-0 flex items-center gap-3 h-9 px-3.5 border-t border-border text-[11px] text-text-muted">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
          <span className="flex items-center gap-1"><Kbd>Enter</Kbd> {commands ? 'run' : 'open'}</span>
          {canEdit && <span className="flex items-center gap-1"><Kbd>{shortcutHint('palette-editor')}</Kbd> open in editor</span>}
          <span className="ml-auto flex items-center gap-1">
            <ModeButton mode="commands" current={mode} label="Commands" />
            <ModeButton mode="files" current={mode} label="Files" />
          </span>
        </div>
      </div>
    </dialog>
  );
}

function ModeButton(props: { mode: PaletteMode; current: PaletteMode; label: string }) {
  const { mode, current, label } = props;

  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={() => openPalette(mode)}
      className={cn(
        'flex items-center gap-1.5 h-6 px-1.5 rounded cursor-pointer transition-colors',
        mode === current ? 'bg-bg-tertiary text-text' : 'hover:bg-hover hover:text-text',
      )}
    >
      {label}
      <Kbd className="h-4 min-w-0 px-1 text-[10px]">{shortcutHint(mode === 'commands' ? 'palette' : 'go-to-file')}</Kbd>
    </button>
  );
}
