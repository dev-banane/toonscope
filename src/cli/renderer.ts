import ora, { type Ora } from 'ora';
import chalkModule, { Chalk, type ChalkInstance } from 'chalk';
import figuresModule from 'figures';
import Table from 'cli-table3';
import logUpdate from 'log-update';

export interface RenderOptions {
  quiet?: boolean;
  json?: boolean;
  noColor?: boolean;
  isTTY?: boolean;
}

export interface LoadedConfigInfo {
  configPath: string;
  framework?: string;
  fileCount: number;
  includeLabel: string;
}

export interface BuildStats {
  totalMs: number;
  filesAnalyzed: number;
  outputFiles: number;
  sharedTypes: number;
  depClusters: number;
  rawTokens: number;
  toonTokens: number;
  reductionPct: number;
  largestFile?: { path: string; raw: number; toon: number; pctSaved: number };
  mostConnected?: { path: string; importedBy: number };
  summariesLine?: string;
  parseErrors?: number;
}

export interface ScopeTreeNode {
  path: string;
  depth: number;
  target?: boolean;
}

interface InternalRenderContext {
  chalk: ChalkInstance;
  symbols: {
    tick: string;
    cross: string;
    bullet: string;
    arrow: string;
    recycle: string;
  };
  useFancy: boolean;
  quiet: boolean;
  json: boolean;
}

function makeCtx(options: RenderOptions = {}): InternalRenderContext {
  const noColor = Boolean(options.noColor || process.env.NO_COLOR);
  const chalk = noColor ? new Chalk({ level: 0 }) : chalkModule;
  const isTTY = options.isTTY ?? process.stdout.isTTY;
  const useFancy = isTTY && !options.quiet && !options.json;
  const ascii = noColor || !isTTY;
  const symbols = {
    tick: ascii ? 'OK' : figuresModule.tick,
    cross: ascii ? 'X' : figuresModule.cross,
    bullet: ascii ? '*' : figuresModule.bullet,
    arrow: ascii ? '->' : figuresModule.arrowRight,
    recycle: ascii ? '~' : '↻',
  };
  return {
    chalk,
    symbols,
    useFancy,
    quiet: Boolean(options.quiet),
    json: Boolean(options.json),
  };
}

export function printHeader(version: string, options?: RenderOptions): void {
  const ctx = makeCtx(options);
  if (ctx.quiet || ctx.json) return;
  console.log(
    `  ${ctx.chalk.cyan('🔭')} ${ctx.chalk.bold.cyan('toonscope')} ${ctx.chalk.dim(`v${version}`)}\n`
  );
}

export function printConfigInfo(
  info: LoadedConfigInfo,
  options?: RenderOptions
): void {
  const ctx = makeCtx(options);
  if (ctx.quiet || ctx.json) return;
  console.log(
    `  ${ctx.chalk.green(ctx.symbols.tick)} Config loaded from ${ctx.chalk.bold(info.configPath)}`
  );
  if (info.framework) {
    console.log(
      `  ${ctx.chalk.green(ctx.symbols.tick)} Framework detected: ${ctx.chalk.bold(info.framework)}`
    );
  }
  console.log(
    `  ${ctx.chalk.green(ctx.symbols.tick)} Found ${ctx.chalk.bold(String(info.fileCount))} files in ${ctx.chalk.bold(info.includeLabel)}\n`
  );
}

function bar(
  chalk: ChalkInstance,
  current: number,
  total: number,
  width = 20
): string {
  const pct = total <= 0 ? 0 : Math.max(0, Math.min(1, current / total));
  const filled = Math.round(width * pct);
  return `${chalk.cyan('█'.repeat(filled))}${chalk.gray('░'.repeat(Math.max(0, width - filled)))}`;
}

export interface ProgressTracker {
  update(current: number, currentFile?: string): void;
  complete(summary: string, timeMs: number): void;
  fail(message: string): void;
}

