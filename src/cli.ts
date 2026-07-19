#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import {
  configFileExists,
  loadConfig,
  resolveProjectRoot,
  saveConfig,
} from './config';
import { generateContext } from './compiler/index';
import { scopeContext } from './graph/scope';
import { buildProjectGraph } from './compiler/buildGraph';
import { normalizeProjectRelativePath } from './utils/files';
import { detectFramework } from './utils/framework';
import { detectIncludeDirs, detectLanguages } from './utils/detectProject';
import { listSourceFiles, readTextFile } from './utils/files';
import { countTokens } from './utils/tokens';
import yaml from 'yaml';
import { assembleScopeYaml } from './compiler/assembler';
import { fileyamlPath } from './compiler/yaml-emitter';
import { startWatcher } from './watcher';
import {
  createProgress,
  printConfigInfo,
  printHeader,
  printNextSteps,
  printParseError,
  printScopeTree,
  printSummaryBox,
  printWatchEvent,
  type RenderOptions,
} from './cli/renderer';
import packageJson from '../package.json';
import {
  applyIntegrationFiles,
  detectTools,
  removeIntegrationBlocks,
} from './integrations';
import { writeToVault } from './vault/index';
import type { ToonConfig, ToonContext } from './types';
import {
  describeKeySources,
  maskKey,
  normalizeProviderId,
  readUserConfig,
  resolveApiKey,
  userConfigPath,
  writeUserConfig,
} from './ai/keys';

const program = new Command();
program
  .name('toonscope')
  .description('Codebase context compiler for AI tools.')
  .version(packageJson.version);

const SUPPORTED_KEY_PROVIDERS = ['google', 'anthropic', 'openai'] as const;
const SUPPORTED_AI_PROVIDERS = [
  'google',
  'anthropic',
  'openai',
  'ollama',
] as const;

function renderFlags(opts: any): RenderOptions {
  return {
    quiet: Boolean(opts?.quiet),
    json: Boolean(opts?.json),
    noColor: Boolean(opts?.color === false),
  };
}

async function promptYesNo(
  question: string,
  defaultYes: boolean = true
): Promise<boolean> {
  if (!process.stdin.isTTY) return defaultYes;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const a = String(answer ?? '')
        .trim()
        .toLowerCase();
      if (!a) return resolve(defaultYes);
      resolve(a === 'y' || a === 'yes');
    });
  });
}

async function promptText(
  question: string,
  defaultValue: string
): Promise<string> {
  if (!process.stdin.isTTY) return defaultValue;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const a = String(answer ?? '').trim();
      resolve(a || defaultValue);
    });
  });
}

async function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  const ENTER_CODES = new Set([10, 13]); // newline, carriage return
  const CTRL_C_CODE = 3;
  const CTRL_D_CODE = 4;
  const BACKSPACE_CODES = new Set([8, 127]); // backspace, delete

  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = "";
    const onData = (chunk: Buffer) => {
      const code = chunk.length === 1 ? chunk[0] : -1;
      if (code !== -1 && (ENTER_CODES.has(code) || code === CTRL_D_CODE)) {
        stdin.removeListener("data", onData);
        stdin.setRawMode?.(false);
        stdin.pause();
        process.stdout.write('\n');
        resolve(value.trim());
        return;
      }
      if (code === CTRL_C_CODE) {
        process.exit(1);
      }
      if (code !== -1 && BACKSPACE_CODES.has(code)) {
        value = value.slice(0, -1);
        return;
      }
      value += chunk.toString("utf8");
    };
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

function printNoConfigNote(
  projectRoot: string,
  opts?: { stderr?: boolean }
): void {
  const line = `  No .toonscope.yaml found — using ${projectRoot}. Run \`toonscope init\` for full setup.`;
  if (opts?.stderr) console.error(line);
  else console.log(line);
}

function syncGitignore(projectRoot: string): void {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const entry = '/.toon/';
  const legacyEntry = '.toon/';

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `${entry}\n`, 'utf8');
    return;
  }

  const raw = fs.readFileSync(gitignorePath, 'utf8');
  const lines = raw.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(entry) || lines.includes(legacyEntry)) return;
  const prefix = raw.length === 0 || raw.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(gitignorePath, `${prefix}${entry}\n`, 'utf8');
}

