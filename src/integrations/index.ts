import fs from 'node:fs';
import path from 'node:path';
import type { ToonConfig } from '../types';

export interface DetectedTools {
  agents: boolean;
  claudeCode: boolean;
  cursor: boolean;
  copilot: boolean;
  gemini: boolean;
  windsurf: boolean;
}

export interface IntegrationStats {
  fileCount: number;
  reductionPct: number;
}

export interface IntegrationUpdateResult {
  path: string;
  action: 'created' | 'updated' | 'unchanged' | 'skipped' | 'warning';
  note?: string;
}

const START = '<!-- toonscope:start -->';
const END = '<!-- toonscope:end -->';

function inPath(cmd: string): boolean {
  try {
    const pathEnv =
      process.env.PATH ?? process.env.Path ?? process.env.path ?? '';
    const dirs = pathEnv.split(path.delimiter).filter(Boolean);
    const extensions =
      process.platform === 'win32'
        ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
            .split(';')
            .map((e) => e.toLowerCase())
        : [''];
    const hasExt = path.extname(cmd) !== '';

    for (const dir of dirs) {
      for (const ext of hasExt ? [''] : extensions) {
        try {
          const candidate = path.join(dir, `${cmd}${ext}`);
          const stat = fs.statSync(candidate);
          if (stat.isFile()) return true;
        } catch {
          // Missing file or inaccessible directory => keep scanning
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function detectTools(projectRoot: string): DetectedTools {
  const ex = (p: string) => {
    try {
      return fs.existsSync(path.join(projectRoot, p));
    } catch {
      return false;
    }
  };
  return {
    agents: true,
    claudeCode: ex('CLAUDE.md') || ex('.claude') || inPath('claude'),
    cursor: ex('.cursor') || ex('.cursorrules'),
    copilot: ex('.github') || ex('.github/copilot-instructions.md'),
    gemini: ex('GEMINI.md') || inPath('gemini'),
    windsurf: ex('.windsurf') || ex('.windsurfrules'),
  };
}

function upsertMarkedSection(
  filePath: string,
  section: string
): IntegrationUpdateResult {
  const wrapped = `${START}\n${section.trim()}\n${END}\n`;
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${wrapped}`, 'utf8');
    return { path: filePath, action: 'created' };
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const s = raw.indexOf(START);
  const e = raw.indexOf(END);
  if (s !== -1 && e !== -1 && e > s) {
    const before = raw.slice(0, s).replace(/\s*$/, '\n');
    const after = raw.slice(e + END.length).replace(/^\s*/, '\n');
    const next = `${before}${wrapped}${after}`.replace(/\n{3,}/g, '\n\n');
    if (next === raw) return { path: filePath, action: 'unchanged' };
    fs.writeFileSync(filePath, next, 'utf8');
    return { path: filePath, action: 'updated' };
  }
  const divider = raw.trim().length ? '\n\n---\n\n' : '';
  fs.writeFileSync(filePath, `${raw}${divider}${wrapped}`, 'utf8');
  return { path: filePath, action: 'updated', note: 'appended section' };
}

function contextBody(stats?: IntegrationStats): string[] {
  const reductionNote =
    stats && stats.fileCount > 0 && stats.reductionPct > 0
      ? ` (currently ~${stats.reductionPct.toFixed(0)}% smaller than raw source, across ${stats.fileCount} files)`
      : '';
  return [
    `ToonScope maintains a token-efficient map of this codebase in \`.toon/\`${reductionNote} — read a file's YAML summary instead of its full source when the overview is enough.`,
    '',
    '- `.toon/index.yaml` — every file: type, one-line summary, exports, connection counts (large dirs may split into `.toon/index/*.yaml` sub-indexes)',
    '- `.toon/graph.yaml` — import / imported_by edges and directory clusters',
    '- `.toon/types.yaml` — shared type definitions used across 2+ files',
    '- `.toon/files/<path>.yaml` — per-file detail: exports, every function signature (typed params/returns + docs), local types, uses/used_by',
    '',
    '**Workflow:** read `index.yaml` to locate the relevant files, then the per-file YAML(s) for files you are about to touch, instead of reading full source when the map already answers the question. For a merged dependency view of one file, run `npx toonscope scope <file> --depth 2`.',
    '',
    '**Staleness:** the map can lag behind edits until `npx toonscope generate` runs again. If `.toon/` and the source ever disagree, trust the source.',
  ];
}

function sectionAgents(stats: IntegrationStats): string {
  return ['## Codebase Context (ToonScope)', '', ...contextBody(stats)].join(
    '\n'
  );
}

function sectionClaude(stats: IntegrationStats): string {
  return ['## Codebase Context (ToonScope)', '', ...contextBody(stats)].join(
    '\n'
  );
}

function sectionCopilot(stats: IntegrationStats): string {
  return ['## Codebase Context (ToonScope)', '', ...contextBody(stats)].join(
    '\n'
  );
}

function sectionGemini(stats: IntegrationStats): string {
  return ['## Codebase Context (ToonScope)', '', ...contextBody(stats)].join(
    '\n'
  );
}

function cursorRule(stats: IntegrationStats): string {
  return (
    [
      '---',
      'description: ToonScope codebase context — read the compressed project map before working on source files',
      'globs:',
      'alwaysApply: true',
      '---',
      '',
      ...contextBody(stats),
    ].join('\n') + '\n'
  );
}

function windsurfRule(stats: IntegrationStats): string {
  return (
    [
      '---',
      'trigger: always_on',
      '---',
      '',
      ...contextBody(stats),
    ].join('\n') + '\n'
  );
}

export function applyIntegrationFiles(params: {
  projectRoot: string;
  config: ToonConfig;
  stats: IntegrationStats;
  forceGemini?: boolean;
}): IntegrationUpdateResult[] {
  const { projectRoot, config, stats, forceGemini } = params;
  const enabled = {
    agents: config.integrations?.agents ?? true,
    claude: config.integrations?.claude_code ?? false,
    cursor: config.integrations?.cursor ?? false,
    copilot: config.integrations?.copilot ?? false,
    gemini: Boolean(forceGemini || (config.integrations?.gemini ?? false)),
    windsurf: config.integrations?.windsurf ?? false,
  };

  const out: IntegrationUpdateResult[] = [];
  if (enabled.agents)
    out.push(
      upsertMarkedSection(
        path.join(projectRoot, 'AGENTS.md'),
        sectionAgents(stats)
      )
    );
  if (enabled.claude)
    out.push(
      upsertMarkedSection(
        path.join(projectRoot, 'CLAUDE.md'),
        sectionClaude(stats)
      )
    );
  if (enabled.copilot)
    out.push(
      upsertMarkedSection(
        path.join(projectRoot, '.github', 'copilot-instructions.md'),
        sectionCopilot(stats)
      )
    );
  if (enabled.gemini)
    out.push(
      upsertMarkedSection(
        path.join(projectRoot, 'GEMINI.md'),
        sectionGemini(stats)
      )
    );
  if (enabled.cursor) {
    const p = path.join(projectRoot, '.cursor', 'rules', 'toonscope.mdc');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const next = cursorRule(stats);
    const existing = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    fs.writeFileSync(p, next, 'utf8');
    out.push({
      path: p,
      action:
        existing === null
          ? 'created'
          : existing === next
            ? 'unchanged'
            : 'updated',
    });
    if (fs.existsSync(path.join(projectRoot, '.cursorrules'))) {
      out.push({
        path: path.join(projectRoot, '.cursorrules'),
        action: 'warning',
        note: 'legacy .cursorrules detected; consider migrating to .cursor/rules/*.mdc',
      });
    }
  }
  if (enabled.windsurf) {
    const p = path.join(projectRoot, '.windsurf', 'rules', 'toonscope.md');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const next = windsurfRule(stats);
    const existing = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    fs.writeFileSync(p, next, 'utf8');
    out.push({
      path: p,
      action:
        existing === null
          ? 'created'
          : existing === next
            ? 'unchanged'
            : 'updated',
    });
    if (fs.existsSync(path.join(projectRoot, '.windsurfrules'))) {
      out.push({
        path: path.join(projectRoot, '.windsurfrules'),
        action: 'warning',
        note: 'legacy .windsurfrules detected; consider migrating to .windsurf/rules/*.md',
      });
    }
  }
  return out;
}

const MANAGED_MARKDOWN_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  path.join('.github', 'copilot-instructions.md'),
  'GEMINI.md',
];
const MANAGED_RULE_FILES = [
  path.join('.cursor', 'rules', 'toonscope.mdc'),
  path.join('.windsurf', 'rules', 'toonscope.md'),
];

export function removeIntegrationBlocks(
  projectRoot: string
): IntegrationUpdateResult[] {
  const out: IntegrationUpdateResult[] = [];

  for (const rel of MANAGED_RULE_FILES) {
    const filePath = path.join(projectRoot, rel);
    if (!fs.existsSync(filePath)) continue;
    fs.unlinkSync(filePath);
    out.push({ path: filePath, action: 'updated', note: 'removed' });
  }

  for (const rel of MANAGED_MARKDOWN_FILES) {
    const filePath = path.join(projectRoot, rel);
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, 'utf8');
    const s = raw.indexOf(START);
    const e = raw.indexOf(END);
    if (s === -1 || e === -1 || e <= s) continue;
    const before = raw.slice(0, s).trimEnd();
    const after = raw.slice(e + END.length).trimStart();
    const next = [before, after].filter(Boolean).join('\n\n---\n\n');
    if (`${next}\n` === raw || (next === '' && raw.trim() === '')) {
      out.push({ path: filePath, action: 'unchanged' });
      continue;
    }
    if (next.length === 0) {
      fs.unlinkSync(filePath);
      out.push({
        path: filePath,
        action: 'updated',
        note: 'removed (file was empty after stripping)',
      });
    } else {
      fs.writeFileSync(filePath, `${next}\n`, 'utf8');
      out.push({
        path: filePath,
        action: 'updated',
        note: 'stripped ToonScope block',
      });
    }
  }

  return out;
}
