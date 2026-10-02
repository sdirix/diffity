import { describe, it, expect } from 'vitest';
import { parseRemoteUrl } from '../src/remote.js';

const slug = (owner: string, repo: string) => ({ owner, repo });

describe('parseRemoteUrl', () => {
  it('parses https, ssh, git and scp-like remotes', () => {
    expect(parseRemoteUrl('https://github.com/a/b.git')).toEqual(slug('a', 'b'));
    expect(parseRemoteUrl('https://github.com/a/b')).toEqual(slug('a', 'b'));
    expect(parseRemoteUrl('https://github.com/a/b/')).toEqual(slug('a', 'b'));
    expect(parseRemoteUrl('https://github.com/a/b.git/')).toEqual(slug('a', 'b'));
    expect(parseRemoteUrl('https://user:tok@github.com/a/b.git')).toEqual(slug('a', 'b'));
    expect(parseRemoteUrl('git@github.com:a/b.git')).toEqual(slug('a', 'b'));
    expect(parseRemoteUrl('ssh://git@github.com/a/b.git')).toEqual(slug('a', 'b'));
    expect(parseRemoteUrl('ssh://git@ssh.github.com:443/a/b.git')).toEqual(slug('a', 'b'));
    expect(parseRemoteUrl('git://github.com/a/b')).toEqual(slug('a', 'b'));
    expect(parseRemoteUrl('  https://GitHub.com/a/b\n')).toEqual(slug('a', 'b'));
  });

  it('keeps dots in repo names', () => {
    expect(parseRemoteUrl('https://github.com/socketio/socket.io.git')).toEqual(slug('socketio', 'socket.io'));
    expect(parseRemoteUrl('git@github.com:a/my.repo.git')).toEqual(slug('a', 'my.repo'));
    expect(parseRemoteUrl('git@github.com:a/my.repo')).toEqual(slug('a', 'my.repo'));
  });

  it('rejects other hosts and malformed paths', () => {
    expect(parseRemoteUrl('git@gitlab.com:a/b.git')).toBeNull();
    expect(parseRemoteUrl('https://example.com/a/b')).toBeNull();
    expect(parseRemoteUrl('https://notgithub.com/a/b')).toBeNull();
    expect(parseRemoteUrl('https://github.com.evil.com/a/b')).toBeNull();
    expect(parseRemoteUrl('https://github.com/a')).toBeNull();
    expect(parseRemoteUrl('https://github.com/a/b/c')).toBeNull();
    expect(parseRemoteUrl('/local/path/repo')).toBeNull();
    expect(parseRemoteUrl('')).toBeNull();
  });
});
