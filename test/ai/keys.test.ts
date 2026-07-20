import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveApiKey,
  describeKeySources,
  normalizeProviderId,
  maskKey,
  readUserConfig,
  writeUserConfig,
  userConfigPath,
} from '../../src/ai/keys';

describe('key resolution', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toonscope-keys-'));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('normalizes the legacy "gemini" alias to "google"', () => {
    expect(normalizeProviderId('gemini')).toBe('google');
    expect(normalizeProviderId('google')).toBe('google');
    expect(normalizeProviderId('anthropic')).toBe('anthropic');
  });

  it('prefers the --api-key flag over everything else', () => {
    writeUserConfig({ keys: { google: 'user-key' } }, tmpHome);
    const result = resolveApiKey('google', {
      flagKey: 'flag-key',
      env: { GEMINI_API_KEY: 'env-key' },
      homeDir: tmpHome,
    });
    expect(result).toEqual({ key: 'flag-key', source: 'flag' });
  });

  it('prefers provider-specific env vars over user config', () => {
    writeUserConfig({ keys: { google: 'user-key' } }, tmpHome);
    const result = resolveApiKey('google', {
      env: { GEMINI_API_KEY: 'env-key' },
      homeDir: tmpHome,
    });
    expect(result).toEqual({
      key: 'env-key',
      source: 'env',
      envVar: 'GEMINI_API_KEY',
    });
  });

  it('falls back through GEMINI_API_KEY then GOOGLE_API_KEY for the google provider', () => {
    const result = resolveApiKey('google', {
      env: { GOOGLE_API_KEY: 'google-env-key' },
      homeDir: tmpHome,
    });
    expect(result?.envVar).toBe('GOOGLE_API_KEY');
  });

  it('falls back to the generic TOONSCOPE_API_KEY when no provider-specific env var is set', () => {
    const result = resolveApiKey('anthropic', {
      env: { TOONSCOPE_API_KEY: 'generic-key' },
      homeDir: tmpHome,
    });
    expect(result).toEqual({
      key: 'generic-key',
      source: 'env',
      envVar: 'TOONSCOPE_API_KEY',
    });
  });

  it('uses the user-level config when no flag or env var is present', () => {
    writeUserConfig({ keys: { openai: 'stored-key' } }, tmpHome);
    const result = resolveApiKey('openai', { env: {}, homeDir: tmpHome });
    expect(result).toEqual({ key: 'stored-key', source: 'user-config' });
  });

  it('only falls back to the legacy project config as a last resort, and reports its source', () => {
    const result = resolveApiKey('anthropic', {
      env: {},
      homeDir: tmpHome,
      projectConfigKey: 'legacy-yaml-key',
    });
    expect(result).toEqual({
      key: 'legacy-yaml-key',
      source: 'project-config',
    });
  });

  it('returns null when no key can be resolved anywhere', () => {
    const result = resolveApiKey('openai', { env: {}, homeDir: tmpHome });
    expect(result).toBeNull();
  });

  it('never reads or writes keys from the project config directly (only via projectConfigKey passthrough)', () => {
    // resolveApiKey has no notion of a project yaml file at all — the CLI is
    // responsible for extracting `ai.apiKey` and passing it in explicitly.
    const result = resolveApiKey('openai', { env: {}, homeDir: tmpHome });
    expect(result).toBeNull();
  });

  it('round-trips through writeUserConfig/readUserConfig at the expected path', () => {
    const written = writeUserConfig({ keys: { google: 'abc' } }, tmpHome);
    expect(written).toBe(userConfigPath(tmpHome));
    expect(fs.existsSync(written)).toBe(true);
    const read = readUserConfig(tmpHome);
    expect(read.keys?.google).toBe('abc');
  });

  it('masks keys without leaking the middle', () => {
    expect(maskKey('AIzaSyD1234567890abcdef')).toBe('AIza…cdef');
    expect(maskKey('short')).toBe('sh…');
  });

  it('describeKeySources lists the flag, env vars, and the key-set command', () => {
    const lines = describeKeySources('google');
    expect(lines.some((l) => l.includes('--api-key'))).toBe(true);
    expect(lines.some((l) => l.includes('GEMINI_API_KEY'))).toBe(true);
    expect(lines.some((l) => l.includes('GOOGLE_API_KEY'))).toBe(true);
    expect(lines.some((l) => l.includes('TOONSCOPE_API_KEY'))).toBe(true);
    expect(lines.some((l) => l.includes('toonscope key set google'))).toBe(
      true
    );
  });
});
