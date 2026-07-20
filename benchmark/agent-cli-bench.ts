import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import Table from 'cli-table3';
import { loadConfig } from '../src/config';
import { listSourceFiles } from '../src/utils/files';
import { detectIncludeDirs, detectLanguages } from '../src/utils/detectProject';
import { generateContext } from '../src/compiler/index';
import { resolveApiKey } from '../src/ai/keys';
import { TASK_SETS, type AgentTask } from './agent-tasks';
import { formatInt, formatPercent } from './report';

interface ConditionResult {
  latencyMs: number;
  totalTokens: number;
  toolCalls: number;
  answer: string;
  coverage: number;
  error?: string;
  rawOutput: string;
}

interface TaskResult {
  task: AgentTask;
  raw: ConditionResult;
  toon: ConditionResult;
}

const CALL_TIMEOUT_MS = 5 * 60 * 1000;

/** Scans text for a top-level JSON object anchored on "session_id", which is how gemini -o json always starts its output. */
function extractJsonObject(text: string): any | null {
  const anchorIdx = text.lastIndexOf('"session_id"');
  if (anchorIdx === -1) return null;
  const start = text.lastIndexOf('{', anchorIdx);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function sumTokenFields(obj: any, seen = new Set<any>()): number {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return 0;
  seen.add(obj);
  let sum = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (
      typeof value === 'number' &&
      /^total_tokens$|totalTokenCount|tokens\.total/i.test(key)
    ) {
      sum += value;
    } else if (typeof value === 'object') {
      sum += sumTokenFields(value, seen);
    }
  }
  return sum;
}

function countToolCalls(obj: any): number {
  const tools = obj?.stats?.tools ?? obj?.stats?.metrics?.tools;
  if (!tools || typeof tools !== 'object') return 0;
  let count = 0;
  for (const value of Object.values(tools)) {
    if (typeof value === 'number') count += value;
    else if (
      value &&
      typeof value === 'object' &&
      typeof (value as any).count === 'number'
    ) {
      count += (value as any).count;
    }
  }
  return count;
}

async function runGeminiCli(
  model: string | undefined,
  cwd: string,
  question: string
): Promise<ConditionResult> {
  const args = [
    '-p',
    question,
    '--approval-mode',
    'plan',
    '--skip-trust',
    '-o',
    'json',
  ];
  if (model) args.push('-m', model);

  const start = Date.now();
  const result = await new Promise<{
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }>((resolve) => {
    const child = spawn('gemini', args, { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, CALL_TIMEOUT_MS);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', () => {
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      stderr += `\nspawn error: ${e.message}`;
      resolve({ stdout, stderr, timedOut });
    });
  });
  const latencyMs = Date.now() - start;

  if (result.timedOut) {
    return {
      latencyMs,
      totalTokens: 0,
      toolCalls: 0,
      answer: '',
      coverage: 0,
      error: `Timed out after ${CALL_TIMEOUT_MS}ms`,
      rawOutput: result.stdout + result.stderr,
    };
  }

  const parsed =
    extractJsonObject(result.stdout) ?? extractJsonObject(result.stderr);
  if (!parsed) {
    return {
      latencyMs,
      totalTokens: 0,
      toolCalls: 0,
      answer: '',
      coverage: 0,
      error: `Could not parse CLI output.\nstdout: ${result.stdout.slice(0, 500)}\nstderr: ${result.stderr.slice(0, 500)}`,
      rawOutput: result.stdout + result.stderr,
    };
  }

  return {
    latencyMs,
    totalTokens: sumTokenFields(parsed.stats),
    toolCalls: countToolCalls(parsed),
    answer: parsed.response ?? '',
    coverage: 0,
    error: parsed.error ? JSON.stringify(parsed.error) : undefined,
    rawOutput: result.stdout + result.stderr,
  };
}

function fileCoverage(answer: string, relFiles: string[]): number {
  const lower = answer.toLowerCase();
  const names = [
    ...new Set(
      relFiles
        .map((f) => path.basename(f, path.extname(f)))
        .filter((n) => n.length > 3 && n !== 'index')
    ),
  ];
  if (names.length === 0) return 0;
  const hits = names.filter((n) => lower.includes(n.toLowerCase())).length;
  return (hits / names.length) * 100;
}

async function buildToonWorkspace(
  projectDir: string,
  config: ReturnType<typeof loadConfig>
): Promise<string> {
  const outputDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'toonscope-cli-bench-')
  );
  await generateContext(projectDir, { ...config, output: outputDir });
  return outputDir;
}

function appendLog(logPath: string, text: string) {
  fs.appendFileSync(logPath, text);
}

