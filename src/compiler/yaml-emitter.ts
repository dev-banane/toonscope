import fs from 'node:fs';
import path from 'node:path';
import yaml, { Document, isMap, isSeq, isScalar } from 'yaml';
import type {
  DependencyGraph,
  ExportInfo,
  FileAnalysis,
  Language,
  ParamInfo,
  SignatureInfo,
  ToonConfig,
} from '../types';
import { countTokens } from '../utils/tokens';
import { writeFileSyncRetrying } from '../utils/fsRetry';

export interface SplitEmitResult {
  indexPath: string;
  graphPath: string;
  typesPath: string;
  graphFullPath?: string;
  typesFullPath?: string;
  fileyamlPaths: string[];
  totalTokens: number;
  alwaysReadTokens: number;
}

export interface SharedTypeInfo {
  name: string;
  definedIn: string;
  definition: string;
  usedBy: string[];
}

function flowifyShortArrays(node: unknown): void {
  if (isSeq(node)) {
    const items = node.items as unknown[];
    if (items.length && items.every((it) => isScalar(it))) {
      (node as { flow?: boolean }).flow = true;
    }
    for (const it of items) flowifyShortArrays(it);
  } else if (isMap(node)) {
    for (const pair of node.items) flowifyShortArrays((pair as { value: unknown }).value);
  }
}

function stringifyyaml(data: unknown): string {
  const doc = new Document(data);
  flowifyShortArrays(doc.contents);
  return doc.toString({ lineWidth: 120, flowCollectionPadding: false }).trimEnd() + '\n';
}

function shortSummary(s: string, max = 60): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function renderParam(p: ParamInfo, language: Language): string {
  let out = p.rest && !p.name.startsWith('*') ? `...${p.name}` : p.name;
  if (p.type) out += `: ${p.type}`;
  if (p.optional && p.default === undefined) out += '?';
  if (p.default !== undefined) out += ` = ${p.default}`;
  return out;
}

export function sigToCompactString(
  sig: SignatureInfo,
  language: Language
): string {
  const paramsStr = sig.params.map((p) => renderParam(p, language)).join(', ');
  const asyncPrefix = sig.isAsync ? 'async ' : '';
  const genStar = sig.isGenerator ? '*' : '';
  const dot = sig.name.indexOf('.');
  const baseName = dot >= 0 ? sig.name.slice(dot + 1) : sig.name;

  if (sig.kind === 'constructor') {
    return `${asyncPrefix}constructor(${paramsStr})`;
  }

  const kindPrefix =
    sig.kind === 'getter' ? 'get ' : sig.kind === 'setter' ? 'set ' : '';
  const arrow = language === 'python' ? '->' : '=>';
  const ret = sig.returnType ? ` ${arrow} ${sig.returnType}` : '';
  return `${kindPrefix}${asyncPrefix}${genStar}${baseName}(${paramsStr})${ret}`;
}

function sigValue(sig: SignatureInfo, language: Language): string | { sig: string; doc: string } {
  const s = sigToCompactString(sig, language);
  return sig.doc ? { sig: s, doc: sig.doc } : s;
}

function exportLabel(e: ExportInfo): string {
  if (e.kind === 'reexport') {
    const from = e.reexport?.from ?? '?';
    return e.reexport?.star ? `* from ${from}` : `${e.name} from ${from}`;
  }
  if (e.isDefault) return e.name === 'default' ? 'default' : `${e.name} (default)`;
  return e.name;
}

function buildExportsSection(
  exports: ExportInfo[]
): Record<string, string[]> | undefined {
  const groups: Record<string, string[]> = {};
  const push = (bucket: string, label: string) => {
    (groups[bucket] ??= []).push(label);
  };

  for (const e of exports) {
    const label = exportLabel(e);
    switch (e.kind) {
      case 'function':
        push('functions', label);
        break;
      case 'class':
        push('classes', label);
        break;
      case 'interface':
      case 'type':
      case 'enum':
        push('types', label);
        break;
      case 'const':
      case 'default':
        push('constants', label);
        break;
      case 'reexport':
        push('reexports', label);
        break;
    }
  }

  return Object.keys(groups).length ? groups : undefined;
}

