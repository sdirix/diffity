import { useEffect, useMemo, useState, useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import type { DiffFile } from '@diffity/parser';
import {
  buildFileTree,
  collapseSingleChildDirs,
  sortTree,
  filterTree,
  filterTreeToPaths,
  collectAllDirPaths,
  allDirsExpanded,
  visibleRows,
  rowPath,
  type FileNode,
  type TreeNode,
} from '../../lib/file-tree';
import { getFilePath } from '../../lib/diff-utils';
import { FileTreeRow, FlatFileRow } from './file-tree-row';
import { VirtualRows } from './virtual-rows';
import type { MenuPosition } from '../ui/context-menu';

interface FileTreeProps {
  files: DiffFile[];
  search: string;
  activeFile: string | null;
  reviewedFiles: Set<string>;
  commentCountsByFile: Map<string, number>;
  commentedFilesOnly: boolean;
  /** Lists the files by path in diff order instead of as a tree. */
  flat?: boolean;
  onFileClick: (path: string) => void;
  onExpandedStateChange?: (allExpanded: boolean) => void;
  onMenu?: (node: TreeNode, at: MenuPosition) => void;
  menuPath?: string | null;
}

export interface FileTreeHandle {
  expandAll: () => void;
  collapseAll: () => void;
}

export const FileTree = forwardRef<FileTreeHandle, FileTreeProps>(function FileTree(props, ref) {
  const {
    files,
    search,
    activeFile,
    reviewedFiles,
    commentCountsByFile,
    commentedFilesOnly,
    flat = false,
    onFileClick,
    onExpandedStateChange,
    onMenu,
    menuPath,
  } = props;

  const tree = useMemo(() => {
    return sortTree(collapseSingleChildDirs(buildFileTree(files)));
  }, [files]);

  const prevTreeRef = useRef(tree);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set(collectAllDirPaths(tree)));

  if (prevTreeRef.current !== tree) {
    prevTreeRef.current = tree;
    setExpandedDirs(new Set(collectAllDirPaths(tree)));
  }

  const commentedPaths = useMemo(
    () => new Set(commentCountsByFile.keys()),
    [commentCountsByFile],
  );

  const baseTree = useMemo(() => {
    if (!commentedFilesOnly) {
      return tree;
    }
    return filterTreeToPaths(tree, commentedPaths);
  }, [tree, commentedFilesOnly, commentedPaths]);

  const displayTree = useMemo(() => {
    if (!search) {
      return baseTree;
    }
    return filterTree(baseTree, search);
  }, [baseTree, search]);

  const effectiveExpandedDirs = useMemo(() => {
    if (search || commentedFilesOnly) {
      return new Set(collectAllDirPaths(displayTree));
    }
    return expandedDirs;
  }, [search, commentedFilesOnly, displayTree, expandedDirs]);

  const allDirPaths = useMemo(() => collectAllDirPaths(tree), [tree]);

  useImperativeHandle(ref, () => ({
    expandAll: () => setExpandedDirs(new Set(allDirPaths)),
    collapseAll: () => setExpandedDirs(new Set()),
  }), [allDirPaths]);

  useEffect(() => {
    if (!onExpandedStateChange || allDirPaths.length === 0) {
      return;
    }
    onExpandedStateChange(allDirsExpanded(allDirPaths, expandedDirs));
  }, [expandedDirs, allDirPaths, onExpandedStateChange]);

  const handleToggleDir = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const rows = useMemo(
    () => (flat ? [] : visibleRows(displayTree, effectiveExpandedDirs)),
    [flat, displayTree, effectiveExpandedDirs],
  );
  const flatNodes = useMemo<FileNode[]>(() => {
    if (!flat) {
      return [];
    }
    const lower = search.toLowerCase();
    return files
      .map((file): FileNode => {
        const path = getFilePath(file);
        return { type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, file };
      })
      .filter((node) => (!commentedFilesOnly || commentedPaths.has(node.path)) && (!lower || node.path.toLowerCase().includes(lower)));
  }, [flat, files, search, commentedFilesOnly, commentedPaths]);

  if (flat ? flatNodes.length === 0 : displayTree.length === 0) {
    return (
      <div className="flex-1 px-4 py-6 text-center text-xs text-text-muted">
        {search
          ? 'No matching files'
          : commentedFilesOnly
            ? 'No files with open comments'
            : 'No files'}
      </div>
    );
  }

  if (flat) {
    return (
      <VirtualRows
        items={flatNodes}
        itemPath={(node) => node.path}
        activePath={activeFile}
        className="flex-1 overflow-y-auto"
        renderRow={(node) => (
          <FlatFileRow
            node={node}
            active={activeFile === node.path}
            reviewed={reviewedFiles.has(node.path)}
            threadCount={commentCountsByFile.get(node.path) ?? 0}
            menuOpen={menuPath === node.path}
            onFileClick={onFileClick}
            onMenu={onMenu}
          />
        )}
      />
    );
  }

  return (
    <VirtualRows
      items={rows}
      itemPath={rowPath}
      activePath={activeFile}
      className="flex-1 overflow-y-auto"
      renderRow={({ node, depth }) => (
        <FileTreeRow
          node={node}
          depth={depth}
          expanded={effectiveExpandedDirs.has(node.path)}
          active={activeFile === node.path}
          reviewed={reviewedFiles.has(node.path)}
          threadCount={commentCountsByFile.get(node.path) ?? 0}
          menuOpen={menuPath === node.path}
          onToggleDir={handleToggleDir}
          onFileClick={onFileClick}
          onMenu={onMenu}
        />
      )}
    />
  );
});
