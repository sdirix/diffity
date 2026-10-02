import { useState, useCallback, useMemo } from 'react';
import type { ParsedDiff } from '@diffity/parser';
import { getFilePath } from '../../lib/diff-utils';
import { UnifiedViewIcon } from '../icons/unified-view-icon';
import { SplitViewIcon } from '../icons/split-view-icon';
import { SegmentedToggle } from '../ui/segmented-toggle';
import { EyeIcon } from '../icons/eye-icon';
import { EyeOffIcon } from '../icons/eye-off-icon';
import { KeyboardIcon } from '../icons/keyboard-icon';
import { ContrastIcon } from '../icons/contrast-icon';
import { GitBranchIcon } from '../icons/git-branch-icon';
import { GitHubIcon } from '../icons/github-icon';
import { CommentIcon } from '../icons/comment-icon';
import { DiffStats } from '../diff/diff-stats';
import { HiddenFilesChip } from '../diff/hidden-files-chip';
import { GitHubDialog } from './github-dialog';
import { SubmitReviewDialog } from './submit-review-dialog';
import { CommentToolbarActions } from '../comments/comment-toolbar-actions';
import { AgentToolbar } from '../agent/agent-toolbar';
import { OptionsMenu, menuItemClass } from './options-menu';
import { RefMenu, UncommittedToggle } from './ref-menu';
import { ViewTabs } from './view-tabs';
import { InstanceSwitcher } from './instance-switcher';
import { GENERAL_THREAD_FILE_PATH } from '../comments/types';
import type { ViewMode } from '../../lib/diff-utils';
import type { GitHubDetails } from '../../lib/api';
import type { CommentThread } from '../comments/types';
import { isThreadResolved } from '../comments/types';
import { shortcutHint } from '../../lib/shortcuts';
import { usePaletteActions, type PaletteAction } from '../../hooks/use-palette';
import { setDiffPalette, useDiffPalette } from '../../lib/diff-palette';
import { cn } from '../../lib/cn';

interface ToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  hideWhitespace: boolean;
  onHideWhitespaceChange: (hide: boolean) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onShowHelp: () => void;
  diff?: ParsedDiff;
  diffRef: string;
  refMenuOpen: boolean;
  onRefMenuOpenChange: (open: boolean) => void;
  threads: CommentThread[];
  onDeleteAllComments: () => void;
  onScrollToThread: (threadId: string, filePath: string) => void;
  repoName: string | null;
  branch: string | null;
  githubDetails?: GitHubDetails | null;
  hiddenFiles?: { files: string[]; showing: boolean; onShowingChange: (showing: boolean) => void };
  /** Shows the comments panel toggle when set. */
  commentsPanel?: { open: boolean; openCount: number; onToggle: () => void };
}

function extractCodeContext(diff: ParsedDiff | undefined, filePath: string, side: 'old' | 'new', startLine: number, endLine: number): string[] {
  if (!diff) {
    return [];
  }

  const file = diff.files.find(f => getFilePath(f) === filePath);
  if (!file) {
    return [];
  }

  const lines: string[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      const lineNum = side === 'old' ? line.oldLineNumber : line.newLineNumber;
      if (lineNum !== null && lineNum >= startLine && lineNum <= endLine) {
        const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';
        lines.push(`${prefix} ${line.content}`);
      }
    }
  }

  return lines;
}

