import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { deferReason, getFilePath, getRowCount } from '../../lib/diff-utils';
import { useViewState } from '../../lib/view-state';
import { filePatchOptions, type DiffSource } from '../../queries/diff';
import { FileBlock, type FileBlockProps } from './file-block';

interface DeferredFileBlockProps extends Omit<FileBlockProps, 'heldBack' | 'patchState'> {
  /** Where the diff came from, to fetch the hunks of a `trimmed` file. */
  source: DiffSource;
  /** Renders the file without waiting for "Load diff", for example to show a find match. */
  load?: boolean;
}

/**
 * A file that waits for "Load diff" when `deferReason` names one, unless it
 * has line comments, and fetches its hunks when the diff came without them.
 */
export function DeferredFileBlock(props: DeferredFileBlockProps) {
  const { source, load, ...blockProps } = props;
  const { file, collapsed, threads, baseRef } = blockProps;
  const filePath = getFilePath(file);
  const reason = useMemo(() => deferReason(file), [file]);
  const [loaded, setLoaded] = useViewState(`diff:${baseRef ?? 'work'}:loaded:${filePath}`, false);
  if (load && reason && !loaded) {
    setLoaded(true);
  }
  const hasLineThreads = useMemo(
    () => threads.some((thread) => thread.filePath === filePath && thread.startLine !== 0),
    [threads, filePath],
  );
  const heldBack = !!reason && !loaded && !hasLineThreads;
  const patch = useQuery({
    ...filePatchOptions(file, source),
    enabled: !!file.trimmed && !heldBack && !collapsed,
  });

  return (
    <FileBlock
      {...blockProps}
      file={file.trimmed && patch.data ? patch.data : file}
      heldBack={heldBack && reason ? { reason, rows: getRowCount(file), onLoad: () => setLoaded(true) } : null}
      patchState={!file.trimmed || heldBack || patch.data ? undefined : patch.isError ? 'error' : 'loading'}
    />
  );
}
