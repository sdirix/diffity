import { queryOptions } from '@tanstack/react-query';
import { fetchFileContent } from '../lib/api';

export function fileContentOptions(filePath: string, enabled: boolean, ref?: string) {
  return queryOptions({
    queryKey: ['file-content', filePath, ref],
    queryFn: () => fetchFileContent(filePath, ref),
    enabled,
  });
}

/** Content of the file as it exists on the new side of the diff for `ref`. */
export function headFileContentOptions(filePath: string, ref?: string) {
  return queryOptions({
    queryKey: ['file-content', filePath, ref, 'new'],
    queryFn: () => fetchFileContent(filePath, ref, 'new'),
  });
}