function formatThreadsForCopy(threads: CommentThread[], diff?: ParsedDiff, diffRef?: string): string {
  const unresolvedThreads = threads.filter(t => !isThreadResolved(t));
  if (unresolvedThreads.length === 0) {
    return '';
  }

  const parts: string[] = [];

  if (diffRef) {
    parts.push(`Diff ref: ${diffRef}`);
    parts.push('');
  }

  for (const thread of unresolvedThreads) {
    if (thread.filePath === GENERAL_THREAD_FILE_PATH) {
      parts.push('## General comment');
    } else if (thread.startLine === 0) {
      parts.push(`## ${thread.filePath} (whole file)`);
    } else {
      const lineRange = thread.startLine === thread.endLine
        ? `${thread.startLine}`
        : `${thread.startLine}-${thread.endLine}`;
      const sideDesc = thread.side === 'old' ? 'before change' : 'after change';
      parts.push(`## ${thread.filePath}:${lineRange} (${sideDesc})`);
    }

    const codeLines = extractCodeContext(diff, thread.filePath, thread.side, thread.startLine, thread.endLine);
    if (codeLines.length > 0) {
      parts.push('```diff');
      parts.push(...codeLines);
      parts.push('```');
    }

    const uniqueAuthors = new Set(thread.comments.map(c => c.author.name));
    const singleAuthor = uniqueAuthors.size === 1;

    for (const comment of thread.comments) {
      if (singleAuthor) {
        parts.push(comment.body);
      } else {
        const authorName = comment.author.name === 'You' ? 'User' : comment.author.name;
        parts.push(`**${authorName}:** ${comment.body}`);
      }
    }
    parts.push('');
  }

  return parts.join('\n');
}

