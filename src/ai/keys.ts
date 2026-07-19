import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type AIProviderId = 'google' | 'anthropic' | 'openai' | 'ollama';

export function normalizeProviderId(provider: string): string {
  return provider === 'gemini' ? 'google' : provider;
}

const ENV_VAR_CANDIDATES: Record<string, string[]> = {
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
};

export function userConfigPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, '.config', 'toonscope', 'config.json');
}

export interface UserConfig {
  keys?: Record<string, string>;
}

export function readUserConfig(homeDir?: string): UserConfig {
  const p = userConfigPath(homeDir);
  if (!fs.existsSync(p)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as UserConfig) : {};
  } catch {
    return {};
  }
}

export function writeUserConfig(cfg: UserConfig, homeDir?: string): string {
  const p = userConfigPath(homeDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    /* ignore */
  }
  return p;
}

export function maskKey(key: string): string {
  if (key.length <= 8) return `${key.slice(0, 2)}…`;
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export type KeySource = 'flag' | 'env' | 'user-config' | 'project-config';

export interface ResolveKeyResult {
  key: string;
  source: KeySource;
  envVar?: string;
}

export interface ResolveKeyOptions {
  flagKey?: string;
  projectConfigKey?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

export function resolveApiKey(
  provider: string,
  opts: ResolveKeyOptions = {}
): ResolveKeyResult | null {
  const id = normalizeProviderId(provider);

  if (opts.flagKey) return { key: opts.flagKey, source: 'flag' };

  const env = opts.env ?? process.env;
  const candidates = [...(ENV_VAR_CANDIDATES[id] ?? []), 'TOONSCOPE_API_KEY'];
  for (const name of candidates) {
    const v = env[name];
    if (v) return { key: v, source: 'env', envVar: name };
  }

  const userCfg = readUserConfig(opts.homeDir);
  const fromUser = userCfg.keys?.[id];
  if (fromUser) return { key: fromUser, source: 'user-config' };

  if (opts.projectConfigKey) {
    return { key: opts.projectConfigKey, source: 'project-config' };
  }

  return null;
}

export function describeKeySources(provider: string): string[] {
  const id = normalizeProviderId(provider);
  const candidates = [...(ENV_VAR_CANDIDATES[id] ?? []), 'TOONSCOPE_API_KEY'];
  return [
    '--api-key <key> flag (this run only)',
    ...candidates.map((c) => `${c} environment variable`),
    `toonscope key set ${id} (stored in ${userConfigPath()})`,
  ];
}