function buildImportsSection(
  analysis: FileAnalysis
): { local?: unknown[]; external?: unknown[] } | undefined {
  const localMap = new Map<string, Set<string>>();
  const externalMap = new Map<string, Set<string>>();

  for (const imp of analysis.imports) {
    const isLocal = Boolean(imp.resolvedPath);
    const key = imp.resolvedPath ?? imp.source;
    const bucket = isLocal ? localMap : externalMap;
    if (!bucket.has(key)) bucket.set(key, new Set());
    for (const n of imp.names) bucket.get(key)!.add(n);
  }

  const toEntries = (map: Map<string, Set<string>>, keyField: 'path' | 'source') =>
    [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, names]) =>
        names.size
          ? { [keyField]: key, names: [...names].sort() }
          : key
      );

  const local = toEntries(localMap, 'path');
  const external = toEntries(externalMap, 'source');

  if (!local.length && !external.length) return undefined;
  const result: { local?: unknown[]; external?: unknown[] } = {};
  if (local.length) result.local = local;
  if (external.length) result.external = external;
  return result;
}

function buildFunctionsSection(
  analysis: FileAnalysis
): Record<string, unknown> | undefined {
  if (!analysis.signatures.length) return undefined;
  const sorted = [...analysis.signatures].sort((a, b) => {
    if (a.isExported !== b.isExported) return a.isExported ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const out: Record<string, unknown> = {};
  for (const sig of sorted) {
    let key = sig.isExported ? sig.name : `~${sig.name}`;
    if (sig.kind === 'getter') key += ' (get)';
    else if (sig.kind === 'setter') key += ' (set)';
    let uniqueKey = key;
    let suffix = 2;
    while (uniqueKey in out) uniqueKey = `${key} #${suffix++}`;
    out[uniqueKey] = sigValue(sig, analysis.language);
  }
  return out;
}

function buildTypesSection(analysis: FileAnalysis): Record<string, unknown> | undefined {
  if (!analysis.types.length) return undefined;
  const out: Record<string, unknown> = {};
  for (const t of analysis.types) {
    const key = t.isExported ? t.name : `~${t.name}`;
    out[key] = t.doc ? { def: t.definition, doc: t.doc } : t.definition;
  }
  return out;
}

export function computeSharedTypesDetailed(
  graph: DependencyGraph
): SharedTypeInfo[] {
  const usage = new Map<
    string,
    { definedIn: string; definition: string; usedBy: Set<string> }
  >();
  for (const analysis of graph.nodes.values()) {
    for (const t of analysis.types) {
      if (!t.isExported) continue;
      const key = `${analysis.path}::${t.name}`;
      usage.set(key, {
        definedIn: analysis.path,
        definition: t.definition,
        usedBy: new Set<string>(),
      });
    }
  }

  for (const analysis of graph.nodes.values()) {
    for (const imp of analysis.imports) {
      if (!imp.resolvedPath) continue;
      const target = graph.nodes.get(imp.resolvedPath);
      if (!target) continue;
      for (const t of target.types) {
        if (!t.isExported || !imp.names.includes(t.name)) continue;
        const key = `${target.path}::${t.name}`;
        usage.get(key)?.usedBy.add(analysis.path);
      }
    }
  }

  const result: SharedTypeInfo[] = [];
  for (const [k, v] of usage) {
    const name = k.split('::')[1];
    if (v.usedBy.size >= 2) {
      result.push({
        name,
        definedIn: v.definedIn,
        definition: v.definition,
        usedBy: [...v.usedBy].sort(),
      });
    }
  }
  return result.sort(
    (a, b) => b.usedBy.length - a.usedBy.length || a.name.localeCompare(b.name)
  );
}

function dirKey(relPath: string): string {
  const dir = path.posix.dirname(relPath);
  return dir === '.' ? '' : `${dir}/`;
}

export function fileyamlPath(outputDir: string, relPath: string): string {
  return path.join(outputDir, 'files', `${relPath}.yaml`);
}

export function writeFileyaml(
  outputDir: string,
  analysis: FileAnalysis,
  graph?: DependencyGraph
): string {
  const payload: Record<string, unknown> = {
    path: analysis.path,
    type: analysis.type,
    summary: analysis.summary,
  };

  const exportsSection = buildExportsSection(analysis.exports);
  if (exportsSection) payload.exports = exportsSection;

  const importsSection = buildImportsSection(analysis);
  if (importsSection) payload.imports = importsSection;

  const functionsSection = buildFunctionsSection(analysis);
  if (functionsSection) payload.functions = functionsSection;

  const typesSection = buildTypesSection(analysis);
  if (typesSection) payload.types = typesSection;

  if (graph) {
    const uses = [...(graph.edges.imports.get(analysis.path) ?? new Set<string>())].sort();
    const usedBy = [...(graph.edges.importedBy.get(analysis.path) ?? new Set<string>())].sort();
    if (uses.length) payload.uses = uses;
    if (usedBy.length) payload.used_by = usedBy;
  }

  const p = fileyamlPath(outputDir, analysis.path);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  writeFileSyncRetrying(p, stringifyyaml(payload));
  return p;
}

export function writeTypesyaml(
  outputDir: string,
  sharedTypes: SharedTypeInfo[],
  splitThreshold: number
): { primaryPath: string; fullPath?: string } {
  const primaryPath = path.join(outputDir, 'types.yaml');
  const fullPath = path.join(outputDir, 'types.full.yaml');
  const cap = sharedTypes.length > 50 ? 30 : sharedTypes.length;
  const primary = Object.fromEntries(
    sharedTypes.slice(0, cap).map((t) => [
      t.name,
      {
        defined_in: t.definedIn,
        used_by: t.usedBy.map((p) =>
          path.posix.basename(p, path.posix.extname(p))
        ),
        definition: t.definition,
      },
    ])
  );
  writeFileSyncRetrying(primaryPath, stringifyyaml(primary));
  if (cap < sharedTypes.length) {
    const full = Object.fromEntries(
      sharedTypes.map((t) => [
        t.name,
        {
          defined_in: t.definedIn,
          used_by: t.usedBy,
          definition: t.definition,
        },
      ])
    );
    writeFileSyncRetrying(fullPath, stringifyyaml(full));
    return { primaryPath, fullPath };
  }
  return { primaryPath };
}

function detectClusters(graph: DependencyGraph): Record<string, string[]> {
  const dirs = new Map<string, string[]>();
  for (const p of graph.nodes.keys()) {
    const d = dirKey(p);
    if (!dirs.has(d)) dirs.set(d, []);
    dirs.get(d)!.push(p);
  }
  const clusters: Record<string, string[]> = {};
  for (const [d, files] of dirs) {
    if (files.length < 3) continue;
    const intra = files.filter((f) => {
      const deps = graph.edges.imports.get(f) ?? new Set<string>();
      let count = 0;
      for (const dep of deps) {
        if (files.includes(dep)) count += 1;
      }
      return count >= 1;
    });
    if (intra.length >= 3) {
      const key = d ? d.replace(/[\/]/g, '-').replace(/^-+|-+$/g, '') : 'root';
      clusters[key] = intra.sort();
    }
  }
  return clusters;
}

export function writeGraphyaml(
  outputDir: string,
  graph: DependencyGraph
): { primaryPath: string; fullPath?: string } {
  const fullEdges: Record<string, string[]> = {};
  for (const p of [...graph.nodes.keys()].sort()) {
    const imports = [...(graph.edges.imports.get(p) ?? new Set<string>())].sort();
    if (imports.length) fullEdges[p] = imports;
  }
  const clusters = detectClusters(graph);
  const payloadBase = Object.keys(clusters).length ? { clusters } : {};
  const primaryPath = path.join(outputDir, 'graph.yaml');
  const fullPath = path.join(outputDir, 'graph.full.yaml');
  if (Object.keys(fullEdges).length > 100) {
    const filtered = Object.fromEntries(
      Object.entries(fullEdges).filter(([, imports]) => imports.length >= 5)
    );
    writeFileSyncRetrying(
      primaryPath,
      stringifyyaml({ edges: filtered, ...payloadBase })
    );
    writeFileSyncRetrying(
      fullPath,
      stringifyyaml({ edges: fullEdges, ...payloadBase })
    );
    return { primaryPath, fullPath };
  }
  writeFileSyncRetrying(
    primaryPath,
    stringifyyaml({ edges: fullEdges, ...payloadBase })
  );
  return { primaryPath };
}

export function writeIndexyaml(params: {
  outputDir: string;
  graph: DependencyGraph;
  projectName: string;
  framework?: string;
  generatedISO: string;
  totalTokens: number;
  rawTokens: number;
  splitThreshold: number;
}) {
  const {
    outputDir,
    graph,
    projectName,
    framework,
    generatedISO,
    totalTokens,
    rawTokens,
    splitThreshold,
  } = params;
  const allFiles = [...graph.nodes.values()].sort((a, b) =>
    a.path.localeCompare(b.path)
  );
  const reduction =
    rawTokens > 0 ? ((rawTokens - totalTokens) / rawTokens) * 100 : 0;

  const byDir = new Map<string, FileAnalysis[]>();
  for (const a of allFiles) {
    const d = dirKey(a.path);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d)!.push(a);
  }

  const filesSection: Record<string, unknown> = {};
  const structureSection: Record<string, string> = {};
  const subIndexDir = path.join(outputDir, 'index');
  let needSubIndex = false;

  for (const [d, list] of [...byDir.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    structureSection[d || './'] = `${list.length} files`;
    if (list.length > splitThreshold) {
      needSubIndex = true;
      const subPath = path.join(
        subIndexDir,
        `${(d || 'root').replace(/[\/]/g, '_')}.yaml`
      );
      fs.mkdirSync(path.dirname(subPath), { recursive: true });
      const subPayload = Object.fromEntries(
        list.map((a) => [
          a.path,
          {
            summary: shortSummary(a.summary),
            exports: a.exports.map((e) => e.name),
          },
        ])
      );
      writeFileSyncRetrying(subPath, stringifyyaml({ files: subPayload }));
      filesSection[d || './'] = {
        grouped: true,
        count: list.length,
        sub_index: path.relative(outputDir, subPath),
      };
    } else {
      for (const a of list) {
        filesSection[a.path] = {
          summary: shortSummary(a.summary),
          exports: a.exports.map((e) => e.name),
        };
      }
    }
  }

  const payload: Record<string, unknown> = {
    project: projectName,
    framework,
    generated: generatedISO,
    stats: {
      files: allFiles.length,
      total_tokens: totalTokens,
      raw_tokens: rawTokens,
      reduction: `${reduction.toFixed(1)}%`,
    },
    files: filesSection,
  };
  if (needSubIndex) {
    payload.structure = structureSection;
    payload.has_sub_indexes = true;
  }
  const p = path.join(outputDir, 'index.yaml');
  writeFileSyncRetrying(p, stringifyyaml(payload));
  return p;
}

export function writeSplitContext(params: {
  projectRoot: string;
  outputDir: string;
  graph: DependencyGraph;
  config: ToonConfig;
  projectName: string;
  framework?: string;
  generatedISO: string;
  rawTokens: number;
}): SplitEmitResult {
  const {
    outputDir,
    graph,
    config,
    projectName,
    framework,
    generatedISO,
    rawTokens,
  } = params;
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'files'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'scopes'), { recursive: true });

  const fileyamlPaths = [...graph.nodes.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((a) => writeFileyaml(outputDir, a, graph));

  const sharedTypes = computeSharedTypesDetailed(graph);
  const typesResult = writeTypesyaml(
    outputDir,
    sharedTypes,
    config.splitThreshold ?? 15
  );
  const graphResult = writeGraphyaml(outputDir, graph);

  const indexPath = writeIndexyaml({
    outputDir,
    graph,
    projectName,
    framework,
    generatedISO,
    totalTokens: 0,
    rawTokens,
    splitThreshold: config.splitThreshold ?? 15,
  });

  const generatedFiles = [
    indexPath,
    graphResult.primaryPath,
    typesResult.primaryPath,
    ...fileyamlPaths,
    ...(graphResult.fullPath ? [graphResult.fullPath] : []),
    ...(typesResult.fullPath ? [typesResult.fullPath] : []),
  ];
  const totalTokens = generatedFiles.reduce(
    (sum, p) => sum + countTokens(fs.readFileSync(p, 'utf8')),
    0
  );

  writeIndexyaml({
    outputDir,
    graph,
    projectName,
    framework,
    generatedISO,
    totalTokens,
    rawTokens,
    splitThreshold: config.splitThreshold ?? 15,
  });

  const alwaysReadTokens = [
    indexPath,
    graphResult.primaryPath,
    typesResult.primaryPath,
  ]
    .map((p) => countTokens(fs.readFileSync(p, 'utf8')))
    .reduce((a, b) => a + b, 0);

  return {
    indexPath,
    graphPath: graphResult.primaryPath,
    typesPath: typesResult.primaryPath,
    graphFullPath: graphResult.fullPath,
    typesFullPath: typesResult.fullPath,
    fileyamlPaths,
    totalTokens,
    alwaysReadTokens,
  };
}