export function createProgress(
  label: string,
  total: number,
  options?: RenderOptions
): ProgressTracker {
  const ctx = makeCtx(options);
  let spinner: Ora | null = null;
  let last = 0;
  if (ctx.useFancy)
    spinner = ora({ text: `  ${label}...`, discardStdin: false }).start();

  const render = (current: number, currentFile?: string) => {
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    const line1 = `  ${spinner?.frame() ?? '◼'} ${ctx.chalk.bold(label)}  ${current}/${total}   ${bar(ctx.chalk, current, total)}  ${percent}%`;
    const line2 = `    ${ctx.chalk.dim(currentFile ?? '')}`;
    logUpdate(`${line1}\n${line2}`);
  };

  return {
    update(current: number, currentFile?: string) {
      if (ctx.quiet || ctx.json) return;
      if (!ctx.useFancy) return;
      const now = Date.now();
      if (now - last < 100 && current < total) return;
      last = now;
      render(current, currentFile);
    },
    complete(summary: string, timeMs: number) {
      if (ctx.quiet || ctx.json) return;
      if (ctx.useFancy) {
        spinner?.stop();
        logUpdate.clear();
      }
      console.log(
        `  ${ctx.chalk.green(ctx.symbols.tick)} ${summary.padEnd(52)} ${ctx.chalk.dim(`${(timeMs / 1000).toFixed(1)}s`)}`
      );
    },
    fail(message: string) {
      if (ctx.quiet || ctx.json) return;
      if (ctx.useFancy) {
        spinner?.stop();
        logUpdate.clear();
      }
      console.log(
        `  ${ctx.chalk.red(ctx.symbols.cross)} ${ctx.chalk.red(message)}`
      );
    },
  };
}

export function printSummaryBox(
  stats: BuildStats,
  options?: RenderOptions
): void {
  const ctx = makeCtx(options);
  if (ctx.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }
  const reductionStyled =
    stats.reductionPct > 90
      ? ctx.chalk.bold.green(`${stats.reductionPct.toFixed(1)}%`)
      : ctx.chalk.bold.cyan(`${stats.reductionPct.toFixed(1)}%`);
  const table = new Table({
    chars: {
      top: '─',
      'top-mid': '┬',
      'top-left': '┌',
      'top-right': '┐',
      bottom: '─',
      'bottom-mid': '┴',
      'bottom-left': '└',
      'bottom-right': '┘',
      left: '│',
      'left-mid': '├',
      mid: '─',
      'mid-mid': '┼',
      right: '│',
      'right-mid': '┤',
      middle: '│',
    },
    style: { head: [], border: ['gray'] },
    colWidths: [22, 36],
  });
  table.push(
    [
      ctx.chalk.bold.green('Build complete'),
      ctx.chalk.dim(`${(stats.totalMs / 1000).toFixed(1)}s`),
    ],
    ['Files analyzed', String(stats.filesAnalyzed)],
    ['Output files', `${stats.outputFiles} (.toon/)`],
    ['Shared types', `${stats.sharedTypes} (types.yaml)`],
    ['Dep clusters', `${stats.depClusters} (graph.yaml)`],
    ['Raw source tokens', stats.rawTokens.toLocaleString()],
    [
      'ToonScope tokens',
      `${stats.toonTokens.toLocaleString()}  ${ctx.chalk.bold.cyan('↓')} ${reductionStyled}`,
    ],
    [
      'Largest file',
      stats.largestFile
        ? `${stats.largestFile.path}\n${stats.largestFile.raw} raw → ${stats.largestFile.toon} toon (${stats.largestFile.pctSaved.toFixed(0)}% saved)`
        : '-',
    ],
    [
      'Most connected',
      stats.mostConnected
        ? `${stats.mostConnected.path}\nimported by ${stats.mostConnected.importedBy} files`
        : '-',
    ]
  );
  if (stats.summariesLine) table.push(['Summaries', stats.summariesLine]);
  if (stats.parseErrors)
    table.push([
      'Parse errors',
      ctx.chalk.yellow(
        `${stats.parseErrors} file(s) skipped (see warnings above)`
      ),
    ]);
  console.log(`\n${table.toString()}\n`);
}

export function printParseError(
  file: string,
  message: string,
  options?: RenderOptions
): void {
  const ctx = makeCtx(options);
  if (ctx.json) return;
  console.log(
    `  ${ctx.chalk.yellow(ctx.symbols.cross)} ${ctx.chalk.yellow(`Skipped ${file}`)}`
  );
  console.log(`    ${ctx.chalk.dim(message)}`);
}

export function printWatchEvent(
  event: { time: string; file: string; lines: string[]; tookMs: number },
  options?: RenderOptions
): void {
  const ctx = makeCtx(options);
  if (ctx.json) return;
  console.log(
    `  ${ctx.chalk.dim(event.time)}  ${ctx.chalk.yellow(ctx.symbols.recycle)} ${ctx.chalk.yellow(event.file)} changed`
  );
  for (const line of event.lines) console.log(`            ${line}`);
  console.log(`            ${ctx.chalk.dim(`⏱ ${event.tookMs}ms`)}\n`);
}

