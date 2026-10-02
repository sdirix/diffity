import { useSyncExternalStore, type ReactNode } from 'react';
import { queryClient } from '../../lib/query-client';
import { Skeleton, useElapsed } from '../ui/skeleton';

const LINE_WIDTHS = [62, 48, 74, 30, 56, 68, 40, 80, 52, 36, 64, 44];
/** Indent of each file list row: a folder, its files, then another folder. */
const LIST_DEPTHS = [0, 1, 1, 2, 2, 1, 0, 1, 1];

function width(index: number, scale = 1): string {
  return `${LINE_WIDTHS[index % LINE_WIDTHS.length] * scale}%`;
}

/** What the page is waiting for, by query key, in the order the page loads them. */
const LOADING_STEPS: [string, string][] = [
  ['repo-info', 'Reading the repository'],
  ['tree-info', 'Reading the repository'],
  ['diff', 'Loading changes'],
  ['tree-paths', 'Listing files'],
  ['tree-entries', 'Listing files'],
  ['tree-file-content', 'Loading the file'],
  ['file-content', 'Loading the file'],
  ['threads', 'Loading comments'],
];

function subscribeToQueries(onChange: () => void) {
  return queryClient.getQueryCache().subscribe(onChange);
}

function currentStep(): string | null {
  for (const [key, label] of LOADING_STEPS) {
    if (queryClient.isFetching({ queryKey: [key] }) > 0) {
      return label;
    }
  }
  return null;
}

/** Names the step a slow load is on. Shows after a second, so most loads never see it. */
function LoadingStep() {
  const slow = useElapsed(1000);
  const step = useSyncExternalStore(subscribeToQueries, currentStep, () => null);

  if (!slow || !step) {
    return null;
  }
  return (
    <div role="status" className="reveal absolute left-1/2 top-6 -translate-x-1/2 px-3 py-1 rounded-full border border-border bg-bg-secondary text-xs text-text-secondary shadow-md">
      {step}…
    </div>
  );
}

function ToolbarSkeleton() {
  return (
    <div className="flex items-center gap-3 h-[41px] shrink-0 px-4 bg-bg-secondary border-b border-border">
      <Skeleton className="w-24 h-4" />
      <Skeleton className="w-[90px] h-6 rounded-md" />
      <Skeleton className="w-14 h-4" />
      <Skeleton className="w-40 h-5 rounded-md" />
      <Skeleton className="ml-auto w-[140px] h-7 rounded-md" />
      <Skeleton className="w-7 h-7 rounded-md" />
    </div>
  );
}

/** Rows of the file list, as the sidebars of the diff and the tree show them. */
function FileListSkeleton(props: { rows?: number }) {
  const { rows = LIST_DEPTHS.length } = props;

  return (
    <div className="py-1">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-1.5 h-7 pr-2" style={{ paddingLeft: LIST_DEPTHS[index % LIST_DEPTHS.length] * 12 + 8 }}>
          <Skeleton className="w-4 h-4" />
          <Skeleton className="h-3" style={{ width: width(index, 0.6) }} />
        </div>
      ))}
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <aside className="w-72 min-w-72 border-r border-border bg-bg-secondary flex flex-col overflow-hidden">
      <div className="flex items-center h-[43px] shrink-0 px-3 border-b border-border">
        <Skeleton className="w-14 h-3" />
      </div>
      <div className="px-3 py-2">
        <Skeleton className="w-full h-8 rounded-md" />
      </div>
      <FileListSkeleton />
    </aside>
  );
}

function CodeLinesSkeleton(props: { lines: number }) {
  const { lines } = props;

  return (
    <div className="py-1">
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="flex items-center gap-6 h-6 px-3">
          <Skeleton className="w-6 h-2.5" />
          <Skeleton className="h-2.5" style={{ width: width(index * 5, 0.8) }} />
        </div>
      ))}
    </div>
  );
}

