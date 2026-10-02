import { afterEach, describe, expect, it } from 'vitest';
import { getBindAddresses, getExposedBindAddress } from '../src/server.js';

function withBind(bind: string | undefined) {
  if (bind === undefined) {
    delete process.env.DIFFITY_BIND;
  } else {
    process.env.DIFFITY_BIND = bind;
  }
  return { addresses: getBindAddresses(), exposed: getExposedBindAddress() };
}

describe('DIFFITY_BIND', () => {
  afterEach(() => {
    delete process.env.DIFFITY_BIND;
  });

  it('listens on loopback by default', () => {
    for (const bind of [undefined, '', ' ', 'localhost']) {
      expect(withBind(bind), String(bind)).toEqual({ addresses: ['127.0.0.1', '::1'], exposed: null });
    }
  });

  it('listens on the given address', () => {
    expect(withBind('0.0.0.0')).toEqual({ addresses: ['0.0.0.0'], exposed: '0.0.0.0' });
    expect(withBind('[::]')).toEqual({ addresses: ['::'], exposed: '::' });
    expect(withBind('192.168.1.5')).toEqual({ addresses: ['192.168.1.5'], exposed: '192.168.1.5' });
  });

  it('does not report a loopback address as exposed', () => {
    expect(withBind('127.0.0.1')).toEqual({ addresses: ['127.0.0.1'], exposed: null });
    expect(withBind('::1')).toEqual({ addresses: ['::1'], exposed: null });
  });
});
