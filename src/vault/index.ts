import fs from 'node:fs';
import path from 'node:path';
import type { ToonContext } from '../types';

export interface VaultWriteParams {
  vaultDir: string;
  projectName: string;
  projectRoot: string;
  framework?: string;
  ctx: ToonContext;
}

export interface VaultWriteResult {
  memoryPath: string;
  indexPath: string;
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const NOISE_PATTERNS = [
  /node_modules\//,
  /\/dist\//,
  /\/build\//,
  /\.d\.ts$/,
  /\/generated\//,
  /\.min\.(js|ts)$/,
  /\/__snapshots__\//,
];

function isProjectFile(p: string): boolean {
  return !NOISE_PATTERNS.some((re) => re.test(p));
}

function topByConnections(
  graph: ToonContext['graph'],
  n: number
): Array<{ path: string; exports: string[]; summary: string }> {
  return Object.entries(graph)
    .filter(([p]) => isProjectFile(p))
    .map(([p, v]) => ({
      path: p,
      exports: v.exports,
      summary: v.summary,
      score: v.uses.length + v.used_by.length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(({ path: p, exports, summary }) => ({ path: p, exports, summary }));
}

function clusterByDir(graph: ToonContext['graph']): Record<string, string[]> {
  const clusters: Record<string, string[]> = {};
  for (const p of Object.keys(graph)) {
    if (!isProjectFile(p)) continue;
    const parts = p.split('/');
    const dir = parts.length > 1 ? parts.slice(0, 2).join('/') : parts[0];
    if (!clusters[dir]) clusters[dir] = [];
    clusters[dir].push(p);
  }
  return Object.fromEntries(
    Object.entries(clusters)
      .filter(([, files]) => files.length >= 2)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10)
  );
}

function byType(graph: ToonContext['graph']): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [p, v] of Object.entries(graph)) {
    if (!isProjectFile(p)) continue;
    if (!out[v.type]) out[v.type] = [];
    out[v.type].push(p);
  }
  return out;
}

function buildMemoryBody(params: VaultWriteParams): string {
  const { projectName, projectRoot, framework, ctx } = params;
  const fileCount = Object.keys(ctx.graph).filter(isProjectFile).length;
  const byDir = clusterByDir(ctx.graph);
  const byTypeMap = byType(ctx.graph);
  const topFiles = topByConnections(ctx.graph, 8);
  const sharedTypes = Object.entries(ctx.types).slice(0, 20);

  const lines: string[] = [];

  lines.push(`Imported codebase: **${projectName}** — analyzed ${today()}.`);
  lines.push('');
  lines.push(`- **Source:** \`${projectRoot}\``);
  if (framework) lines.push(`- **Framework:** ${framework}`);
  lines.push(`- **Files:** ${fileCount}`);
  lines.push(
    `- **Tokens (compressed):** ${ctx.meta.totalTokens.toLocaleString()}`
  );
  lines.push('');

  lines.push('## Directory structure');
  lines.push('');
  for (const [dir, files] of Object.entries(byDir)) {
    lines.push(`- \`${dir}/\` — ${files.length} files`);
  }
  lines.push('');

  const typeOrder = [
    'route',
    'hook',
    'component',
    'module',
    'model',
    'config',
    'types',
    'test',
  ];
  lines.push('## File types');
  lines.push('');
  for (const t of typeOrder) {
    const files = byTypeMap[t];
    if (files?.length) lines.push(`- **${t}**: ${files.length}`);
  }
  lines.push('');

  lines.push('## Key modules (by connectivity)');
  lines.push('');
  for (const { path: p, exports, summary } of topFiles) {
    const exStr = exports.slice(0, 4).join(', ');
    lines.push(
      `- \`${p}\`${exStr ? ` — exports: ${exStr}` : ''}${summary ? `  \n  ${summary}` : ''}`
    );
  }
  lines.push('');

  const routes = (byTypeMap['route'] ?? []).slice(0, 20);
  if (routes.length) {
    lines.push('## Routes');
    lines.push('');
    for (const r of routes) {
      const exports = ctx.graph[r]?.exports.join(', ') ?? '';
      lines.push(`- \`${r}\`${exports ? ` (${exports})` : ''}`);
    }
    lines.push('');
  }

  if (sharedTypes.length) {
    lines.push('## Shared types');
    lines.push('');
    for (const [name, def] of sharedTypes) {
      const defStr = def.length > 80 ? def.slice(0, 77) + '…' : def;
      lines.push(`- **${name}**: \`${defStr}\``);
    }
    lines.push('');
  }

  lines.push(
    '**How to apply:** When working on this codebase, reference key modules above for entry points. Use `toonscope scope <file>` for focused context around a specific file.'
  );

  return lines.join('\n');
}

export function writeToVault(params: VaultWriteParams): VaultWriteResult {
  const { vaultDir, projectName, ctx } = params;

  fs.mkdirSync(vaultDir, { recursive: true });

  const memorySlug = `codebase-${slug(projectName)}`;
  const memoryFile = `${memorySlug}.md`;
  const memoryPath = path.join(vaultDir, memoryFile);
  const indexPath = path.join(vaultDir, 'MEMORY.md');

  const projectFileCount = Object.keys(ctx.graph).filter(isProjectFile).length;
  const topFiles = topByConnections(ctx.graph, 3);
  const topModules = topFiles
    .map((f) => path.posix.basename(f.path, path.posix.extname(f.path)))
    .filter((n) => n !== 'index')
    .join(', ');
  const description = [
    `Imported codebase: ${projectName}`,
    params.framework ? `${params.framework}` : '',
    `${projectFileCount} files`,
    topModules ? `key: ${topModules}` : '',
  ]
    .filter(Boolean)
    .join(' — ');

  const frontmatter = [
    '---',
    `name: ${memorySlug}`,
    `description: "${description}"`,
    'metadata:',
    '  type: reference',
    '---',
    '',
  ].join('\n');

  const body = buildMemoryBody(params);
  fs.writeFileSync(memoryPath, frontmatter + body + '\n', 'utf8');

  const hookLine = `- [${projectName} codebase](${memoryFile}) — ${description}`;
  upsertMemoryIndex(indexPath, memorySlug, memoryFile, hookLine);

  return { memoryPath, indexPath };
}

function upsertMemoryIndex(
  indexPath: string,
  slug: string,
  memoryFile: string,
  hookLine: string
): void {
  let raw = fs.existsSync(indexPath)
    ? fs.readFileSync(indexPath, 'utf8')
    : '# Memory index\n\n';

  const escapedFile = memoryFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existingRe = new RegExp(`^- \\[.*\\]\\(${escapedFile}\\).*$`, 'm');
  if (existingRe.test(raw)) {
    raw = raw.replace(existingRe, hookLine);
  } else {
    raw = raw.trimEnd() + '\n' + hookLine + '\n';
  }

  fs.writeFileSync(indexPath, raw, 'utf8');
}
