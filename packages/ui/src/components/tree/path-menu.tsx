import { ContextMenu, ContextMenuItem, ContextMenuSeparator, type MenuPosition } from '../ui/context-menu';
import { absolutePath, copyFileContents } from '../../lib/file-copy';
import { copyWithToast, openInEditorWithToast } from '../../lib/toast';
import { CodeIcon } from '../icons/code-icon';
import { CopyIcon } from '../icons/copy-icon';
import { FileIcon } from '../icons/file-icon';
import { CommentIcon } from '../icons/comment-icon';
import { CollapseAllIcon } from '../icons/collapse-all-icon';

const iconClass = 'w-3.5 h-3.5';

export interface PathMenuTarget {
  path: string;
  type: 'file' | 'dir';
  at: MenuPosition;
  binary?: boolean;
  /** Deleted in the diff, so there is nothing to open or copy. */
  deleted?: boolean;
}

interface PathMenuProps {
  target: PathMenuTarget;
  root: string;
  editor: boolean;
  loadContents: (path: string) => Promise<string[]>;
  onComment?: (path: string, type: 'file' | 'dir') => void;
  onCollapseOthers?: (path: string, type: 'file' | 'dir') => void;
  onClose: () => void;
}

export function PathMenu(props: PathMenuProps) {
  const { target, root, editor, loadContents, onComment, onCollapseOthers, onClose } = props;
  const { path, type, binary, deleted } = target;

  return (
    <ContextMenu position={target.at} label={path} onClose={onClose}>
      {editor && !deleted && (
        <>
          <ContextMenuItem
            icon={<CodeIcon className={iconClass} />}
            label="Open in editor"
            onSelect={() => void openInEditorWithToast(path)}
          />
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem
        icon={<CopyIcon className={iconClass} />}
        label="Copy relative path"
        onSelect={() => void copyWithToast(path, 'Copied relative path')}
      />
      <ContextMenuItem
        icon={<CopyIcon className={iconClass} />}
        label="Copy absolute path"
        onSelect={() => void copyWithToast(absolutePath(root, path), 'Copied absolute path')}
      />
      {type === 'file' && !deleted && (
        <ContextMenuItem
          icon={<FileIcon className={iconClass} />}
          label={binary ? 'Copy file contents (binary)' : 'Copy file contents'}
          disabled={binary}
          onSelect={() => void copyFileContents(path, () => loadContents(path))}
        />
      )}
      {(onComment || onCollapseOthers) && <ContextMenuSeparator />}
      {onComment && (
        <ContextMenuItem
          icon={<CommentIcon className={iconClass} />}
          label={type === 'file' ? 'Comment on this file' : 'Comment on this folder'}
          onSelect={() => onComment(path, type)}
        />
      )}
      {onCollapseOthers && (
        <ContextMenuItem
          icon={<CollapseAllIcon className={iconClass} />}
          label="Collapse other folders"
          onSelect={() => onCollapseOthers(path, type)}
        />
      )}
    </ContextMenu>
  );
}