function addToGitignore(projectRoot: string, entries: string[]): void {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const raw = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf8')
    : '';
  const existing = new Set(raw.split(/\r?\n/).map((line) => line.trim()));
  const toAdd = entries.filter((entry) => !existing.has(entry));
  if (toAdd.length === 0) return;
  const prefix = raw.length === 0 || raw.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(gitignorePath, `${prefix}${toAdd.join('\n')}\n`, 'utf8');
}

async function runGenerate(params: {
  projectRoot: string;
  config: ToonConfig;
  ro: RenderOptions;
  configPathLabel: string;
  hasConfig: boolean;
  summarize: boolean;
  provider?: string;
  model?: string;
  apiKey?: string;
  force?: boolean;
  gemini?: boolean;
  vault?: string;
}): Promise<{ ok: boolean; ctx?: ToonContext }> {
  const {
    projectRoot,
    ro,
    configPathLabel,
    hasConfig,
    summarize,
    force,
    gemini,
    vault,
  } = params;
  let config = params.config;

  if (!ro.quiet && !ro.json) {
    console.log(`  Project root: ${projectRoot}`);
    if (!hasConfig) printNoConfigNote(projectRoot);
    console.log('');
  }

  if (summarize) {
    const providerId = normalizeProviderId(
      params.provider ?? config.ai?.provider ?? 'google'
    );
    const model = params.model ?? config.ai?.model;

    if (providerId === 'ollama') {
      config = {
        ...config,
        ai: {
          ...config.ai,
          provider: 'ollama',
          model,
          ollamaUrl: config.ai?.ollamaUrl,
        },
      };
    } else {
      const resolved = resolveApiKey(providerId, {
        flagKey: params.apiKey,
        projectConfigKey: config.ai?.apiKey,
      });
      if (!resolved) {
        console.error(
          `\n  Missing API key for provider "${providerId}". Supply one via:\n` +
            describeKeySources(providerId)
              .map((s) => `    - ${s}`)
              .join('\n') +
            '\n'
        );
        process.exitCode = 1;
        return { ok: false };
      }
      if (resolved.source === 'project-config') {
        console.warn(
          `  Warning: using AI API key from .toonscope.yaml (ai.apiKey). Prefer an environment variable or "toonscope key set ${providerId}".\n`
        );
      }
      config = {
        ...config,
        ai: {
          ...config.ai,
          provider: providerId as NonNullable<ToonConfig['ai']>['provider'],
          model,
          apiKey: resolved.key,
          concurrency: config.ai?.concurrency,
        },
      };
    }
  }

  const framework = detectFramework(projectRoot);
  const allFiles = await listSourceFiles(
    projectRoot,
    config.include,
    config.exclude,
    config.languages
  );
  printConfigInfo(
    {
      configPath: configPathLabel,
      framework,
      fileCount: allFiles.length,
      includeLabel: `${config.include.join(', ')}/`,
    },
    ro
  );

  const parseProgress = createProgress('Parsing files', allFiles.length, ro);
  const summaryProgress = createProgress(
    'Generating summaries',
    allFiles.length,
    ro
  );
  const graphProgress = createProgress('Building dependency graph', 1, ro);
  const writeProgress = createProgress('Writing .toon/ output', 1, ro);
  const start = Date.now();
  let parseStarted = Date.now();
  let summaryStarted = Date.now();
  let graphStarted = Date.now();
  let writeStarted = Date.now();

  let parseDone = false;
  let graphDone = false;
  let writeDone = false;
  const ctx = await generateContext(projectRoot, config, {
    summarize,
    force,
    onParseProgress(current, total, file) {
      parseProgress.update(current, file);
      if (current >= total && !parseDone) {
        parseDone = true;
        parseProgress.complete(
          `Parsed ${total} files`,
          Date.now() - parseStarted
        );
      }
    },
    onParseError(file, message) {
      printParseError(file, message, ro);
    },
    onSummaryProgress(current, total, file) {
      summaryProgress.update(current, file);
    },
    onPhase(phase) {
      if (phase === 'graph' && !graphDone) {
        graphDone = true;
        graphProgress.update(1, 'graph');
        graphProgress.complete(
          'Dependency graph built',
          Date.now() - graphStarted
        );
      }
      if (phase === 'write' && !writeDone) {
        writeDone = true;
        if (!parseDone) {
          parseDone = true;
          parseProgress.complete(
            `Parsed ${allFiles.length} files`,
            Date.now() - parseStarted
          );
        }
        summaryProgress.complete(
          `Generated ${allFiles.length} summaries`,
          Date.now() - summaryStarted
        );
        writeProgress.update(1, '.toon/');
        writeProgress.complete(
          'Written split output to .toon/',
          Date.now() - writeStarted
        );
      }
    },
  });

  const absFiles = allFiles;
  let rawTokens = 0;
  let largestPath = '';
  let largestRaw = 0;
  for (const relPath of absFiles) {
    const absPath = path.join(projectRoot, relPath);
    const raw = readTextFile(absPath);
    const t = countTokens(raw);
    rawTokens += t;
    if (t > largestRaw) {
      largestRaw = t;
      largestPath = relPath;
    }
  }

  const compressedTokens = ctx.meta.totalTokens;
  const reduction =
    rawTokens > 0 ? ((rawTokens - compressedTokens) / rawTokens) * 100 : 0;
  const outputDir = path.isAbsolute(config.output)
    ? config.output
    : path.join(projectRoot, config.output);

  let largestFile: { path: string; raw: number; toon: number; pctSaved: number } | undefined;
  if (largestPath) {
    const largestYamlPath = fileyamlPath(outputDir, largestPath);
    const largestToon = fs.existsSync(largestYamlPath)
      ? countTokens(fs.readFileSync(largestYamlPath, 'utf8'))
      : 0;
    largestFile = {
      path: largestPath,
      raw: largestRaw,
      toon: largestToon,
      pctSaved: largestRaw > 0 ? ((largestRaw - largestToon) / largestRaw) * 100 : 0,
    };
  }
  const graphYaml = yaml.parse(
    fs.readFileSync(path.join(outputDir, 'graph.yaml'), 'utf8')
  ) as any;
  const typesYaml = yaml.parse(
    fs.readFileSync(path.join(outputDir, 'types.yaml'), 'utf8')
  ) as any;
  const depClusters = Object.keys(graphYaml?.clusters ?? {}).length;
  const outputFiles = countOutputFiles(outputDir);
  // graph.yaml only stores forward (`imports`) edges; derive "most
  // imported" (fan-in) by inverting them in memory.
  const importedByCounts = new Map<string, number>();
  for (const targets of Object.values(graphYaml?.edges ?? {}) as string[][]) {
    for (const target of targets ?? []) {
      importedByCounts.set(target, (importedByCounts.get(target) ?? 0) + 1);
    }
  }
  const mostConnected = [...importedByCounts.entries()]
    .map(([path, importedBy]) => ({ path, importedBy }))
    .sort((a, b) => b.importedBy - a.importedBy)[0];

  printSummaryBox(
    {
      totalMs: Date.now() - start,
      filesAnalyzed: absFiles.length,
      outputFiles,
      sharedTypes: Object.keys(typesYaml ?? {}).length,
      depClusters,
      rawTokens,
      toonTokens: compressedTokens,
      reductionPct: reduction,
      largestFile,
      mostConnected,
      summariesLine:
        summarize && config.ai
          ? ctx.meta.aiSummary
            ? `${ctx.meta.aiSummary.succeeded} generated, ${ctx.meta.aiSummary.cached} cached${ctx.meta.aiSummary.failed ? `, ${ctx.meta.aiSummary.failed} failed (kept template)` : ''} via ${config.ai.model ?? config.ai.provider}`
            : `${absFiles.length} via ${config.ai.model ?? config.ai.provider}`
          : undefined,
      parseErrors: ctx.meta.errors?.count,
    },
    ro
  );
  // Only touch integration files (AGENTS.md etc.) when the user actually
  // initialized this directory — never based on an implicitly resolved root.
  const integrationResults = hasConfig
    ? applyIntegrationFiles({
        projectRoot,
        config,
        stats: { fileCount: absFiles.length, reductionPct: reduction },
        forceGemini: Boolean(gemini),
      })
    : [];
  if (!ro.quiet && !ro.json) {
    for (const r of integrationResults) {
      const rel = path.relative(projectRoot, r.path);
      const icon = r.action === 'warning' ? '!' : '✔';
      const text =
        r.action === 'created'
          ? 'Created'
          : r.action === 'updated'
            ? 'Updated'
            : r.action === 'warning'
              ? 'Warning'
              : 'Kept';
      console.log(`  ${icon} ${text} ${rel}${r.note ? ` (${r.note})` : ''}`);
    }
    console.log('');
  }
  if (vault) {
    const vaultDir = path.isAbsolute(vault)
      ? vault
      : path.resolve(projectRoot, vault);
    const projectName = path.basename(projectRoot);
    const result = writeToVault({
      vaultDir,
      projectName,
      projectRoot,
      framework: framework ?? undefined,
      ctx,
    });
    if (!ro.quiet && !ro.json) {
      console.log(
        `  ✔ Vault memory written → ${path.relative(projectRoot, result.memoryPath)}`
      );
      console.log(
        `  ✔ MEMORY.md updated    → ${path.relative(projectRoot, result.indexPath)}`
      );
      console.log('');
    }
    if (ro.json) {
      console.log(
        JSON.stringify(
          {
            vault: {
              memoryPath: result.memoryPath,
              indexPath: result.indexPath,
            },
          },
          null,
          2
        )
      );
    }
  }

  return { ok: true, ctx };
}