export function Toolbar(props: ToolbarProps) {
  const {
    viewMode,
    onViewModeChange,
    hideWhitespace,
    onHideWhitespaceChange,
    theme,
    onToggleTheme,
    onShowHelp,
    diff,
    diffRef,
    refMenuOpen,
    onRefMenuOpenChange,
    threads,
    onDeleteAllComments,
    onScrollToThread,
    repoName,
    branch,
    githubDetails,
    hiddenFiles,
    commentsPanel,
  } = props;
  const [showGitHub, setShowGitHub] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const canReview = githubDetails?.state === 'OPEN';
  const diffPalette = useDiffPalette();

  const paletteActions = useMemo<PaletteAction[]>(() => {
    if (!githubDetails) {
      return [];
    }
    const list: PaletteAction[] = [{
      id: 'github-pr',
      title: `Pull request #${githubDetails.number}`,
      keywords: `github pr sync pull review threads comments ${githubDetails.title}`,
      icon: <GitHubIcon className="w-3.5 h-3.5" />,
      run: () => setShowGitHub(true),
    }];
    if (githubDetails.state === 'OPEN') {
      list.push({
        id: 'github-review',
        title: `Submit review to #${githubDetails.number}`,
        group: 'Comments',
        keywords: 'github pr post approve request changes',
        icon: <GitHubIcon className="w-3.5 h-3.5" />,
        run: () => setShowReview(true),
      });
    }
    return list;
  }, [githubDetails]);
  usePaletteActions('github', paletteActions);

  const formatForCopy = useCallback(() => {
    return formatThreadsForCopy(threads, diff, diffRef);
  }, [threads, diff, diffRef]);

  const viewModeOptions = useMemo(() => [
    { value: 'unified' as ViewMode, label: 'Unified', icon: <UnifiedViewIcon className="w-3.5 h-3.5" /> },
    { value: 'split' as ViewMode, label: 'Split', icon: <SplitViewIcon className="w-3.5 h-3.5" /> },
  ], []);

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 bg-bg-secondary border-b border-border font-sans text-xs">
      <div className="flex items-center gap-2.5 min-w-0 shrink">
        {repoName && <span className="font-semibold text-text text-sm truncate">{repoName}</span>}
        <InstanceSwitcher />
        <ViewTabs current="diff" />
        {branch && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-diff-hunk-bg text-diff-hunk-text rounded font-mono text-[11px] shrink-0">
            <GitBranchIcon className="w-3 h-3" />
            {branch}
          </span>
        )}
        <RefMenu diffRef={diffRef} branch={branch} open={refMenuOpen} onOpenChange={onRefMenuOpenChange} />
        <UncommittedToggle diffRef={diffRef} />
        {diff && (
          <span className="inline-flex items-center bg-bg-tertiary rounded-md overflow-hidden text-text-muted shrink-0">
            <span className="px-2 py-0.5">{diff.stats.filesChanged} file{diff.stats.filesChanged !== 1 ? 's' : ''} changed</span>
            <span className="px-2 py-0.5">
              <DiffStats additions={diff.stats.totalAdditions} deletions={diff.stats.totalDeletions} />
            </span>
          </span>
        )}
        {hiddenFiles && <HiddenFilesChip {...hiddenFiles} />}
        {githubDetails && (
          <button
            onClick={() => setShowGitHub(true)}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-bg-tertiary rounded-md font-mono text-[11px] text-text-muted hover:text-text transition-colors cursor-pointer shrink-0"
          >
            <GitHubIcon className="w-3 h-3" />
            #{githubDetails.number}
          </button>
        )}
        {canReview && (
          <button
            onClick={() => setShowReview(true)}
            className="px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors cursor-pointer shrink-0"
            title={`Post your comments as a review of #${githubDetails!.number}`}
          >
            Review
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 ml-auto shrink-0">
        <AgentToolbar diffRef={diffRef} hasChanges={!!diff && diff.files.length > 0} threads={threads} />
        <SegmentedToggle options={viewModeOptions} value={viewMode} onChange={onViewModeChange} />
        <CommentToolbarActions
          threads={threads}
          onScrollToThread={onScrollToThread}
          onDeleteAllComments={onDeleteAllComments}
          formatForCopy={formatForCopy}
        />
        {commentsPanel && (
          <button
            onClick={commentsPanel.onToggle}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors cursor-pointer',
              commentsPanel.open
                ? 'bg-accent/15 text-accent'
                : 'bg-bg-tertiary text-text-secondary hover:bg-hover hover:text-text',
            )}
            title={`${commentsPanel.open ? 'Hide' : 'Show'} comments panel (${shortcutHint('comments-panel')})`}
            aria-pressed={commentsPanel.open}
            aria-label={`Comments panel, ${commentsPanel.openCount} open`}
          >
            <CommentIcon className="w-3.5 h-3.5" />
            <span className="tabular-nums">{commentsPanel.openCount}</span>
          </button>
        )}
        <OptionsMenu
          theme={theme}
          onToggleTheme={onToggleTheme}
          renderExtraItems={(close) => (
            <>
              <button
                className={menuItemClass}
                onClick={() => {
                  onHideWhitespaceChange(!hideWhitespace);
                  close();
                }}
              >
                {hideWhitespace ? <EyeOffIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
                {hideWhitespace ? 'Show whitespace' : 'Hide whitespace'}
                {hideWhitespace && <span className="ml-auto text-accent text-[10px]">On</span>}
              </button>
              <button
                className={menuItemClass}
                onClick={() => {
                  setDiffPalette(diffPalette === 'colorblind' ? 'default' : 'colorblind');
                  close();
                }}
              >
                <ContrastIcon className="w-3.5 h-3.5" />
                Colour-blind colours
                {diffPalette === 'colorblind' && <span className="ml-auto text-accent text-[10px]">On</span>}
              </button>
              <button
                className={menuItemClass}
                onClick={() => {
                  onShowHelp();
                  close();
                }}
              >
                <KeyboardIcon className="w-3.5 h-3.5" />
                Keyboard shortcuts
                <span className="ml-auto text-text-muted">{shortcutHint('shortcuts')}</span>
              </button>
            </>
          )}
        />
      </div>
      {showGitHub && githubDetails && (
        <GitHubDialog
          details={githubDetails}
          diffRef={diffRef}
          onSubmitReview={() => {
            setShowGitHub(false);
            setShowReview(true);
          }}
          onClose={() => setShowGitHub(false)}
        />
      )}
      {showReview && githubDetails && (
        <SubmitReviewDialog details={githubDetails} branch={branch} onClose={() => setShowReview(false)} />
      )}
    </div>
  );
}
