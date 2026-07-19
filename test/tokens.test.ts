import { describe, expect, it, vi, beforeEach } from 'vitest';

describe('countTokens caches the tiktoken encoder', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('only initializes the encoder once across many calls', async () => {
    const getEncodingSpy = vi.fn((name: string) => {
      const real = require('tiktoken').get_encoding(name);
      return real;
    });
    vi.doMock('tiktoken', () => ({
      get_encoding: getEncodingSpy,
    }));

    const { countTokens } = await import('../src/utils/tokens');

    // Regression guard: a previous version compared a nonexistent `._name`
    // field on the encoder object, which was always `undefined` and so
    // never matched — silently re-initializing tiktoken (~50ms+) on *every*
    // call. On a real project's worth of files that turned a sub-second
    // `generate` into one that visibly hung for tens of seconds.
    for (let i = 0; i < 25; i++) {
      countTokens(`some source text number ${i}`);
    }

    expect(getEncodingSpy).toHaveBeenCalledTimes(1);

    vi.doUnmock('tiktoken');
    vi.resetModules();
  });
});