export function printScopeTree(
  target: string,
  nodes: ScopeTreeNode[],
  depth: number,
  options?: RenderOptions
): void {
  const ctx = makeCtx(options);
  if (ctx.quiet || ctx.json) return;
  console.log(
    `  ${ctx.chalk.cyan('🔭')} ${ctx.chalk.bold('toonscope scope')}\n`
  );
  console.log(`  Target: ${ctx.chalk.bold.cyan(target)}`);
  console.log(`  Depth:  ${ctx.chalk.dim(String(depth))}\n`);
  console.log(`  Included files (${nodes.length}):`);
  nodes.forEach((n, i) => {
    const prefix = i === nodes.length - 1 ? '└─' : '├─';
    const label = n.target
      ? `${ctx.chalk.bold.cyan(n.path)} ${ctx.chalk.dim('(target)')}`
      : `${n.path} ${ctx.chalk.dim(`(depth ${n.depth})`)}`;
    console.log(`    ${prefix} ${label}`);
  });
  console.log('');
}

export function printError(
  message: string,
  detail?: string,
  _fatal?: boolean,
  options?: RenderOptions
): void {
  const ctx = makeCtx(options);
  if (ctx.json) return;
  console.log(
    `  ${ctx.chalk.red(ctx.symbols.cross)} ${ctx.chalk.red(message)}`
  );
  if (detail) console.log(`    ${ctx.chalk.red(detail)}`);
  console.log(`    ${ctx.chalk.dim('Skipping file, continuing build...')}\n`);
}

export interface DebugSystemInfo {
  toonscopeVersion: string;
  nodeVersion: string;
  platform: string;
  osRelease: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  totalMemGB: string;
  freeMemGB: string;
  locale: string;
  caseSensitiveFs: boolean | 'unknown';
  cwd: string;
  projectRoot: string;
  configPath: string;
  configSource: 'file' | 'default';
  include: string[];
  exclude: string[];
  languages: string[];
  output: string;
}

export function printDebugSystemInfo(
  info: DebugSystemInfo,
  options?: RenderOptions
): void {
  const ctx = makeCtx(options);
  if (ctx.json) return;
  const dim = ctx.chalk.dim;
  const label = (s: string) => ctx.chalk.bold(s.padEnd(20));
  console.log(`  ${ctx.chalk.bold.magenta('── debug: system & config ──')}`);
  console.log(`  ${label('toonscope')}${info.toonscopeVersion}`);
  console.log(`  ${label('node')}${info.nodeVersion}`);
  console.log(
    `  ${label('platform')}${info.platform} ${info.osRelease} (${info.arch})`
  );
  console.log(`  ${label('cpu')}${info.cpuModel} x${info.cpuCount}`);
  console.log(
    `  ${label('memory')}${info.freeMemGB} GB free / ${info.totalMemGB} GB total`
  );
  console.log(`  ${label('locale')}${info.locale}`);
  console.log(
    `  ${label('case-sensitive fs')}${
      info.caseSensitiveFs === 'unknown'
        ? dim('could not determine')
        : String(info.caseSensitiveFs)
    }`
  );
  console.log(`  ${label('cwd')}${info.cwd}`);
  console.log(`  ${label('project root')}${info.projectRoot}`);
  console.log(
    `  ${label('config')}${info.configPath} ${dim(`(${info.configSource})`)}`
  );
  console.log(`  ${label('include')}${info.include.join(', ')}`);
  console.log(`  ${label('exclude')}${info.exclude.join(', ')}`);
  console.log(`  ${label('languages')}${info.languages.join(', ')}`);
  console.log(`  ${label('output')}${info.output}`);
  console.log('');
}

export function printDebugFileEvent(
  kind: 'read' | 'write' | 'tokens',
  file: string,
  detail: string,
  options?: RenderOptions
): void {
  const ctx = makeCtx(options);
  if (ctx.json) return;
  const tag =
    kind === 'read'
      ? ctx.chalk.blue('[read] ')
      : kind === 'write'
        ? ctx.chalk.green('[write]')
        : ctx.chalk.yellow('[tokens]');
  console.log(`  ${tag} ${file} ${ctx.chalk.dim(detail)}`);
}

export function printNextSteps(options?: RenderOptions): void {
  const ctx = makeCtx(options);
  if (ctx.quiet || ctx.json) return;
  console.log(
    `  ${ctx.chalk.cyan(ctx.symbols.arrow)} ${ctx.chalk.bold('toonscope scope <file> --depth 2')} — merged context for one file + its neighbors`
  );
  console.log(
    `  ${ctx.chalk.cyan(ctx.symbols.arrow)} ${ctx.chalk.bold('toonscope watch')} — keep .toon/ updated as you edit`
  );
  console.log(
    `  ${ctx.chalk.cyan(ctx.symbols.arrow)} ${ctx.chalk.bold('toonscope clean')} — remove .toon/ (and, with --integrations, generated AGENTS.md/etc. blocks)\n`
  );
}
