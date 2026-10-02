import type { FileNode, TreeNode } from '../../lib/file-tree';
import { cn } from '../../lib/cn';
import { StatusBadge } from '../ui/status-badge';
import { ChevronIcon } from '../icons/chevron-icon';
import { FolderIcon } from '../icons/folder-icon';
import { FileIcon } from '../icons/file-icon';
import { CommentIcon } from '../icons/comment-icon';
import { isMenuKey, menuPositionFor, type MenuPosition } from '../ui/context-menu';
import type { WorkingTreeStatus } from '../../lib/api';

const WORKING_STATUS: Record<WorkingTreeStatus, { letter: string; label: string; className: string }> = {
  modified: { letter: 'M', label: 'Modified', className: 'text-modified' },
  added: { letter: 'A', label: 'Added', className: 'text-diff-added' },
  deleted: { letter: 'D', label: 'Deleted', className: 'text-diff-deleted' },
  renamed: { letter: 'R', label: 'Renamed', className: 'text-diff-renamed' },
  untracked: { letter: 'U', label: 'Untracked', className: 'text-diff-added' },
  conflicted: { letter: '!', label: 'Conflicted', className: 'text-deleted' },
};

/** Height of a row in pixels, fixed so the list can be virtualized. */
export const ROW_HEIGHT = 28;

type MenuHandler = (node: TreeNode, at: MenuPosition) => void;

/** Right-click, the context menu key and Shift+F10 open the menu of `node`. */
function menuHandlersFor(node: TreeNode, onMenu: MenuHandler | undefined) {
  if (!onMenu) {
    return {};
  }
  return {
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      onMenu(node, menuPositionFor(e));
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (isMenuKey(e)) {
        e.preventDefault();
        onMenu(node, menuPositionFor(e));
      }
    },
  };
}

function fileRowClass(active: boolean, menuOpen: boolean, reviewed: boolean) {
  return cn(
    'flex items-center gap-1.5 w-full h-7 pr-2 text-left text-[13px] cursor-pointer border-l-2',
    active
      ? 'bg-active border-l-accent'
      : 'border-l-transparent hover:bg-hover',
    menuOpen && !active && 'bg-hover',
    reviewed && 'opacity-50'
  );
}

function FileBadges(props: { threadCount: number; reviewed: boolean; changedSinceViewed: boolean }) {
  const { threadCount, reviewed, changedSinceViewed } = props;

  return (
    <>
      {threadCount > 0 && (
        <span
          className="flex items-center gap-1 text-accent shrink-0"
          title={`${threadCount} open comment thread${threadCount === 1 ? '' : 's'}`}
        >
          <CommentIcon className="w-3 h-3" />
          <span className="text-[10px] font-semibold leading-none">{threadCount}</span>
        </span>
      )}
      {changedSinceViewed && (
        <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-modified" title="Changed since viewed" />
      )}
      {reviewed && (
        <span className="text-added text-[10px] shrink-0" title="Viewed">&#10003;</span>
      )}
    </>
  );
}

interface FileTreeRowProps {
  node: TreeNode;
  depth: number;
  expanded: boolean;
  active: boolean;
  reviewed?: boolean;
  /** Changed after it was marked viewed. */
  changedSinceViewed?: boolean;
  threadCount: number;
  /** Working tree status of a file. */
  status?: WorkingTreeStatus;
  /** A folder with changed files inside. */
  changed?: boolean;
  /** Hidden from diffs by `.diffityignore`. */
  diffHidden?: boolean;
  /** Its context menu is open. */
  menuOpen?: boolean;
  onToggleDir: (path: string) => void;
  onCollapseDir?: (path: string) => void;
  onFileClick: (path: string) => void;
  onMenu?: MenuHandler;
}

