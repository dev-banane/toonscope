import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseyaml, stringify as stringifyyaml } from 'yaml';
import type { ToonConfig } from './types';

export const DEFAULT_CONFIG: ToonConfig = {
  include: ['src'],
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/__pycache__/**',
    '**/.venv/**',
    '**/venv/**',
    '**/.tox/**',
    '**/.mypy_cache/**',
    '**/*.egg-info/**',
    '**/.pytest_cache/**',
  ],
  output: '.toon',
  defaultDepth: 2,
  languages: ['typescript', 'javascript', 'python'],
  splitThreshold: 15,
  gitignoreToon: true,
  integrations: {
    agents: true,
    claude_code: true,
    cursor: true,
    copilot: false,
    gemini: false,
    windsurf: false,
  },
};

const ROOT_MARKER_TIERS: string[][] = [
  ['.toonscope.yaml'],
  ['.git'],
  ['package.json', 'pyproject.toml'],
];

export function resolveProjectRoot(
  startDir: string,
  opts?: { homeDir?: string }
): string {
  const start = path.resolve(startDir);
  const home = path.resolve(opts?.homeDir ?? os.homedir());

  const isFsRoot = (dir: string) => dir === path.dirname(dir);

  const allowed = (dir: string): boolean => {
    if (dir === start) return true;
    if (isFsRoot(dir)) return false;
    if (dir === home || (home + path.sep).startsWith(dir + path.sep))
      return false;
    return true;
  };

  for (const markers of ROOT_MARKER_TIERS) {
    let dir = start;
    while (true) {
      if (
        allowed(dir) &&
        markers.some((m) => fs.existsSync(path.join(dir, m)))
      ) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return start;
}

export function configFileExists(
  projectRoot: string,
  configPath?: string
): boolean {
  const resolved = configPath
    ? path.resolve(projectRoot, configPath)
    : path.join(projectRoot, '.toonscope.yaml');
  return fs.existsSync(resolved);
}

export function loadConfig(
  projectRoot: string,
  configPath?: string
): ToonConfig {
  const resolvedConfigPath = configPath
    ? path.resolve(projectRoot, configPath)
    : path.join(projectRoot, '.toonscope.yaml');

  if (!fs.existsSync(resolvedConfigPath)) {
    return DEFAULT_CONFIG;
  }

  const raw = fs.readFileSync(resolvedConfigPath, 'utf8');
  const parsed = parseyaml(raw) as Partial<ToonConfig>;

  const cfg: ToonConfig = {
    ...DEFAULT_CONFIG,
    ...parsed,
    ai: parsed.ai,
    integrations: {
      ...DEFAULT_CONFIG.integrations,
      ...(parsed.integrations ?? {}),
    },
  };

  cfg.include = Array.isArray(cfg.include)
    ? cfg.include
    : DEFAULT_CONFIG.include;
  cfg.exclude = Array.isArray(cfg.exclude)
    ? cfg.exclude
    : DEFAULT_CONFIG.exclude;
  cfg.languages = Array.isArray(cfg.languages)
    ? cfg.languages
    : DEFAULT_CONFIG.languages;

  return cfg;
}

export function saveConfig(
  projectRoot: string,
  config: ToonConfig,
  configPath?: string
): string {
  const resolvedConfigPath = configPath
    ? path.resolve(projectRoot, configPath)
    : path.join(projectRoot, '.toonscope.yaml');
  fs.writeFileSync(resolvedConfigPath, stringifyyaml(config), 'utf8');
  return resolvedConfigPath;
}
