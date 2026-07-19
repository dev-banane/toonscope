import fs from 'node:fs';
import path from 'node:path';
import type { ToonConfig } from '../types';
import { analyzeFile } from '../analyzer/index';
import { buildProjectGraph } from '../compiler/buildGraph';
import {
  computeAnalysisHash,
  loadCache,
  saveCache,
  CACHE_ANALYZER_VERSION,
} from '../compiler/cache';
import {
  computeSharedTypesDetailed,
  writeFileyaml,
  writeGraphyaml,
  writeIndexyaml,
  writeTypesyaml,
} from '../compiler/yaml-emitter';
import { countTokens } from '../utils/tokens';
import { detectFramework } from '../utils/framework';

export async function applyIncrementalUpdate(params: {
  projectRoot: string;
  config: ToonConfig;
  changedAbsPath: string;
}): Promise<void> {
  const { projectRoot, config, changedAbsPath } = params;
  const outputDir = path.isAbsolute(config.output)
    ? config.output
    : path.join(projectRoot, config.output);
  const relPath = path
    .relative(projectRoot, changedAbsPath)
    .split(path.sep)
    .join('/');
  if (!fs.existsSync(changedAbsPath)) return;

  const cache = loadCache(projectRoot);
  const prev = cache[relPath];
  const next = await analyzeFile({
    projectRoot,
    absPath: changedAbsPath,
    config,
  });
  const nextAnalysisHash = computeAnalysisHash(next);

  cache[relPath] = {
    contentHash: next.contentHash,
    analysisHash: nextAnalysisHash,
    summary: next.summary,
    summarySource: 'template',
    lastAnalyzed: new Date().toISOString(),
    analyzerVersion: CACHE_ANALYZER_VERSION,
    analysis: {
      language: next.language,
      type: next.type,
      exports: next.exports,
      imports: next.imports,
      signatures: next.signatures,
      types: next.types,
    },
  };
  saveCache(projectRoot, cache);

  writeFileyaml(outputDir, next);

  const graph = await buildProjectGraph({
    projectRoot,
    config,
    useCache: true,
  });
  const prevAnalysisHash = prev?.analysisHash;
  const signaturesChanged = prevAnalysisHash !== nextAnalysisHash;

  if (signaturesChanged) {
    writeGraphyaml(outputDir, graph);
    const sharedTypes = computeSharedTypesDetailed(graph);
    writeTypesyaml(outputDir, sharedTypes, config.splitThreshold ?? 15);
  }

  let rawTokens = 0;
  for (const p of graph.nodes.keys()) {
    rawTokens += countTokens(
      fs.readFileSync(path.join(projectRoot, p), 'utf8')
    );
  }
  const indexTokenGuess = countTokens(
    fs.readFileSync(path.join(outputDir, 'index.yaml'), 'utf8')
  );
  writeIndexyaml({
    outputDir,
    graph,
    projectName: path.basename(projectRoot),
    framework: detectFramework(projectRoot),
    generatedISO: new Date().toISOString(),
    totalTokens: indexTokenGuess,
    rawTokens,
    splitThreshold: config.splitThreshold ?? 15,
  });
}