/** One folder or file of a tree, without its children. */
export function FileTreeRow(props: FileTreeRowProps) {
  const {
    node,
    depth,
    expanded,
    active,
    reviewed = false,
    changedSinceViewed = false,
    threadCount,
    status,
    changed = false,
    diffHidden = false,
    menuOpen = false,
    onToggleDir,
    onCollapseDir,
    onFileClick,
    onMenu,
  } = props;
  const paddingLeft = depth * 12 + 8;
  const menuHandlers = menuHandlersFor(node, onMenu);
  const hiddenTitle = diffHidden ? `${node.path}, hidden from diffs by .diffityignore` : undefined;

  if (node.type === 'dir') {
    const handleChevronClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onCollapseDir && expanded) {
        onCollapseDir(node.path);
      } else {
        onToggleDir(node.path);
      }
    };

    return (
      <button
        className={cn('flex items-center gap-1.5 w-full h-7 pr-2 text-left text-[13px] hover:bg-hover cursor-pointer', menuOpen && 'bg-hover')}
        style={{ paddingLeft: `${paddingLeft}px` }}
        onClick={() => onToggleDir(node.path)}
        title={hiddenTitle}
        {...menuHandlers}
      >
        <span onClick={handleChevronClick} className="relative flex items-center rounded p-0.5 hover:bg-border/70 transition-colors">
          <ChevronIcon expanded={expanded} />
        </span>
        <span className={cn('contents', diffHidden && '[&>*]:opacity-50')}>
          <FolderIcon open={expanded} />
          <span className="truncate text-text">{node.name}</span>
        </span>
        {changed && (
          <span className="ml-auto mr-1 w-1.5 h-1.5 shrink-0 rounded-full bg-modified" title="Contains changes" />
        )}
      </button>
    );
  }

  const statusInfo = status ? WORKING_STATUS[status] : null;

  return (
    <button
      className={fileRowClass(active, menuOpen, reviewed)}
      style={{ paddingLeft: `${paddingLeft + 15}px` }}
      onClick={() => onFileClick(node.path)}
      title={hiddenTitle}
      {...menuHandlers}
    >
      {node.file ? <StatusBadge status={node.file.status} compact /> : <FileIcon className={cn('w-4 h-4 shrink-0 text-text-muted', diffHidden && 'opacity-50')} />}
      <span className={cn('flex-1 min-w-0 truncate text-text', reviewed && 'line-through', diffHidden && 'opacity-50')}>
        {node.name}
      </span>
      <FileBadges threadCount={threadCount} reviewed={reviewed} changedSinceViewed={changedSinceViewed} />
      {statusInfo && (
        <span className={cn('w-3 shrink-0 text-center font-mono text-[11px] font-semibold', statusInfo.className)} title={statusInfo.label}>
          {statusInfo.letter}
        </span>
      )}
    </button>
  );
}

interface FlatFileRowProps {
  node: FileNode;
  active: boolean;
  reviewed: boolean;
  /** Changed after it was marked viewed. */
  changedSinceViewed: boolean;
  threadCount: number;
  menuOpen?: boolean;
  onFileClick: (path: string) => void;
  onMenu?: MenuHandler;
}

/** A file of a flat list, its name followed by its folder. */
export function FlatFileRow(props: FlatFileRowProps) {
  const { node, active, reviewed, changedSinceViewed, threadCount, menuOpen = false, onFileClick, onMenu } = props;
  const slash = node.path.lastIndexOf('/');
  const dir = slash > 0 ? node.path.slice(0, slash) : '';

  return (
    <button
      className={cn(fileRowClass(active, menuOpen, reviewed), 'pl-2')}
      title={node.path}
      onClick={() => onFileClick(node.path)}
      {...menuHandlersFor(node, onMenu)}
    >
      {node.file && <StatusBadge status={node.file.status} compact />}
      <span className="flex-1 min-w-0 flex items-baseline gap-1.5 overflow-hidden">
        <span className={cn('shrink-0 max-w-full truncate text-text', reviewed && 'line-through')}>{node.name}</span>
        {dir && (
          <span className="min-w-0 truncate text-xs text-text-muted" dir="rtl">
            <bdi>{dir}</bdi>
          </span>
        )}
      </span>
      <FileBadges threadCount={threadCount} reviewed={reviewed} changedSinceViewed={changedSinceViewed} />
    </button>
  );
}
