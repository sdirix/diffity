import { useSuspenseQuery } from '@tanstack/react-query';
import { diffOptions } from '../queries/diff';

export function useDiff(hideWhitespace = false, ref?: string, showHidden = false) {
  const { data, error, dataUpdatedAt } = useSuspenseQuery(diffOptions(hideWhitespace, ref, showHidden));

  return {
    data,
    error: error?.message ?? null,
    dataUpdatedAt,
  };
}
