import { describe, it, expect } from 'vitest';
import { githubAvatarUrl, isFallbackAvatar } from '../src/lib/avatar';

describe('githubAvatarUrl', () => {
  it('uses the account of a noreply address anywhere', () => {
    expect(githubAvatarUrl('12345+ada@users.noreply.github.com', false)).toBe('https://avatars.githubusercontent.com/u/12345?s=40');
    expect(githubAvatarUrl('ada@users.noreply.github.com', false)).toBe('https://github.com/ada.png?size=40');
  });

  it('looks other emails up only for repositories on GitHub', () => {
    expect(githubAvatarUrl('grace@example.com', true)).toBe('https://avatars.githubusercontent.com/u/e?email=grace%40example.com&s=40');
    expect(githubAvatarUrl('grace@example.com', false)).toBeNull();
    expect(githubAvatarUrl('not an email', true)).toBeNull();
  });

  it('spots the identicon GitHub sends for unknown emails', () => {
    expect(isFallbackAvatar(40)).toBe(false);
    expect(isFallbackAvatar(420)).toBe(true);
  });
});
