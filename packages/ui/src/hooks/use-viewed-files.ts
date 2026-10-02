import { useCallback, useEffect, useMemo, useRef } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchViewedFiles, setFilesViewed, type ViewedFile } from '../lib/api';
import { errorMessage } from '../lib/toast';
import { applyViewed, computeViewedState } from '../lib/viewed-state';

/**
 * The viewed marks of `sessionId` split against `paths`, the files of the
 * diff. Fetched again whenever the diff on screen reloads, so a file that
 * changed since it was viewed shows as such.
 */
export function useViewedFiles(sessionId: string | null, paths: string[], diffVersion: number) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['viewed', sessionId, diffVersion], [sessionId, diffVersion]);
  const { data, error, isPending, isPlaceholderData } = useQuery({
    queryKey,
    queryFn: () => fetchViewedFiles(sessionId!),
    enabled: !!sessionId,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
  const state = useMemo(() => computeViewedState(data ?? [], paths), [data, paths]);
  const latestRequest = useRef(0);
  const shownRef = useRef(data);
  shownRef.current = data;

  useEffect(() => {
    if (error) {
      toast.error('Failed to load viewed files', { description: errorMessage(error) });
    }
  }, [error]);

  const setViewed = useCallback(async (targets: string[], viewed: boolean) => {
    if (!sessionId || targets.length === 0) {
      return;
    }
    const request = ++latestRequest.current;
    // While a reloaded diff fetches its marks, the previous ones are on screen, so the change starts from those. Its
    // response replaces the fetch, which may answer with the marks from before the change.
    const shown = shownRef.current;
    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData<ViewedFile[]>(queryKey, (prev) => applyViewed(prev ?? shown ?? [], targets, viewed));
    setFilesViewed(sessionId, targets, viewed).then(
      (files) => {
        if (request === latestRequest.current) {
          queryClient.setQueryData(queryKey, files);
        }
      },
      (err) => {
        toast.error(viewed ? 'Failed to mark as viewed' : 'Failed to mark as not viewed', { description: errorMessage(err) });
        queryClient.invalidateQueries({ queryKey: ['viewed', sessionId] });
      },
    );
  }, [sessionId, queryKey, queryClient]);

  return {
    viewedFiles: state.viewed,
    changedFiles: state.changed,
    setViewed,
    /** Nothing fetched yet. */
    loading: !!sessionId && isPending,
    /** The marks belong to the diff on screen. */
    settled: !sessionId || !!error || (!isPending && !isPlaceholderData),
  };
}
