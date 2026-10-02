const NOREPLY_EMAIL = /^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/i;

/**
 * The GitHub avatar of a commit author, from the email alone so no API call
 * is needed. A noreply address names the account, any other email is looked
 * up by GitHub when the repository is on GitHub. `null` when there is none.
 */
export function githubAvatarUrl(email: string, onGitHub: boolean): string | null {
  const noreply = NOREPLY_EMAIL.exec(email);
  if (noreply) {
    return noreply[1]
      ? `https://avatars.githubusercontent.com/u/${noreply[1]}?s=40`
      : `https://github.com/${encodeURIComponent(noreply[2])}.png?size=40`;
  }
  if (!onGitHub || !email.includes('@')) {
    return null;
  }
  return `https://avatars.githubusercontent.com/u/e?email=${encodeURIComponent(email)}&s=40`;
}

/** GitHub answers an email without an account with a full size identicon, ignoring the size asked for. */
export function isFallbackAvatar(naturalWidth: number): boolean {
  return naturalWidth > 100;
}
