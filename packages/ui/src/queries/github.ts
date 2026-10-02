import { queryOptions } from '@tanstack/react-query';
import { fetchGitHubDetails } from '../lib/api';

export function githubDetailsOptions(enabled: boolean) {
  return queryOptions({
    queryKey: ['github-details'],
    queryFn: fetchGitHubDetails,
    enabled,
    staleTime: 60_000,
  });
}
