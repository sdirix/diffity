import { queryOptions } from '@tanstack/react-query';
import { fetchInstances } from '../lib/api';

export function instancesOptions() {
  return queryOptions({
    queryKey: ['instances'],
    queryFn: fetchInstances,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}
