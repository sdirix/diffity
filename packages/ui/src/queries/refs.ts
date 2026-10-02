import { queryOptions } from '@tanstack/react-query';
import { fetchRef, fetchStatus } from '../lib/api';

export function statusOptions() {
  return queryOptions({
    queryKey: ['status'],
    queryFn: fetchStatus,
  });
}

export function refOptions(ref: string) {
  return queryOptions({
    queryKey: ['ref', ref],
    queryFn: () => fetchRef(ref),
    staleTime: 30_000,
  });
}
