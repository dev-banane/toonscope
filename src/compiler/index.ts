import fs from 'node:fs';
import path from 'node:path';
import type { FileAnalysis, ToonConfig, ToonContext } from '../types';
import { listSourceFiles } from '../utils/files';
import { sha256Hex } from '../utils/hash';
import { countTokens } from '../utils/tokens';
import { detectFramework } from '../utils/framework';
import { analyzeFile } from '../analyzer/index';
import { templateSummary } from '../analyzer/summarizer';
import { buildGraph } from '../graph/index';
import { writeSplitContext, computeSharedTypesDetailed } from './yaml-emitter';
import {
  loadCache,
  saveCache,
  computeAnalysisHash,
  CACHE_ANALYZER_VERSION,
  type CacheEntry,
} from './cache';
import { createProvider, effectiveModel, normalizeProviderId } from '../ai';
import type { AIProvider } from '../ai';
import { runSummarization, type RunnerTask } from '../ai/runner';
import { MAX_UNDOCUMENTED_FUNCTIONS_PER_REQUEST } from '../ai/prompts';

export async function generateContext(
  projectRoot: string,
  config: ToonConfig,
  options?: {
    summarize?: boolean;
    provider?: AIProvider;
    force?: boolean;
    onParseProgress?: (current: number, total: number, file: string) => void;
    onSummaryProgress?: (current: number, total: number, file: string) => void;
    onParseError?: (file: string, message: string) => void;
    onPhase?: (
      phase: 'parse' | 'graph' | 'summary' | 'write',
      meta?: Record<string, number>
    ) => void;
  }
): Promise<ToonContext> {
  const projectName = path.basename(projectRoot);
  const framework = detectFramework(projectRoot);
  const summarize = Boolean(options?.summarize);
  const useAI = summarize && Boolean(options?.provider || config.ai?.provider);
  const provider = useAI
    ? (options?.provider ?? createProvider(config.ai!))
    : null;
  const providerModelTag = useAI
    ? options?.provider
      ? 'host-provided'
      : `${normalizeProviderId(config.ai!.provider)}:${effectiveModel(config.ai!)}`
    : undefined;

  const outputDir = path.isAbsolute(config.output)
    ? config.output
    : path.join(projectRoot, config.output);

  const absFiles = await listSourceFiles(
    projectRoot,
    config.include,
    config.exclude,
    config.languages
  );
  const cache = options?.force ? {} : loadCache(outputDir);

  const analyses: FileAnalysis[] = [];
  const tasks: RunnerTask[] = [];
  let cachedAiCount = 0;
  const parseErrors: string[] = [];

  for (const relPath of absFiles) {
    options?.onParseProgress?.(
      analyses.length + parseErrors.length + 1,
      absFiles.length,
      relPath
    );
    try {
      const absPath = path.join(projectRoot, relPath);
      const sourceText = fs.readFileSync(absPath, 'utf8');
      const contentHash = sha256Hex(sourceText);
      const cached = cache[relPath];

      let analysis: FileAnalysis;
      let tmplSummary: string;
      let cacheAnalysisPortion: NonNullable<CacheEntry['analysis']>;
      let analysisHash: string;

      if (
        cached &&
        cached.contentHash === contentHash &&
        cached.analyzerVersion === CACHE_ANALYZER_VERSION &&
        cached.analysis
      ) {
        const a = cached.analysis;
        analysis = {
          path: relPath,
          language: a.language,
          type: a.type,
          exports: a.exports,
          imports: a.imports,
          signatures: a.signatures,
          types: a.types,
          summary: '',
          contentHash,
          lastAnalyzed: cached.lastAnalyzed,
        };
        tmplSummary =
          cached.templateSummary ?? cached.summary ?? templateSummary(analysis);
        cacheAnalysisPortion = a;
        analysisHash = cached.analysisHash;
      } else {
        const fresh = await analyzeFile({ projectRoot, absPath, config });
        analysis = { ...fresh, contentHash };
        tmplSummary = fresh.summary;
        cacheAnalysisPortion = {
          language: fresh.language,
          type: fresh.type,
          exports: fresh.exports,
          imports: fresh.imports,
          signatures: fresh.signatures,
          types: fresh.types,
        };
        analysisHash = computeAnalysisHash(fresh);
      }

      analysis.summary = tmplSummary;

      let usedCachedAi = false;
      if (
        useAI &&
        cached &&
        cached.contentHash === contentHash &&
        cached.aiModel === providerModelTag &&
        cached.aiSummary
      ) {
        analysis.summary = cached.aiSummary;
        if (cached.aiFunctionDocs) {
          for (const sig of analysis.signatures) {
            if (!sig.doc && cached.aiFunctionDocs[sig.name]) {
              sig.doc = cached.aiFunctionDocs[sig.name];
            }
          }
        }
        usedCachedAi = true;
        cachedAiCount += 1;
      }

      analyses.push(analysis);

      cache[relPath] = {
        contentHash,
        analysisHash,
        summary: analysis.summary,
        summarySource: usedCachedAi ? 'ai' : 'template',
        templateSummary: tmplSummary,
        lastAnalyzed: analysis.lastAnalyzed,
        analyzerVersion: CACHE_ANALYZER_VERSION,
        analysis: cacheAnalysisPortion,
        ...(usedCachedAi
          ? {
              aiSummary: cached!.aiSummary,
              aiFunctionDocs: cached!.aiFunctionDocs,
              aiModel: cached!.aiModel,
            }
          : {}),
      };

      if (useAI && !usedCachedAi && provider) {
        const undocumentedFunctions = analysis.signatures
          .filter((s) => !s.doc)
          .map((s) => s.name)
          .slice(0, MAX_UNDOCUMENTED_FUNCTIONS_PER_REQUEST);
        tasks.push({
          path: relPath,
          request: {
            path: relPath,
            type: analysis.type,
            language: analysis.language,
            exports: analysis.exports,
            signatures: analysis.signatures,
            types: analysis.types,
            imports: analysis.imports,
            sourceText,
            undocumentedFunctions,
          },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      parseErrors.push(relPath);
      options?.onParseError?.(relPath, message);
    }
  }

  let aiReport: ToonContext['meta']['aiSummary'];

  if (useAI && provider) {
    const { results, report } = await runSummarization({
      provider,
      tasks,
      concurrency: config.ai?.concurrency,
      cached: cachedAiCount,
      skipped: 0,
      onProgress: (current, total, file) =>
        options?.onSummaryProgress?.(current, total, file),
    });
    aiReport = report;

    for (const analysis of analyses) {
      const result = results.get(analysis.path);
      if (!result) continue;
      analysis.summary = result.summary;
      if (result.functionDocs) {
        for (const sig of analysis.signatures) {
          if (!sig.doc && result.functionDocs[sig.name]) {
            sig.doc = result.functionDocs[sig.name];
          }
        }
      }
      const entry = cache[analysis.path];
      if (entry) {
        entry.summary = analysis.summary;
        entry.summarySource = 'ai';
        entry.aiSummary = result.summary;
        entry.aiFunctionDocs = result.functionDocs;
        entry.aiModel = providerModelTag;
        entry.lastAnalyzed = new Date().toISOString();
        entry.analysis = {
          language: analysis.language,
          type: analysis.type,
          exports: analysis.exports,
          imports: analysis.imports,
          signatures: analysis.signatures,
          types: analysis.types,
        };
      }
    }
  }

  options?.onPhase?.('graph');
  const graph = buildGraph(analyses);
  let rawTokens = 0;
  for (const relPath of absFiles) {
    rawTokens += countTokens(
      fs.readFileSync(path.join(projectRoot, relPath), 'utf8')
    );
  }
  const generatedISO = new Date().toISOString();
  options?.onPhase?.('write');
  const splitResult = writeSplitContext({
    projectRoot,
    outputDir,
    graph,
    config,
    projectName,
    framework,
    generatedISO,
    rawTokens,
  });

  const sharedTypes = computeSharedTypesDetailed(graph);
  const graphEntries: ToonContext['graph'] = {};
  for (const a of analyses) {
    graphEntries[a.path] = {
      type: a.type,
      exports: a.exports.map((e: any) => e.name),
      uses: [...(graph.edges.imports.get(a.path) ?? new Set<string>())],
      used_by: [...(graph.edges.importedBy.get(a.path) ?? new Set<string>())],
      summary: a.summary,
    };
  }
  const ctx: ToonContext = {
    meta: {
      project: projectName,
      framework,
      generated: generatedISO,
      files: graph.nodes.size,
      totalTokens: splitResult.totalTokens,
      ...(aiReport ? { aiSummary: aiReport } : {}),
      ...(parseErrors.length
        ? { errors: { count: parseErrors.length, files: parseErrors } }
        : {}),
    },
    graph: graphEntries,
    types: Object.fromEntries(sharedTypes.map((t) => [t.name, t.definition])),
  };

  saveCache(outputDir, cache);
  return ctx;
}