program
  .command('init')
  .description('Initialize .toonscope.yaml and ToonScope integration files')
  .option('--config <path>', 'Path to write .toonscope.yaml')
  .option('--quiet', 'Reduce output to essentials')
  .option('--json', 'Print machine-readable summary')
  .option('--no-color', 'Disable terminal colors')
  .option('--gemini', 'Enable GEMINI.md integration')
  .action(async (opts) => {
    const ro = renderFlags(opts);
    try {
      printHeader(packageJson.version, ro);
      const projectRoot = resolveProjectRoot(process.cwd());
      const cfgPath = opts.config
        ? path.resolve(projectRoot, opts.config)
        : path.join(projectRoot, '.toonscope.yaml');

      // Step 1: detect project
      const framework = detectFramework(projectRoot);
      const includeDirs = detectIncludeDirs(projectRoot);
      const languages = await detectLanguages(projectRoot, includeDirs);
      const detected = detectTools(projectRoot);

      if (!ro.quiet && !ro.json) {
        console.log('  Detected project:');
        console.log(`    Framework:    ${framework ?? '(none detected)'}`);
        console.log(`    Languages:    ${languages.join(', ')}`);
        console.log(`    Source dirs:  ${includeDirs.join(', ')}`);
        console.log('');
        console.log('  Detected AI tools:');
        console.log(
          `    ◉ AGENTS.md              (universal standard — always generated)`
        );
        console.log(
          `    ${detected.claudeCode ? '◉' : '○'} CLAUDE.md                (${detected.claudeCode ? 'detected' : 'not detected'})`
        );
        console.log(
          `    ${detected.cursor ? '◉' : '○'} .cursor/rules/           (${detected.cursor ? 'detected' : 'not detected'})`
        );
        console.log(
          `    ${detected.copilot ? '◉' : '○'} copilot-instructions.md  (${detected.copilot ? 'detected' : 'not detected'})`
        );
        console.log(
          `    ${detected.gemini || opts.gemini ? '◉' : '○'} GEMINI.md                (${detected.gemini || opts.gemini ? 'detected' : 'not detected'})`
        );
        console.log(
          `    ${detected.windsurf ? '◉' : '○'} .windsurf/rules/         (${detected.windsurf ? 'detected' : 'not detected'})`
        );
        console.log('');
      }

      // Step 2: write .toonscope.yaml
      let cfg = loadConfig(projectRoot, opts.config);
      cfg = {
        ...cfg,
        include: includeDirs,
        languages,
        gitignoreToon: cfg.gitignoreToon ?? true,
      };
      saveConfig(projectRoot, cfg, opts.config);
      if (cfg.gitignoreToon !== false) syncGitignore(projectRoot);

      // Step 3: AI summaries
      const wantAI = await promptYesNo(
        '  Optionally use a cheap+fast LLM for better summaries (recommended: Google Gemini Flash or Claude Haiku). Configure now? (y/N) ',
        false
      );
      let aiConfigured = false;
      if (wantAI) {
        const providerAnswer = (
          await promptText(
            '  Provider (google/anthropic/openai/ollama) [google]: ',
            'google'
          )
        ).toLowerCase();
        const providerId = normalizeProviderId(providerAnswer);
        if (!SUPPORTED_AI_PROVIDERS.includes(providerId as any)) {
          console.log(
            `  Unknown provider "${providerAnswer}" — skipping AI setup. Configure later with "toonscope key set <provider>".\n`
          );
        } else if (providerId === 'ollama') {
          cfg = { ...cfg, ai: { provider: 'ollama' } };
          aiConfigured = true;
          if (!ro.quiet && !ro.json) {
            console.log(
              '  Using Ollama — make sure `ollama serve` is running locally with a model pulled.\n'
            );
          }
        } else {
          const existing = resolveApiKey(providerId);
          if (existing) {
            if (!ro.quiet && !ro.json) {
              const sourceLabel =
                existing.source === 'env'
                  ? `env var ${existing.envVar}`
                  : existing.source;
              console.log(
                `  Found a ${providerId} API key via ${sourceLabel} — using it.\n`
              );
            }
          } else {
            const shouldStore = await promptYesNo(
              `  No ${providerId} API key found. Store one now? (y/N) `,
              false
            );
            if (shouldStore) {
              const key = await promptHidden(
                `  Enter API key for ${providerId}: `
              );
              if (key) {
                const userCfg = readUserConfig();
                userCfg.keys = { ...(userCfg.keys ?? {}), [providerId]: key };
                const written = writeUserConfig(userCfg);
                if (!ro.quiet && !ro.json) {
                  console.log(`  Saved ${providerId} API key to ${written}\n`);
                }
              }
            } else if (!ro.quiet && !ro.json) {
              console.log(
                `  Skipping key setup. Run "toonscope key set ${providerId}" any time before using --summarize.\n`
              );
            }
          }
          cfg = { ...cfg, ai: { provider: providerId as any } };
          aiConfigured = true;
        }
      } else if (!ro.quiet && !ro.json) {
        console.log(
          '  Skipping AI summaries. Run "toonscope key set <provider>" and "toonscope generate --summarize" any time later.\n'
        );
      }
      saveConfig(projectRoot, cfg, opts.config);

      // Step 4: integration files
      const shouldGenerateIntegrations = await promptYesNo(
        '  Generate integration files? (Y/n) ',
        true
      );
      let includeNonDetected = false;
      if (shouldGenerateIntegrations) {
        includeNonDetected = await promptYesNo(
          '  Include non-detected AI integrations too? (y/N) ',
          false
        );
      }
      cfg = {
        ...cfg,
        integrations: {
          ...(cfg.integrations ?? {}),
          agents: true,
          claude_code: includeNonDetected ? true : detected.claudeCode,
          cursor: includeNonDetected ? true : detected.cursor,
          copilot: includeNonDetected ? true : detected.copilot,
          gemini: includeNonDetected
            ? true
            : detected.gemini || Boolean(opts.gemini),
          windsurf: includeNonDetected ? true : detected.windsurf,
        },
      };
      saveConfig(projectRoot, cfg, opts.config);

      const outDir = path.join(projectRoot, '.toon');
      fs.mkdirSync(outDir, { recursive: true });

      if (shouldGenerateIntegrations) {
        const results = applyIntegrationFiles({
          projectRoot,
          config: cfg,
          stats: { fileCount: 0, reductionPct: 0 },
          forceGemini: Boolean(opts.gemini),
        });
        if (!ro.quiet && !ro.json) {
          for (const r of results) {
            const rel = path.relative(projectRoot, r.path);
            const symbol = r.action === 'skipped' ? '⊘' : '✔';
            const verb =
              r.action === 'created'
                ? 'Created'
                : r.action === 'updated'
                  ? 'Updated'
                  : r.action === 'warning'
                    ? 'Warning'
                    : 'Kept';
            console.log(
              `  ${symbol} ${verb} ${rel}${r.note ? `  (${r.note})` : ''}`
            );
          }
          console.log('');
        }

        const writtenResults = results.filter((r) => r.action !== 'skipped');
        if (writtenResults.length > 0) {
          const shouldGitignoreIntegrations = await promptYesNo(
            '  Add generated integration files (AGENTS.md, CLAUDE.md, etc.) to .gitignore? (y/N) ',
            false
          );
          if (shouldGitignoreIntegrations) {
            const entries = writtenResults.map(
              (r) =>
                `/${path.relative(projectRoot, r.path).split(path.sep).join('/')}`
            );
            addToGitignore(projectRoot, entries);
            if (!ro.quiet && !ro.json) {
              console.log(
                `  Added ${entries.length} integration file(s) to .gitignore.\n`
              );
            }
          }
        }
      }

      if (framework) {
        printConfigInfo(
          {
            configPath: path.relative(projectRoot, cfgPath),
            framework,
            fileCount: 0,
            includeLabel: `${includeDirs.join(', ')}/`,
          },
          ro
        );
      }

      // Step 5: run initial generation
      const shouldRunGenerate = await promptYesNo(
        '  Run initial generation now? (Y/n) ',
        true
      );
      if (shouldRunGenerate) {
        const result = await runGenerate({
          projectRoot,
          config: cfg,
          ro,
          configPathLabel: path.relative(projectRoot, cfgPath),
          // init just wrote the config a few lines above.
          hasConfig: true,
          summarize: aiConfigured,
          gemini: Boolean(opts.gemini),
        });
        if (result.ok) printNextSteps(ro);
      } else if (!ro.quiet && !ro.json) {
        console.log('  Skipped. Run `toonscope generate` any time to build .toon/.\n');
      }

      if (ro.json) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              projectRoot,
              integrations: cfg.integrations,
              ai: cfg.ai,
              ranGenerate: shouldRunGenerate,
            },
            null,
            2
          )
        );
      } else if (!ro.quiet) {
        console.log(`ToonScope initialized in ${projectRoot}`);
      }
    } catch (err) {
      console.error(
        `\n  Fatal error: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exitCode = 1;
    }
  });

program
  .command('generate')
  .description('Analyze and generate split .toon yaml context')
  .option('--config <path>', 'Path to .toonscope.yaml')
  .option('--summarize', 'Enable optional LLM summarization if configured')
  .option(
    '--provider <provider>',
    'AI provider for --summarize: google, anthropic, openai, or ollama'
  )
  .option('--model <model>', 'Override the AI model for --summarize')
  .option(
    '--api-key <key>',
    'API key for --summarize, used for this run only (never persisted)'
  )
  .option(
    '--force',
    'Ignore the on-disk cache and re-parse every file (full rebuild)'
  )
  .option('--quiet', 'Reduce output to essentials')
  .option('--json', 'Print machine-readable summary')
  .option('--no-color', 'Disable terminal colors')
  .option('--gemini', 'Force update GEMINI.md integration')
  .option(
    '--vault <path>',
    'Write a memory .md file to this vault directory (e.g. ~/.claude/projects/.../memory)'
  )
  .action(async (opts) => {
    const ro = renderFlags(opts);
    try {
      printHeader(packageJson.version, ro);
      const projectRoot = resolveProjectRoot(process.cwd());
      const config = loadConfig(projectRoot, opts.config);

      const result = await runGenerate({
        projectRoot,
        config,
        ro,
        configPathLabel: opts.config ?? '.toonscope.yaml',
        hasConfig: configFileExists(projectRoot, opts.config),
        summarize: Boolean(opts.summarize),
        provider: opts.provider,
        model: opts.model,
        apiKey: opts.apiKey,
        force: Boolean(opts.force),
        gemini: Boolean(opts.gemini),
        vault: opts.vault,
      });
      if (!result.ok) return;
      printNextSteps(ro);
    } catch (err) {
      console.error(
        `\n  Fatal error: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exitCode = 1;
    }
  });

