import { useState } from 'react';
import { githubAvatarUrl, isFallbackAvatar } from '../../lib/avatar';
import { cn } from '../../lib/cn';

const COLORS = ['bg-accent', 'bg-added', 'bg-modified', 'bg-renamed', 'bg-deleted', 'bg-text-muted'];

/** A commit author's GitHub avatar, or their initial when there is none. */
export function AuthorAvatar(props: { name: string; email: string; onGitHub: boolean; className?: string }) {
  const { name, email, onGitHub, className } = props;
  const url = githubAvatarUrl(email, onGitHub);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);

  if (url && failedUrl !== url) {
    return (
      <img
        src={url}
        alt=""
        aria-hidden
        className={cn('w-4 h-4 rounded-full shrink-0 bg-bg-tertiary', loadedUrl !== url && 'opacity-0', className)}
        onError={() => setFailedUrl(url)}
        onLoad={(event) => {
          if (isFallbackAvatar(event.currentTarget.naturalWidth)) {
            setFailedUrl(url);
            return;
          }
          setLoadedUrl(url);
        }}
      />
    );
  }

  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return (
    <span
      aria-hidden
      className={cn(
        'w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-[9px] font-medium text-white',
        COLORS[Math.abs(hash) % COLORS.length],
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
