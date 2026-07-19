import fs from 'node:fs';
import path from 'node:path';
import type { DependencyGraph, FileAnalysis, ToonConfig } from '../types';
import { listSourceFiles } from '../utils/files';
import { sha256Hex } from '../utils/hash';
import { analyzeFile } from '../analyzer/index';
import { buildGraph as buildDepGraph } from '../graph/index';
import {
  loadCache,
  saveCache,
  computeAnalysisHash,
  CACHE_ANALYZER_VERSION,
} from './cache';

export async function buildProjectGraph(params: {
  projectRoot: string;
  config: ToonConfig;
  useCache?: boolean;
}): Promise<DependencyGraph> {
  const { projectRoot, config, useCache = true } = params;
  const outputDir = path.isAbsolute(config.output)
    ? config.output
    : path.join(projectRoot, config.output);

  const relFiles = await listSourceFiles(
    projectRoot,
    config.include,
    config.exclude,
    config.languages
  );
  const cache = useCache ? loadCache(outputDir) : {};

  const analyses: FileAnalysis[] = [];

  for (const relPath of relFiles) {
    try {
      const absPath = path.join(projectRoot, relPath);
      const sourceText = fs.readFileSync(absPath, 'utf8');
      const contentHash = sha256Hex(sourceText);

      const cached = cache[relPath];
      if (
        useCache &&
        cached &&
        cached.contentHash === contentHash &&
        cached.analyzerVersion === CACHE_ANALYZER_VERSION &&
        cached.analysis
      ) {
        const analysis = cached.analysis as any;
        analyses.push({
          ...analysis,
          path: relPath,
          contentHash,
          lastAnalyzed: cached.lastAnalyzed,
          summary: cached.summary,
        });
        continue;
      }

      const analysis = await analyzeFile({ projectRoot, absPath, config });
      const analysisHash = computeAnalysisHash(analysis);
      cache[relPath] = {
        contentHash,
        analysisHash,
        summary: analysis.summary,
        summarySource: 'template' as const,
        lastAnalyzed: analysis.lastAnalyzed,
        analyzerVersion: CACHE_ANALYZER_VERSION,
        analysis: {
          language: analysis.language,
          type: analysis.type,
          exports: analysis.exports,
          imports: analysis.imports,
          signatures: analysis.signatures,
          types: analysis.types,
        },
      };
      analyses.push(analysis);
    } catch {
      // A single unparseable/unreadable file must not abort graph building
    }
  }

  const graph = buildDepGraph(analyses);
  if (useCache) saveCache(outputDir, cache);
  return graph;
}
