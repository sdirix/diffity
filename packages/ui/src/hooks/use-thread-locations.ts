import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchRepoThreads, type LocatedThread } from '../lib/api';
import type { CommentThread } from '../components/comments/types';

/**
 * The threads of `sessionId` located in the diff of their view, by id.
 * Fetched again when threads come or go and when the diff on screen reloads,
 * so the locations describe what the page shows.
 */
export function useThreadLocations(sessionId: string | null, threads: CommentThread[], diffVersion: number): Map<string, LocatedThread> {
  const ids = threads.map((thread) => thread.id).join(',');
  const { data } = useQuery({
    queryKey: ['thread-locations', sessionId, ids, diffVersion],
    queryFn: () => fetchRepoThreads(sessionId!),
    enabled: !!sessionId && threads.length > 0,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
  return useMemo(() => new Map((data ?? []).map((thread) => [thread.id, thread])), [data]);
}