/** A file of the diff while it loads, with the header and lines of a real one. */
function FileBlockSkeleton(props: { lines?: number }) {
  const { lines = 6 } = props;

  return (
    <div className="border border-border rounded-lg mx-4 my-3 overflow-hidden">
      <div className="flex items-center gap-3 h-[30px] px-3 bg-bg-secondary border-b border-border-muted">
        <Skeleton className="w-3 h-3" />
        <Skeleton className="w-52 h-3" />
        <Skeleton className="ml-auto w-24 h-3" />
        <Skeleton className="w-14 h-3" />
      </div>
      <CodeLinesSkeleton lines={lines} />
    </div>
  );
}

/** The file viewer of the tree while the file loads. */
export function FileViewerSkeleton(props: { lines?: number }) {
  const { lines = 14 } = props;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <CodeLinesSkeleton lines={lines} />
    </div>
  );
}

/** The folder listing of the tree while it loads. */
export function FolderSkeleton(props: { rows?: number }) {
  const { rows = 6 } = props;

  return (
    <div className="border border-border/70 rounded-lg overflow-hidden">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={`flex items-center gap-2 h-9 px-4 ${index > 0 ? 'border-t border-border/70' : ''}`}>
          <Skeleton className="w-4 h-4" />
          <Skeleton className="h-3" style={{ width: width(index * 3, 0.4) }} />
        </div>
      ))}
    </div>
  );
}

function PageFrame(props: { children: ReactNode }) {
  const { children } = props;

  return (
    <div aria-busy className="flex flex-col h-screen bg-bg text-text font-sans">
      {children}
    </div>
  );
}

/** The diff page while the diff or its comments load. */
export function DiffSkeleton() {
  return (
    <PageFrame>
      <ToolbarSkeleton />
      <div className="relative flex flex-1 overflow-hidden">
        <SidebarSkeleton />
        <div className="relative flex-1 min-w-0 overflow-hidden py-2">
          {[8, 5, 6].map((lines, index) => <FileBlockSkeleton key={index} lines={lines} />)}
          <LoadingStep />
        </div>
      </div>
    </PageFrame>
  );
}

function TreeSkeleton(props: { file: boolean }) {
  const { file } = props;

  return (
    <PageFrame>
      <ToolbarSkeleton />
      <div className="flex flex-1 overflow-hidden">
        <SidebarSkeleton />
        <div className="relative flex-1 min-w-0 overflow-hidden p-6">
          <div className="flex items-center h-6 mb-2.5">
            <Skeleton className="w-48 h-3.5" />
          </div>
          {file ? <FileViewerSkeleton /> : <FolderSkeleton />}
          <LoadingStep />
        </div>
      </div>
    </PageFrame>
  );
}

function PreviewSkeleton() {
  return (
    <div aria-busy className="relative min-h-screen bg-bg">
      <div className="flex items-center gap-2 h-[33px] px-4 border-b border-border bg-bg-secondary">
        <Skeleton className="w-56 h-3" />
        <Skeleton className="w-20 h-4" />
      </div>
      <div className="p-12 space-y-4">
        <Skeleton className="w-1/3 h-6" />
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-3.5" style={{ width: width(index * 7, 1.2) }} />
        ))}
      </div>
      <LoadingStep />
    </div>
  );
}

function subscribeToNothing() {
  return () => {};
}

function currentHref(): string {
  return window.location.href;
}

/**
 * The page that is loading, in skeleton form. It starts as the diff page to
 * match the prerendered HTML and takes the shape of the URL once hydrated.
 */
export function PageSkeleton() {
  const href = useSyncExternalStore(subscribeToNothing, currentHref, () => null);
  const url = href ? new URL(href) : null;
  const path = url?.pathname ?? '/diff';

  if (path.startsWith('/preview')) {
    return <PreviewSkeleton />;
  }
  if (path.startsWith('/tree') || path.startsWith('/tour')) {
    return <TreeSkeleton file={path.startsWith('/tour') || url?.searchParams.get('type') === 'file'} />;
  }
  return <DiffSkeleton />;
}
