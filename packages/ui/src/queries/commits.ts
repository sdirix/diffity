import { infiniteQueryOptions } from '@tanstack/react-query';
import { fetchCommits } from '../lib/api';

const COMMIT_PAGE_SIZE = 30;

/** Commits from HEAD down, a page at a time, filtered by message when `search` is set. */
export function commitPagesOptions(search: string) {
  return infiniteQueryOptions({
    queryKey: ['commit-pages', search],
    queryFn: ({ pageParam }) => fetchCommits(pageParam, COMMIT_PAGE_SIZE, search || undefined),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.reduce((count, page) => count + page.commits.length, 0) : undefined),
    staleTime: 10_000,
  });
}