program
  .command('scope <file>')
  .description('Output scoped dependency context around a file')
  .option('--depth <n>', 'BFS depth', (v) => Number(v), 2)
  .option('--out <path>', 'Optional output file path for scoped yaml')
  .option('--quiet', 'Reduce output to essentials')
  .option('--json', 'Print machine-readable summary')
  .option('--no-color', 'Disable terminal colors')
  .action(async (file, opts) => {
    const ro = renderFlags(opts);
    try {
      const projectRoot = resolveProjectRoot(process.cwd());
      // stderr: scope's stdout is the YAML payload itself.
      if (!ro.quiet && !ro.json && !configFileExists(projectRoot)) {
        printNoConfigNote(projectRoot, { stderr: true });
      }
      const config = loadConfig(projectRoot);
      const outputDir = path.isAbsolute(config.output)
        ? config.output
        : path.join(projectRoot, config.output);

      const absInput = path.isAbsolute(file)
        ? file
        : path.join(projectRoot, file);
      const relInput = normalizeProjectRelativePath(
        projectRoot,
        absInput
      ).replace(/^\.\//, '');

      const graph = await buildProjectGraph({
        projectRoot,
        config,
        useCache: true,
      });
      const scopedAnalyses = scopeContext(graph, relInput, opts.depth);
      const result = assembleScopeYaml({
        outputDir,
        targetFile: relInput,
        scopedAnalyses,
        graph,
        depth: opts.depth,
      });
      printScopeTree(
        relInput,
        scopedAnalyses.map((a) => ({
          path: a.path,
          depth: a.path === relInput ? 0 : 1,
          target: a.path === relInput,
        })),
        opts.depth,
        ro
      );
      if (opts.out) {
        const outPath = path.isAbsolute(opts.out)
          ? opts.out
          : path.join(projectRoot, opts.out);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, result.yaml, 'utf8');
      }
      if (ro.json) {
        console.log(
          JSON.stringify(
            {
              target: relInput,
              depth: opts.depth,
              files: result.filesIncluded,
              tokens: result.tokens,
              output: result.outputPath,
            },
            null,
            2
          )
        );
      } else {
        process.stdout.write(result.yaml);
      }
    } catch (err) {
      console.error(
        `\n  Fatal error: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exitCode = 1;
    }
  });

program
  .command('stats')
  .description('Show project token reduction stats')
  .option('--config <path>', 'Path to .toonscope.yaml')
  .option('--quiet', 'Reduce output to essentials')
  .option('--json', 'Print machine-readable summary')
  .option('--no-color', 'Disable terminal colors')
  .action(async (opts) => {
    const ro = renderFlags(opts);
    try {
      printHeader(packageJson.version, ro);
      const projectRoot = resolveProjectRoot(process.cwd());
      if (!ro.quiet && !ro.json && !configFileExists(projectRoot, opts.config)) {
        printNoConfigNote(projectRoot);
      }
      const config = loadConfig(projectRoot, opts.config);
      const ctx = await generateContext(projectRoot, config);

      const absFiles = await listSourceFiles(
        projectRoot,
        config.include,
        config.exclude,
        config.languages
      );
      let rawTokens = 0;
      for (const relPath of absFiles) {
        const absPath = path.join(projectRoot, relPath);
        rawTokens += countTokens(readTextFile(absPath));
      }

      const compressedTokens = ctx.meta.totalTokens;
      const reduction =
        rawTokens > 0 ? ((rawTokens - compressedTokens) / rawTokens) * 100 : 0;

      if (ro.json) {
        console.log(
          JSON.stringify({ rawTokens, compressedTokens, reduction }, null, 2)
        );
      } else {
        console.log(
          `Project tokens: raw=${rawTokens}, compressed=${compressedTokens}`
        );
        console.log(`Token reduction: ${reduction.toFixed(1)}%`);
      }
    } catch (err) {
      console.error(
        `\n  Fatal error: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exitCode = 1;
    }
  });

program
  .command('watch')
  .description('Watch files and incrementally rebuild split .toon yaml')
  .option('--config <path>', 'Path to .toonscope.yaml')
  .option('--quiet', 'Reduce output to essentials')
  .option('--json', 'Print machine-readable summary')
  .option('--no-color', 'Disable terminal colors')
  .action(async (opts) => {
    const ro = renderFlags(opts);
    try {
      printHeader(packageJson.version, ro);
      const projectRoot = resolveProjectRoot(process.cwd());
      if (!ro.quiet && !ro.json && !configFileExists(projectRoot, opts.config)) {
        printNoConfigNote(projectRoot);
      }
      const config = loadConfig(projectRoot, opts.config);
      const files = await listSourceFiles(
        projectRoot,
        config.include,
        config.exclude,
        config.languages
      );
      if (!ro.quiet && !ro.json) {
        console.log(
          `  ${new Date().toLocaleTimeString()}  Watching ${files.length} files in ${config.include.join(', ')}...\n`
        );
        printWatchEvent(
          {
            time: new Date().toLocaleTimeString(),
            file: 'initial build',
            lines: ['✔ Build initialized'],
            tookMs: 0,
          },
          ro
        );
      }
      await startWatcher(projectRoot, config);
    } catch (err) {
      console.error(
        `\n  Fatal error: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exitCode = 1;
    }
  });

program
  .command('clean')
  .description('Remove the .toon/ output directory (keeps .toonscope.yaml)')
  .option(
    '--integrations',
    'Also remove ToonScope-managed blocks from AGENTS.md/CLAUDE.md/etc. and delete generated cursor/windsurf rule files'
  )
  .option('--config <path>', 'Path to .toonscope.yaml')
  .option('--quiet', 'Reduce output to essentials')
  .option('--json', 'Print machine-readable summary')
  .option('--no-color', 'Disable terminal colors')
  .action(async (opts) => {
    const ro = renderFlags(opts);
    try {
      printHeader(packageJson.version, ro);
      const projectRoot = resolveProjectRoot(process.cwd());
      const config = loadConfig(projectRoot, opts.config);
      const outputDir = path.isAbsolute(config.output)
        ? config.output
        : path.join(projectRoot, config.output);

      const removed = fs.existsSync(outputDir);
      if (removed) fs.rmSync(outputDir, { recursive: true, force: true });

      const integrationResults = opts.integrations
        ? removeIntegrationBlocks(projectRoot)
        : [];

      if (ro.json) {
        console.log(
          JSON.stringify(
            {
              removed: removed ? path.relative(projectRoot, outputDir) : null,
              integrations: integrationResults,
            },
            null,
            2
          )
        );
      } else if (!ro.quiet) {
        console.log(
          removed
            ? `  ✔ Removed ${path.relative(projectRoot, outputDir)}/`
            : `  · Nothing to remove (${path.relative(projectRoot, outputDir)}/ not found)`
        );
        for (const r of integrationResults) {
          const rel = path.relative(projectRoot, r.path);
          console.log(
            `  ${r.action === 'unchanged' ? '·' : '✔'} ${r.action === 'unchanged' ? 'Unchanged' : 'Removed'} ${rel}${r.note ? ` (${r.note})` : ''}`
          );
        }
        console.log('');
      }
    } catch (err) {
      console.error(
        `\n  Fatal error: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exitCode = 1;
    }
  });

const keyCommand = program
  .command('key')
  .description('Manage stored AI provider API keys (~/.config/toonscope/config.json)');

keyCommand
  .command('set <provider>')
  .description(
    `Store an API key for a provider (${SUPPORTED_KEY_PROVIDERS.join(', ')})`
  )
  .option('--key <value>', 'API key value (omit to be prompted)')
  .action(async (provider: string, opts: { key?: string }) => {
    const id = normalizeProviderId(provider);
    if (!SUPPORTED_KEY_PROVIDERS.includes(id as any)) {
      console.error(
        `Unknown provider "${provider}". Supported: ${SUPPORTED_KEY_PROVIDERS.join(', ')}.`
      );
      process.exitCode = 1;
      return;
    }
    const key = opts.key ?? (await promptHidden(`Enter API key for ${id}: `));
    if (!key) {
      console.error('No key provided.');
      process.exitCode = 1;
      return;
    }
    const cfg = readUserConfig();
    cfg.keys = { ...(cfg.keys ?? {}), [id]: key };
    const written = writeUserConfig(cfg);
    console.log(`Saved ${id} API key to ${written}`);
  });

keyCommand
  .command('list')
  .description('List AI providers and whether a key is resolvable for each')
  .action(() => {
    console.log(`Checking ${userConfigPath()} and environment variables:\n`);
    for (const id of SUPPORTED_KEY_PROVIDERS) {
      const resolved = resolveApiKey(id);
      if (resolved) {
        const sourceLabel =
          resolved.source === 'env'
            ? `env (${resolved.envVar})`
            : resolved.source;
        console.log(`  ${id}: ${maskKey(resolved.key)}  [${sourceLabel}]`);
      } else {
        console.log(`  ${id}: (not set)`);
      }
    }
  });

keyCommand
  .command('remove <provider>')
  .description('Remove a stored API key for a provider')
  .action((provider: string) => {
    const id = normalizeProviderId(provider);
    const cfg = readUserConfig();
    if (cfg.keys && id in cfg.keys) {
      delete cfg.keys[id];
      writeUserConfig(cfg);
      console.log(`Removed stored ${id} API key.`);
    } else {
      console.log(`No stored key for ${id}.`);
    }
  });

program.parse(process.argv);

function countOutputFiles(rootDir: string): number {
  if (!fs.existsSync(rootDir)) return 0;
  let count = 0;
  const stack = [rootDir];
  while (stack.length) {
    const d = stack.pop()!;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else count += 1;
    }
  }
  return count;
}
