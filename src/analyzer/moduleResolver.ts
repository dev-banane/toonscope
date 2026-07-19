import fs from 'node:fs';
import path from 'node:path';
import { normalizeProjectRelativePath } from '../utils/files';

interface ParsedTsconfig {
  dir: string;
  baseUrlAbs: string;
  paths: Record<string, string[]>;
}

const tsconfigFileCache = new Map<string, ParsedTsconfig | null>();
const nearestConfigCache = new Map<string, string | null>();

function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let stringChar = '';
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (c === '\n') {
        inLineComment = false;
        out += c;
      }
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i++;
        continue;
      }
      if (c === stringChar) inString = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      stringChar = c;
      out += c;
      continue;
    }
    if (c === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    out += c;
  }

  // Strip trailing commas before } or ]
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function readJsonc(filePath: string): any | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(stripJsonComments(raw));
  } catch {
    return null;
  }
}

function resolveExtendsPath(fromDir: string, extendsValue: string): string | null {
  let p = extendsValue;
  if (!p.startsWith('.') && !path.isAbsolute(p)) {
    return null;
  }
  let resolved = path.isAbsolute(p) ? p : path.resolve(fromDir, p);
  if (!resolved.endsWith('.json')) resolved += '.json';
  return fs.existsSync(resolved) ? resolved : null;
}

function loadTsconfig(configPath: string): ParsedTsconfig | null {
  const cached = tsconfigFileCache.get(configPath);
  if (cached !== undefined) return cached;

  const json = readJsonc(configPath);
  if (!json) {
    tsconfigFileCache.set(configPath, null);
    return null;
  }

  const dir = path.dirname(configPath);
  let compilerOptions = json.compilerOptions ?? {};

  if (typeof json.extends === 'string') {
    const parentPath = resolveExtendsPath(dir, json.extends);
    if (parentPath) {
      const parentJson = readJsonc(parentPath);
      if (parentJson?.compilerOptions) {
        compilerOptions = { ...parentJson.compilerOptions, ...compilerOptions };
      }
    }
  }

  const baseUrl = compilerOptions.baseUrl ?? '.';
  const baseUrlAbs = path.resolve(dir, baseUrl);
  const paths: Record<string, string[]> = compilerOptions.paths ?? {};

  const result: ParsedTsconfig = { dir, baseUrlAbs, paths };
  tsconfigFileCache.set(configPath, result);
  return result;
}

function findNearestTsconfig(startDir: string, projectRoot: string): string | null {
  const cacheKey = startDir;
  const cached = nearestConfigCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let dir = startDir;
  let result: string | null = null;
  // Walk up but don't escape past the project root's parent.
  for (let i = 0; i < 20; i++) {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        result = candidate;
        break;
      }
    }
    if (result) break;
    if (dir === projectRoot) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  nearestConfigCache.set(cacheKey, result);
  return result;
}

const EXTENSIONLESS_CANDIDATES = [
  '.ts',
  '.tsx',
  '.d.ts',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
];

function candidatesForBase(base: string): string[] {
  const ext = path.extname(base);
  const out: string[] = [];

  if (ext && ext !== '.') {
    out.push(base);
    const stem = base.slice(0, -ext.length);
    if (ext === '.js') out.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`);
    else if (ext === '.jsx') out.push(`${stem}.tsx`);
    else if (ext === '.mjs') out.push(`${stem}.mts`);
    else if (ext === '.cjs') out.push(`${stem}.cts`);
  } else {
    for (const e of EXTENSIONLESS_CANDIDATES) out.push(`${base}${e}`);
    for (const e of EXTENSIONLESS_CANDIDATES) out.push(path.join(base, `index${e}`));
  }
  return out;
}

function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const BUILD_OUTPUT_DIR_NAMES = new Set(['dist', 'build']);

const COMPILED_SUFFIXES = [
  '.d.mts',
  '.d.cts',
  '.d.ts',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.tsx',
  '.jsx',
  '.js',
  '.ts',
];

function stripCompiledSuffix(p: string): string {
  for (const suf of COMPILED_SUFFIXES) {
    if (p.endsWith(suf)) return p.slice(0, -suf.length);
  }
  return p;
}

function preferSourceOverBuildOutput(foundPath: string): string {
  const parts = foundPath.split(path.sep);
  const buildIdx = parts.findIndex((p) => BUILD_OUTPUT_DIR_NAMES.has(p));
  if (buildIdx === -1) return foundPath;

  const withoutBuildDir = [
    ...parts.slice(0, buildIdx),
    ...parts.slice(buildIdx + 1),
  ].join(path.sep);
  const stem = stripCompiledSuffix(withoutBuildDir);
  const sourceCandidate = firstExisting(candidatesForBase(stem));
  return sourceCandidate ?? foundPath;
}

function resolveExisting(candidates: string[]): string | null {
  const found = firstExisting(candidates);
  return found ? preferSourceOverBuildOutput(found) : null;
}

function resolveViaTsconfigPaths(
  projectRoot: string,
  fromDir: string,
  importSource: string
): string | null {
  const configPath = findNearestTsconfig(fromDir, projectRoot);
  if (!configPath) return null;
  const config = loadTsconfig(configPath);
  if (!config) return null;

  for (const [pattern, targets] of Object.entries(config.paths)) {
    const starIdx = pattern.indexOf('*');
    let matched: string | null = null;

    if (starIdx === -1) {
      if (pattern === importSource) matched = '';
    } else {
      const prefix = pattern.slice(0, starIdx);
      const suffix = pattern.slice(starIdx + 1);
      if (importSource.startsWith(prefix) && importSource.endsWith(suffix)) {
        matched = importSource.slice(
          prefix.length,
          importSource.length - suffix.length
        );
      }
    }

    if (matched === null) continue;

    for (const target of targets) {
      const substituted = target.replace('*', matched);
      const base = path.resolve(config.baseUrlAbs, substituted);
      const found = resolveExisting(candidatesForBase(base));
      if (found) return found;
    }
  }

  if (config.baseUrlAbs) {
    const base = path.resolve(config.baseUrlAbs, importSource);
    const found = resolveExisting(candidatesForBase(base));
    if (found) return found;
  }

  return null;
}

export function resolveImportPath(params: {
  projectRoot: string;
  absPath: string;
  importSource: string;
}): string | null {
  const { projectRoot, absPath, importSource } = params;
  if (!importSource) return null;

  if (importSource.startsWith('.')) {
    const base = path.resolve(path.dirname(absPath), importSource);
    const found = resolveExisting(candidatesForBase(base));
    return found ? normalizeProjectRelativePath(projectRoot, found) : null;
  }

  const found = resolveViaTsconfigPaths(
    projectRoot,
    path.dirname(absPath),
    importSource
  );
  return found ? normalizeProjectRelativePath(projectRoot, found) : null;
}
