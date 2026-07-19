import path from 'node:path';
import fs from 'node:fs';
import fg from 'fast-glob';

export function normalizeProjectRelativePath(
  projectRoot: string,
  absPath: string
): string {
  const rel = path.relative(projectRoot, absPath);
  return rel.split(path.sep).join('/');
}

export function isProbablySourceFile(
  filePath: string,
  languages: string[]
): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (['.ts', '.tsx', '.mts', '.cts'].includes(ext))
    return languages.includes('typescript');
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext))
    return languages.includes('javascript');
  if (ext === '.py') return languages.includes('python');
  return false;
}

export const DEFAULT_JUNK_EXCLUDES = [
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
];

export async function listSourceFiles(
  projectRoot: string,
  include: string[],
  exclude: string[],
  languages: string[]
): Promise<string[]> {
  const patterns: string[] = [];
  for (const inc of include) {
    const p = inc.endsWith('/') ? inc : `${inc}`;
    patterns.push(path.posix.join(p.replace(/\\/g, '/'), '**/*'));
  }

  const results = await fg(patterns, {
    cwd: projectRoot,
    ignore: exclude,
    dot: false,
    onlyFiles: true,
  });

  return results
    .map((p) => p.split(path.sep).join('/'))
    .filter((rel) => isProbablySourceFile(rel, languages));
}

export function readTextFile(absPath: string): string {
  return fs.readFileSync(absPath, 'utf8');
}
