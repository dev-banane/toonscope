import fs from 'node:fs';
import path from 'node:path';
import type { ToonConfig } from '../types';
import { listSourceFiles, readTextFile } from '../utils/files';
import { sha256Hex } from '../utils/hash';
import { loadCache, cachePath, CACHE_ANALYZER_VERSION } from './cache';

export interface StaleFile {
  path: string;
  reason: 'new' | 'changed' | 'removed' | 'stale-analyzer';
}

export interface CheckResult {
  ok: boolean;
  generated: boolean;
  stale: StaleFile[];
  checkedFiles: number;
}

export async function checkStaleness(
  projectRoot: string,
  config: ToonConfig
): Promise<CheckResult> {
  const outputDir = path.isAbsolute(config.output)
    ? config.output
    : path.join(projectRoot, config.output);

  const generated = fs.existsSync(cachePath(outputDir));
  const cache = loadCache(outputDir);

  const files = await listSourceFiles(
    projectRoot,
    config.include,
    config.exclude,
    config.languages
  );

  const stale: StaleFile[] = [];
  const seen = new Set<string>();

  for (const relPath of files) {
    seen.add(relPath);
    const entry = cache[relPath];
    if (!entry) {
      stale.push({ path: relPath, reason: 'new' });
      continue;
    }
    if (entry.analyzerVersion !== CACHE_ANALYZER_VERSION) {
      stale.push({ path: relPath, reason: 'stale-analyzer' });
      continue;
    }
    const absPath = path.join(projectRoot, relPath);
    const contentHash = sha256Hex(readTextFile(absPath));
    if (entry.contentHash !== contentHash) {
      stale.push({ path: relPath, reason: 'changed' });
    }
  }

  for (const relPath of Object.keys(cache)) {
    if (!seen.has(relPath)) {
      stale.push({ path: relPath, reason: 'removed' });
    }
  }

  return {
    ok: generated && stale.length === 0,
    generated,
    stale,
    checkedFiles: files.length,
  };
}
