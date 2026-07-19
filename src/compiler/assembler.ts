import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import type { DependencyGraph, FileAnalysis } from '../types';
import { countTokens } from '../utils/tokens';

function readYamlFile(filePath: string): any {
  if (!fs.existsSync(filePath)) return null;
  return yaml.parse(fs.readFileSync(filePath, 'utf8'));
}

function sigEntries(
  functions: Record<string, unknown> | undefined,
  limit: number
): Record<string, unknown> | undefined {
  if (!functions) return undefined;
  const entries = Object.entries(functions).slice(0, limit);
  if (!entries.length) return undefined;
  return Object.fromEntries(entries);
}

export function assembleScopeYaml(params: {
  outputDir: string;
  targetFile: string;
  scopedAnalyses: FileAnalysis[];
  graph: DependencyGraph;
  depth: number;
  maxTokens?: number;
}): {
  yaml: string;
  outputPath: string;
  tokens: number;
  filesIncluded: number;
} {
  const {
    outputDir,
    targetFile,
    scopedAnalyses,
    graph,
    depth,
    maxTokens = 3000,
  } = params;
  const depthByPath = new Map<string, number>();
  const q: Array<[string, number]> = [[targetFile, 0]];
  const seen = new Set<string>();
  while (q.length) {
    const [f, d] = q.shift()!;
    if (seen.has(f) || d > depth) continue;
    seen.add(f);
    depthByPath.set(f, d);
    const neighbors = [
      ...(graph.edges.imports.get(f) ?? new Set<string>()),
      ...(graph.edges.importedBy.get(f) ?? new Set<string>()),
    ];
    for (const n of neighbors) {
      if (!seen.has(n)) q.push([n, d + 1]);
    }
  }

  const byPath = new Map(scopedAnalyses.map((a) => [a.path, a]));
  const payload: Record<string, unknown> = {
    target: targetFile,
    depth,
    files_included: scopedAnalyses.length,
  };

  for (const p of [...byPath.keys()].sort()) {
    const a = byPath.get(p)!;
    const fileYaml =
      readYamlFile(path.join(outputDir, 'files', `${p}.yaml`)) ?? {};
    const d = depthByPath.get(p) ?? depth;
    if (d === 0) {
      payload[path.posix.basename(p)] = fileYaml;
    } else if (d === 1) {
      payload[path.posix.basename(p)] = {
        type: a.type,
        summary: a.summary,
        functions: sigEntries(fileYaml.functions, 3),
      };
    } else {
      payload[path.posix.basename(p)] = {
        summary: a.summary,
        functions: sigEntries(fileYaml.functions, 1),
      };
    }
  }

  const typesYaml = readYamlFile(path.join(outputDir, 'types.yaml')) ?? {};
  payload.types = typesYaml;

  let yamlText = yaml.stringify(payload).trimEnd() + '\n';
  let tokens = countTokens(yamlText);
  if (tokens > maxTokens) {
    for (const k of Object.keys(payload)) {
      if (
        k === 'target' ||
        k === 'depth' ||
        k === 'files_included' ||
        k === 'types'
      )
        continue;
      if (k === path.posix.basename(targetFile)) continue;
      const v = payload[k] as any;
      if (v && typeof v === 'object' && 'functions' in v) delete v.functions;
    }
    yamlText = yaml.stringify(payload).trimEnd() + '\n';
    tokens = countTokens(yamlText);
  }

  const outputPath = path.join(
    outputDir,
    'scopes',
    `${path.posix.basename(targetFile)}.yaml`
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, yamlText, 'utf8');

  return {
    yaml: yamlText,
    outputPath,
    tokens,
    filesIncluded: scopedAnalyses.length,
  };
}
