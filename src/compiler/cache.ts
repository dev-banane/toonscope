import fs from 'node:fs';
import path from 'node:path';
import type { FileAnalysis } from '../types';
import { sha256Hex } from '../utils/hash';
import { writeFileSyncRetrying } from '../utils/fsRetry';

export interface CacheEntry {
  contentHash: string;
  analysisHash: string;
  summary: string;
  summarySource: 'template' | 'ai';
  lastAnalyzed: string;
  analyzerVersion: string;
  analysis?: Omit<
    FileAnalysis,
    'summary' | 'contentHash' | 'lastAnalyzed' | 'path'
  > & {
    summary?: string;
  };
  templateSummary?: string;
  aiSummary?: string;
  aiFunctionDocs?: Record<string, string>;
  aiModel?: string;
}

export type ToonCache = Record<string, CacheEntry>;

export const CACHE_ANALYZER_VERSION = '7';

export function cachePath(projectRoot: string) {
  return path.join(projectRoot, '.toon', 'cache.json');
}

export function computeAnalysisHash(analysis: FileAnalysis): string {
  const payload = {
    exports: analysis.exports,
    imports: analysis.imports,
    signatures: analysis.signatures,
    types: analysis.types,
    type: analysis.type,
  };
  return sha256Hex(JSON.stringify(payload));
}

export function loadCache(projectRoot: string): ToonCache {
  const p = cachePath(projectRoot);
  if (!fs.existsSync(p)) return {};
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw) as ToonCache;
  } catch {
    return {};
  }
}

export function saveCache(projectRoot: string, cache: ToonCache): void {
  const p = cachePath(projectRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  writeFileSyncRetrying(p, JSON.stringify(cache, null, 2));
}