async function main() {
  const args = process.argv.slice(2);
  const projectDirArg = args.find((a) => !a.startsWith('--')) ?? '.';
  const modelArg = args.find((a) => a.startsWith('--model='));
  const model = modelArg ? modelArg.split('=')[1] : undefined;

  const setArg = args.find((a) => a.startsWith('--set='));
  const setName = setArg ? setArg.split('=')[1] : 'realistic';
  const taskSet = TASK_SETS[setName];
  if (!taskSet) {
    console.error(
      `Unknown task set "${setName}". Available: ${Object.keys(TASK_SETS).join(', ')}`
    );
    process.exit(1);
  }

  const tasksArg = args.find((a) => a.startsWith('--tasks='));
  const tasks = tasksArg
    ? taskSet.filter((t) => tasksArg.split('=')[1].split(',').includes(t.id))
    : taskSet;
  if (tasks.length === 0) {
    console.error(`No matching tasks found in set "${setName}".`);
    process.exit(1);
  }

  if (spawnSync('gemini', ['--version']).error) {
    console.error(
      'Gemini CLI not found on PATH. Install it with `npm install -g @google/gemini-cli`.'
    );
    process.exit(1);
  }

  const keyResult = resolveApiKey('google');
  if (!keyResult) {
    console.error(
      'No Gemini API key found. Set GEMINI_API_KEY (or GOOGLE_API_KEY) in your environment - ' +
        'the gemini CLI subprocess reads it directly from the environment.'
    );
    process.exit(1);
  }

  const projectDir = path.resolve(projectDirArg);

  let config = loadConfig(projectDir);
  let relFiles = await listSourceFiles(
    projectDir,
    config.include,
    config.exclude,
    config.languages
  );
  if (relFiles.length === 0) {
    const include = detectIncludeDirs(projectDir);
    const languages = await detectLanguages(projectDir, include);
    config = { ...config, include, languages };
    relFiles = await listSourceFiles(
      projectDir,
      config.include,
      config.exclude,
      config.languages
    );
  }
  if (relFiles.length === 0) {
    console.error(
      `No source files found under ${projectDir}. Nothing to benchmark.`
    );
    process.exit(1);
  }

  console.log(`Project: ${projectDir}`);
  console.log(`Files: ${relFiles.length}`);
  console.log(`Model: ${model ?? '(gemini CLI default)'}`);
  console.log('Generating ToonScope workspace...');
  const toonWorkspace = await buildToonWorkspace(projectDir, config);
  console.log(`Raw workspace: ${projectDir}`);
  console.log(`Toon workspace: ${toonWorkspace}\n`);

  const resultsDir = path.resolve('benchmark/results');
  fs.mkdirSync(resultsDir, { recursive: true });
  const timestamp = new Date(Date.now()).toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(resultsDir, `agent-cli-bench-${timestamp}.md`);
  appendLog(
    logPath,
    `# Gemini CLI agent benchmark transcript\n\n` +
      `- Project: \`${projectDir}\`\n` +
      `- Model: \`${model ?? '(gemini CLI default)'}\`\n` +
      `- Task set: \`${setName}\`\n` +
      `- Files: ${relFiles.length}\n` +
      `- Raw workspace (real project, full tool access): \`${projectDir}\`\n` +
      `- Toon workspace (only the compressed map, full tool access): \`${toonWorkspace}\`\n` +
      `- Approval mode: \`plan\` (read-only - the agent cannot edit or run anything)\n\n---\n`
  );
  console.log(`Logging full responses to: ${logPath}\n`);

  const results: TaskResult[] = [];
  for (const task of tasks) {
    console.log(`Running task: ${task.id}...`);
    const [rawRes, toonRes] = await Promise.all([
      runGeminiCli(model, projectDir, task.question),
      runGeminiCli(model, toonWorkspace, task.question),
    ]);
    rawRes.coverage = fileCoverage(rawRes.answer, relFiles);
    toonRes.coverage = fileCoverage(toonRes.answer, relFiles);

    appendLog(
      logPath,
      `\n## Task: ${task.id}\n\n` +
        `**Question:**\n\n${task.question}\n\n` +
        `### Raw workspace response\n\n` +
        `- Latency: ${rawRes.latencyMs} ms\n` +
        `- Tool calls: ${rawRes.toolCalls}\n` +
        `- Tokens (from CLI stats): ${rawRes.totalTokens}\n` +
        (rawRes.error ? `- Error: ${rawRes.error}\n` : '') +
        `\n\`\`\`\n${rawRes.answer || '(no response text - see raw output below)'}\n\`\`\`\n` +
        `\n<details><summary>Raw CLI output (raw workspace)</summary>\n\n\`\`\`\n${rawRes.rawOutput}\n\`\`\`\n\n</details>\n` +
        `\n### Toon workspace response\n\n` +
        `- Latency: ${toonRes.latencyMs} ms\n` +
        `- Tool calls: ${toonRes.toolCalls}\n` +
        `- Tokens (from CLI stats): ${toonRes.totalTokens}\n` +
        (toonRes.error ? `- Error: ${toonRes.error}\n` : '') +
        `\n\`\`\`\n${toonRes.answer || '(no response text - see raw output below)'}\n\`\`\`\n` +
        `\n<details><summary>Raw CLI output (toon workspace)</summary>\n\n\`\`\`\n${toonRes.rawOutput}\n\`\`\`\n\n</details>\n` +
        `\n---\n`
    );

    results.push({ task, raw: rawRes, toon: toonRes });
  }

  fs.rmSync(toonWorkspace, { recursive: true, force: true });

  const table = new Table({
    head: [
      'Task',
      'Raw ms',
      'Toon ms',
      'Speedup',
      'Raw tok',
      'Toon tok',
      'Tok cut',
      'Raw tools',
      'Toon tools',
      'Raw cov',
      'Toon cov',
    ],
    style: { head: [], border: [] },
  });

  let sumRawMs = 0;
  let sumToonMs = 0;
  let sumRawTok = 0;
  let sumToonTok = 0;
  let sumRawCov = 0;
  let sumToonCov = 0;

  for (const r of results) {
    sumRawMs += r.raw.latencyMs;
    sumToonMs += r.toon.latencyMs;
    sumRawTok += r.raw.totalTokens;
    sumToonTok += r.toon.totalTokens;
    sumRawCov += r.raw.coverage;
    sumToonCov += r.toon.coverage;

    const speedup =
      r.raw.latencyMs > 0
        ? ((r.raw.latencyMs - r.toon.latencyMs) / r.raw.latencyMs) * 100
        : 0;
    const tokCut =
      r.raw.totalTokens > 0
        ? ((r.raw.totalTokens - r.toon.totalTokens) / r.raw.totalTokens) * 100
        : 0;

    table.push([
      r.task.id,
      formatInt(r.raw.latencyMs),
      formatInt(r.toon.latencyMs),
      formatPercent(speedup),
      formatInt(r.raw.totalTokens),
      formatInt(r.toon.totalTokens),
      formatPercent(tokCut),
      formatInt(r.raw.toolCalls),
      formatInt(r.toon.toolCalls),
      r.raw.error
        ? `err: ${r.raw.error.replace(/\s+/g, ' ').slice(0, 30)}`
        : formatPercent(r.raw.coverage),
      r.toon.error
        ? `err: ${r.toon.error.replace(/\s+/g, ' ').slice(0, 30)}`
        : formatPercent(r.toon.coverage),
    ]);
  }

  console.log(`\n${table.toString()}\n`);

  const avgSpeedup =
    sumRawMs > 0 ? ((sumRawMs - sumToonMs) / sumRawMs) * 100 : 0;
  const avgTokCut =
    sumRawTok > 0 ? ((sumRawTok - sumToonTok) / sumRawTok) * 100 : 0;

  console.log(`Total raw latency:   ${formatInt(sumRawMs)} ms`);
  console.log(`Total toon latency:  ${formatInt(sumToonMs)} ms`);
  console.log(`Latency reduction:   ${formatPercent(avgSpeedup)}`);
  console.log(`Total raw tokens:    ${formatInt(sumRawTok)}`);
  console.log(`Total toon tokens:   ${formatInt(sumToonTok)}`);
  console.log(`Token reduction:     ${formatPercent(avgTokCut)}`);
  console.log(
    `Avg file coverage:  raw ${formatPercent(sumRawCov / results.length)}, ` +
      `toon ${formatPercent(sumToonCov / results.length)}`
  );

  appendLog(
    logPath,
    `\n## Summary\n\n` +
      `\`\`\`\n${table.toString()}\n\`\`\`\n\n` +
      `- Total raw latency: ${formatInt(sumRawMs)} ms\n` +
      `- Total toon latency: ${formatInt(sumToonMs)} ms\n` +
      `- Latency reduction: ${formatPercent(avgSpeedup)}\n` +
      `- Total raw tokens: ${formatInt(sumRawTok)}\n` +
      `- Total toon tokens: ${formatInt(sumToonTok)}\n` +
      `- Token reduction: ${formatPercent(avgTokCut)}\n` +
      `- Avg file coverage: raw ${formatPercent(sumRawCov / results.length)}, ` +
      `toon ${formatPercent(sumToonCov / results.length)}\n`
  );
  console.log(`\nFull transcript written to: ${logPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
