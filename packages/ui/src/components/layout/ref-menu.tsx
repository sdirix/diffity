import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type SVGProps } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { cn } from '../../lib/cn';
import type { Commit, RefLookup } from '../../lib/api';
import {
  commitRef,
  isBranchRef,
  isHash,
  looksLikeRef,
  parseCommitRef,
  refLabel,
  shortBase,
  shortRef,
  uncommittedTwins,
  type RefKind,
} from '../../lib/refs';
import { shortcutHint } from '../../lib/shortcuts';
import { usePaletteActions, type PaletteAction } from '../../hooks/use-palette';
import { commitPagesOptions } from '../../queries/commits';
import { refOptions, statusOptions } from '../../queries/refs';
import { repoInfoOptions } from '../../queries/info';
import { AuthorAvatar } from '../ui/author-avatar';
import { SegmentedToggle } from '../ui/segmented-toggle';
import { Skeleton } from '../ui/skeleton';
import { CheckIcon } from '../icons/check-icon';
import { ChevronDownIcon } from '../icons/chevron-down-icon';
import { GitCommitIcon } from '../icons/git-commit-icon';
import { GitCompareIcon } from '../icons/git-compare-icon';
import { PencilIcon } from '../icons/pencil-icon';
import { SearchIcon } from '../icons/search-icon';

const SEARCH_DEBOUNCE_MS = 200;

const KIND_ICONS: Record<RefKind, (props: SVGProps<SVGSVGElement>) => ReactNode> = {
  work: PencilIcon,
  branch: GitCompareIcon,
  commit: GitCommitIcon,
  range: GitCompareIcon,
  ref: GitCompareIcon,
};

interface NavigateToRefOptions {
  /** Scrolls the diff to this thread once it loads. */
  thread?: string;
  replace?: boolean;
}

/** Opens the diff of `ref`, keeping the other URL parameters except a thread to scroll to. */
export function useNavigateToRef() {
  const navigate = useNavigate();
  const { search } = useLocation();

  return useCallback((ref: string, options: NavigateToRefOptions = {}) => {
    const params = new URLSearchParams(search);
    params.delete('ref');
    params.delete('thread');
    if (options.thread) {
      params.set('thread', options.thread);
    }
    const rest = params.toString();
    navigate(`/diff?ref=${encodeURIComponent(ref).replace(/%2F/g, '/')}${rest ? `&${rest}` : ''}`, { replace: options.replace });
  }, [navigate, search]);
}

interface RefMenuProps {
  diffRef: string;
  branch: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RefMenu(props: RefMenuProps) {
  const { diffRef, branch, open, onOpenChange } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navigateToRef = useNavigateToRef();
  const { data: status } = useQuery(statusOptions());
  const commit = parseCommitRef(diffRef);
  const { data: lookup } = useQuery({ ...refOptions(commit ?? ''), enabled: !!commit });
  const { kind, label } = refLabel(diffRef, status?.branch ?? branch, status?.base ?? null);
  const Icon = KIND_ICONS[kind];

  useEffect(() => {
    if (!open) {
      return;
    }
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open, onOpenChange]);

  const close = useCallback(() => {
    onOpenChange(false);
    triggerRef.current?.focus();
  }, [onOpenChange]);

  const pick = useCallback((ref: string) => {
    close();
    if (ref !== diffRef) {
      navigateToRef(ref);
    }
  }, [close, diffRef, navigateToRef]);

  return (
    <div className="relative min-w-0 flex" ref={containerRef}>
      <button
        ref={triggerRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        title={`Choose what to review (${shortcutHint('ref-menu')})`}
        className={cn(
          'inline-flex items-center gap-1.5 min-w-0 max-w-[480px] px-2 py-0.5 rounded-md text-text-secondary hover:bg-hover hover:text-text transition-colors cursor-pointer',
          open ? 'bg-active text-text' : 'bg-bg-tertiary',
        )}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">
          {label}
          {lookup?.commit && <span className="text-text-muted"> · {lookup.commit.message}</span>}
        </span>
        <ChevronDownIcon className="w-3 h-3 shrink-0" />
      </button>
      {open && <RefMenuPanel diffRef={diffRef} onPick={pick} onClose={close} />}
    </div>
  );
}

/** Switches a single ref between including uncommitted changes (`main`) and committed only (`main...HEAD`). */
export function UncommittedToggle(props: { diffRef: string }) {
  const { diffRef } = props;
  const { data: status } = useQuery(statusOptions());
  const navigateToRef = useNavigateToRef();
  const twins = uncommittedTwins(diffRef);
  const shown = !!twins && !!status && status.work > 0;

  const paletteActions = useMemo<PaletteAction[]>(() => {
    if (!shown) {
      return [];
    }
    return diffRef === twins.all
      ? [{ id: 'committed-only', title: 'Leave out uncommitted changes', group: 'View', keywords: 'committed only', run: () => navigateToRef(twins.committed) }]
      : [{ id: 'all-changes', title: 'Include uncommitted changes', group: 'View', keywords: 'all changes', run: () => navigateToRef(twins.all) }];
  }, [shown, diffRef, navigateToRef]);
  usePaletteActions('uncommitted', paletteActions);

  if (!shown) {
    return null;
  }

  return (
    <SegmentedToggle
      options={[
        { value: twins.all, label: 'All changes', title: 'Include uncommitted changes' },
        { value: twins.committed, label: 'Committed only', title: 'Leave out uncommitted changes' },
      ]}
      value={diffRef}
      onChange={navigateToRef}
    />
  );
}

interface Entry {
  key: string;
  ref: string;
}

interface RefMenuPanelProps {
  diffRef: string;
  onPick: (ref: string) => void;
  onClose: () => void;
}

const WORK_SEGMENTS = [
  { ref: 'work', label: 'All', title: 'Staged, unstaged and new files' },
  { ref: 'staged', label: 'Staged', title: 'Changes in the index' },
  { ref: 'unstaged', label: 'Unstaged', title: 'Changes not in the index' },
] as const;

/** The ref to open for what was typed: the commit for a hash, else the ref itself. */
function typedRef(term: string, lookup: RefLookup): string {
  return lookup.commit && isHash(term) ? commitRef(lookup.commit.hash) : term;
}

function RefMenuPanel(props: RefMenuPanelProps) {
  const { diffRef, onPick, onClose } = props;
  const queryClient = useQueryClient();
  const { data: status } = useQuery(statusOptions());
  const { data: info } = useQuery(repoInfoOptions(diffRef));
  const onGitHub = !!info?.github;
  const listId = useId();
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(-1);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const trimmed = search.trim();

  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(trimmed), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [trimmed]);

  useEffect(() => {
    setActive(-1);
  }, [term]);

  const commitsQuery = useInfiniteQuery({ ...commitPagesOptions(term), placeholderData: keepPreviousData });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = commitsQuery;
  const commits = commitsQuery.data?.pages.flatMap((page) => page.commits) ?? [];
  const lookupQuery = useQuery({ ...refOptions(term), enabled: !!term });
  const lookup = term ? lookupQuery.data : undefined;
  const lookupError = term && looksLikeRef(term) && lookupQuery.error ? lookupQuery.error.message : null;
  const error = submitError ?? lookupError;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
        void fetchNextPage();
      }
    }, { root: scrollerRef.current, rootMargin: '0px 0px 160px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const showDefaults = !trimmed;
  const base = status?.base ?? null;
  const selectedCommit = parseCommitRef(diffRef)?.toLowerCase() ?? null;

  const entries: Entry[] = [];
  if (showDefaults) {
    for (const segment of WORK_SEGMENTS) {
      if (segment.ref === 'work' || !status || status[segment.ref] > 0) {
        entries.push({ key: segment.ref, ref: segment.ref });
      }
    }
    if (base) {
      entries.push({ key: 'branch', ref: base });
    }
  }
  if (lookup) {
    const primary = typedRef(term, lookup);
    entries.push({ key: 'typed', ref: primary });
    if (lookup.commit) {
      entries.push({ key: 'typed-alt', ref: primary === term ? commitRef(lookup.commit.hash) : term });
    }
  }
  for (const commit of commits) {
    entries.push({ key: `commit:${commit.hash}`, ref: commitRef(commit.hash) });
  }

  const indexByKey = new Map(entries.map((entry, index) => [entry.key, index]));
  const indexOf = (key: string) => indexByKey.get(key) ?? -1;
  const selectedIndex = entries.findIndex((entry) => entry.ref === diffRef);
  const autoIndex = showDefaults ? Math.max(0, selectedIndex) : 0;
  const activeIndex = Math.min(active >= 0 ? active : autoIndex, entries.length - 1);
  const activeEntry = entries[activeIndex];
  const optionId = (key: string) => `${listId}-${key}`;

  useEffect(() => {
    if (activeEntry) {
      document.getElementById(optionId(activeEntry.key))?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeEntry?.key]);

  const optionProps = (key: string, ref: string) => {
    const index = indexOf(key);
    return {
      id: optionId(key),
      role: 'option',
      'aria-selected': index === activeIndex,
      onMouseMove: () => {
        if (index !== activeIndex) {
          setActive(index);
        }
      },
      onClick: () => onPick(ref),
    };
  };

  const submit = async () => {
    if (trimmed && looksLikeRef(trimmed) && (trimmed !== term || !lookup)) {
      try {
        const result = await queryClient.fetchQuery(refOptions(trimmed));
        onPick(typedRef(trimmed, result));
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (trimmed !== term) {
      setTerm(trimmed);
      return;
    }
    if (activeEntry) {
      onPick(activeEntry.ref);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(Math.max(0, Math.min(entries.length - 1, activeIndex + step)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') {
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Choose what to review"
      className="absolute left-0 top-full mt-1 w-[440px] max-w-[calc(100vw-2rem)] flex flex-col max-h-[min(540px,75vh)] bg-bg-secondary rounded-md shadow-lg ring-1 ring-border z-50 overflow-hidden text-xs"
    >
      <div className="shrink-0 flex items-center gap-2 px-2.5 border-b border-border">
        <SearchIcon className="w-3.5 h-3.5 shrink-0 text-text-muted" />
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeEntry ? optionId(activeEntry.key) : undefined}
          aria-invalid={!!error}
          aria-describedby={error ? `${listId}-error` : undefined}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSubmitError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search commits, or type a ref or range"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 min-w-0 h-9 bg-transparent text-text placeholder:text-text-muted focus:outline-none"
        />
      </div>
      {error && (
        <div id={`${listId}-error`} role="alert" className="shrink-0 px-3 py-1.5 border-b border-border text-deleted bg-deleted/5 truncate" title={error}>
          {error}
        </div>
      )}
      <div
        ref={scrollerRef}
        id={listId}
        role="listbox"
        aria-label="Refs"
        className="flex-1 min-h-0 overflow-y-auto p-1"
        onMouseDown={(e) => e.preventDefault()}
      >
        {showDefaults && (
          <div role="group" aria-label="Uncommitted changes" className="flex items-center gap-2 h-8 pl-2.5 pr-1 rounded-md">
            <PencilIcon className="w-3.5 h-3.5 shrink-0 text-text-secondary" />
            <span className="flex-1 min-w-0 truncate cursor-pointer text-text" onClick={() => onPick('work')}>
              {status?.work === 0 ? 'No uncommitted changes' : 'Uncommitted changes'}
            </span>
            <span className="flex items-center gap-0.5 shrink-0">
              {WORK_SEGMENTS.map((segment) => {
                const count = status?.[segment.ref];
                const disabled = segment.ref !== 'work' && count === 0;
                const isCurrent = diffRef === segment.ref || (segment.ref === 'work' && diffRef === '.');
                const index = indexOf(segment.ref);
                return (
                  <span
                    key={segment.ref}
                    title={segment.title}
                    className={cn(
                      'inline-flex items-center gap-1 h-6 px-1.5 rounded',
                      disabled ? 'text-text-muted/60 cursor-default' : 'cursor-pointer',
                      !disabled && (isCurrent ? 'bg-bg text-text ring-1 ring-border font-medium' : 'text-text-secondary hover:text-text'),
                      index >= 0 && index === activeIndex && !isCurrent && 'bg-hover text-text',
                      index >= 0 && index === activeIndex && isCurrent && 'ring-accent',
                    )}
                    {...(disabled ? { role: 'option', 'aria-disabled': true, 'aria-selected': false } : optionProps(segment.ref, segment.ref))}
                  >
                    {segment.label}
                    {count !== undefined && <span className="tabular-nums text-text-muted">{count}</span>}
                  </span>
                );
              })}
            </span>
          </div>
        )}

        {showDefaults && base && (
          <>
            <SectionLabel>Branch</SectionLabel>
            <Row
              {...optionProps('branch', base)}
              active={indexOf('branch') === activeIndex}
              selected={isBranchRef(diffRef, base)}
              icon={<GitCompareIcon className="w-3.5 h-3.5" />}
              title={`${status?.branch ?? 'HEAD'} vs ${shortBase(base)}`}
              hint={`Since it split from ${base}, uncommitted changes included`}
            />
          </>
        )}

        {lookup && (
          <>
            <SectionLabel>Ref</SectionLabel>
            {(['typed', 'typed-alt'] as const).map((key) => {
              const entry = entries[indexOf(key)];
              if (!entry) {
                return null;
              }
              return (
                <TypedRow
                  key={key}
                  {...optionProps(key, entry.ref)}
                  term={term}
                  refValue={entry.ref}
                  commit={lookup.commit}
                  active={indexOf(key) === activeIndex}
                  selected={entry.ref === diffRef}
                />
              );
            })}
          </>
        )}

        {(!term || !looksLikeRef(term) || commits.length > 0) && (
          <SectionLabel>{term ? 'Matching commits' : 'Commits'}</SectionLabel>
        )}
        {commitsQuery.isPending && <CommitRowsSkeleton rows={4} />}
        {commitsQuery.isError && (
          <div className="px-2.5 h-8 flex items-center text-deleted">{commitsQuery.error.message}</div>
        )}
        {commitsQuery.isSuccess && commits.length === 0 && !(term && looksLikeRef(term)) && (
          <div className="px-2.5 h-8 flex items-center text-text-muted">{term ? `No commit messages match “${term}”` : 'No commits yet'}</div>
        )}
        {commits.map((commit) => {
          const key = `commit:${commit.hash}`;
          return (
            <CommitRow
              key={commit.hash}
              {...optionProps(key, commitRef(commit.hash))}
              commit={commit}
              onGitHub={onGitHub}
              active={indexOf(key) === activeIndex}
              selected={!!selectedCommit && commit.hash.startsWith(selectedCommit)}
            />
          );
        })}
        <div ref={sentinelRef} />
        {isFetchingNextPage && <CommitRowsSkeleton rows={2} />}
      </div>
    </div>
  );
}

function SectionLabel(props: { children: ReactNode }) {
  return (
    <div role="presentation" className="px-2.5 pt-2.5 pb-1 text-[11px] font-medium text-text-muted">
      {props.children}
    </div>
  );
}

interface RowProps extends React.HTMLAttributes<HTMLDivElement> {
  active: boolean;
  selected: boolean;
  icon: ReactNode;
  title: string;
  hint?: ReactNode;
}

function Row(props: RowProps) {
  const { active, selected, icon, title, hint, className, ...rest } = props;

  return (
    <div
      {...rest}
      className={cn(
        'flex items-center gap-2.5 min-h-8 px-2.5 py-1 rounded-md cursor-pointer',
        active && 'bg-hover',
        className,
      )}
    >
      <span className={cn('flex shrink-0', selected ? 'text-text' : 'text-text-secondary')}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className={cn('block truncate text-text', selected && 'font-medium')}>{title}</span>
        {hint && <span className="block truncate text-[11px] text-text-muted">{hint}</span>}
      </span>
      <span className="w-3.5 shrink-0 flex">{selected && <CheckIcon className="w-3.5 h-3.5 text-text-secondary" />}</span>
    </div>
  );
}

interface TypedRowProps extends React.HTMLAttributes<HTMLDivElement> {
  term: string;
  refValue: string;
  commit: Commit | null;
  active: boolean;
  selected: boolean;
}

function TypedRow(props: TypedRowProps) {
  const { term, refValue, commit, ...rest } = props;
  const isCommit = !!commit && parseCommitRef(refValue) !== null;
  const { kind, label } = refLabel(refValue, null, null);
  const Icon = KIND_ICONS[isCommit ? 'commit' : kind];

  return (
    <Row
      {...rest}
      icon={<Icon className="w-3.5 h-3.5" />}
      title={isCommit ? `Commit ${commit.shortHash}` : label}
      hint={isCommit ? commit.message : <span className="font-mono">{shortRef(term)}</span>}
    />
  );
}

interface CommitRowProps extends React.HTMLAttributes<HTMLDivElement> {
  commit: Commit;
  /** The repository is on GitHub, so author avatars can be looked up by email. */
  onGitHub: boolean;
  active: boolean;
  selected: boolean;
}

const COMMIT_WIDTHS = ['70%', '45%', '60%', '35%'];

function CommitRowsSkeleton(props: { rows: number }) {
  const { rows } = props;

  return Array.from({ length: rows }, (_, index) => (
    <div key={index} className="flex items-center gap-2.5 h-8 px-2.5">
      <Skeleton className="w-[52px] h-2.5" />
      <span className="flex-1 min-w-0">
        <Skeleton className="h-3" style={{ width: COMMIT_WIDTHS[index % COMMIT_WIDTHS.length] }} />
      </span>
      <Skeleton className="w-20 h-2.5" />
      <Skeleton className="w-14 h-2.5" />
      <span className="w-3.5 shrink-0" />
    </div>
  ));
}

function CommitRow(props: CommitRowProps) {
  const { commit, onGitHub, active, selected, className, ...rest } = props;

  return (
    <div
      {...rest}
      title={`${commit.message}\n${commit.shortHash} by ${commit.authorName}, ${commit.relativeDate}`}
      className={cn('flex items-center gap-2.5 h-8 px-2.5 rounded-md cursor-pointer', active && 'bg-hover', className)}
    >
      <code className="shrink-0 w-[52px] font-mono text-[11px] text-text-muted">{commit.shortHash}</code>
      <span className={cn('flex-1 min-w-0 truncate text-text', selected && 'font-medium')}>{commit.message}</span>
      <span className="shrink-0 max-w-[140px] flex items-center gap-1.5 text-[11px] text-text-secondary">
        <AuthorAvatar name={commit.authorName} email={commit.authorEmail} onGitHub={onGitHub} />
        <span className="truncate">{commit.authorName}</span>
      </span>
      <span className="shrink-0 text-[11px] text-text-muted whitespace-nowrap">{commit.relativeDate}</span>
      <span className="w-3.5 shrink-0 flex">{selected && <CheckIcon className="w-3.5 h-3.5 text-text-secondary" />}</span>
    </div>
  );
}
