import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Table from 'cli-table3';
import { loadConfig } from '../src/config';
import { listSourceFiles, readTextFile } from '../src/utils/files';
import { detectIncludeDirs, detectLanguages } from '../src/utils/detectProject';
import { generateContext } from '../src/compiler/index';
import { resolveApiKey } from '../src/ai/keys';
import { TASK_SETS, type AgentTask } from './agent-tasks';
import { formatInt, formatPercent } from './report';

interface ConditionResult {
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  answer: string;
  coverage: number;
  error?: string;
}

interface TaskResult {
  task: AgentTask;
  raw: ConditionResult;
  toon: ConditionResult;
}

const SYSTEM_PROMPT =
  'You are an AI coding agent answering a question about a codebase. ' +
  'Use ONLY the codebase context provided below to answer. Be concise and specific.';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelayMs(body: string): number {
  const match = body.match(/retry in ([\d.]+)s/i);
  if (match) return Math.ceil(parseFloat(match[1]) * 1000) + 1000;
  return 20_000;
}

const MAX_RETRIES = 3;

async function callGemini(
  model: string,
  apiKey: string,
  context: string,
  question: string
): Promise<Omit<ConditionResult, 'coverage'> & { retries: number }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  let retries = 0;

  for (;;) {
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Codebase context:\n\n${context}\n\nQuestion: ${question}`,
                },
              ],
            },
          ],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: { temperature: 0, maxOutputTokens: 65536 },
        }),
      });
      const latencyMs = Date.now() - start;

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (res.status === 429 && retries < MAX_RETRIES) {
          retries++;
          await sleep(parseRetryDelayMs(text));
          continue;
        }
        return {
          latencyMs,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          answer: '',
          error: `${res.status} ${text}`,
          retries,
        };
      }

      const data = (await res.json()) as any;
      const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const usage = data?.usageMetadata ?? {};
      return {
        latencyMs,
        promptTokens: usage.promptTokenCount ?? 0,
        completionTokens: usage.candidatesTokenCount ?? 0,
        totalTokens: usage.totalTokenCount ?? 0,
        answer,
        retries,
      };
    } catch (e: any) {
      return {
        latencyMs: Date.now() - start,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        answer: '',
        error: String(e?.message ?? e),
        retries,
      };
    }
  }
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

async function buildRawContext(
  projectDir: string,
  relFiles: string[]
): Promise<string> {
  const parts: string[] = [];
  for (const rel of relFiles) {
    const abs = path.join(projectDir, rel);
    parts.push(`### ${rel}\n\n${readTextFile(abs)}`);
  }
  return parts.join('\n\n');
}

function listYamlFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const d = stack.pop()!;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && p.endsWith('.yaml')) out.push(p);
    }
  }
  return out;
}

async function buildToonContext(
  projectDir: string,
  config: ReturnType<typeof loadConfig>
): Promise<{ context: string; outputDir: string }> {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toonscope-bench-'));
  await generateContext(projectDir, { ...config, output: outputDir });
  const files = listYamlFiles(outputDir).sort();
  const parts = files.map(
    (p) => `### ${path.relative(outputDir, p)}\n\n${fs.readFileSync(p, 'utf8')}`
  );
  return { context: parts.join('\n\n'), outputDir };
}

function appendLog(logPath: string, text: string) {
  fs.appendFileSync(logPath, text);
}

async function main() {
  const args = process.argv.slice(2);
  const projectDirArg = args.find((a) => !a.startsWith('--')) ?? '.';
  const modelArg = args.find((a) => a.startsWith('--model='));
  const model = modelArg ? modelArg.split('=')[1] : 'gemini-2.5-flash';

  const setArg = args.find((a) => a.startsWith('--set='));
  const setName = setArg ? setArg.split('=')[1] : 'exhaustive';
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

  const projectDir = path.resolve(projectDirArg);

  const keyResult = resolveApiKey('google');
  if (!keyResult) {
    console.error(
      'No Gemini API key found. Set GEMINI_API_KEY (or GOOGLE_API_KEY) in your environment, ' +
        'or run `npx toonscope key set google`.'
    );
    process.exit(1);
  }
  const apiKey = keyResult.key;

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
  console.log(`Model: ${model}`);
  console.log('Building raw context...');
  const rawContext = await buildRawContext(projectDir, relFiles);
  console.log('Generating ToonScope context...');
  const { context: toonContext, outputDir } = await buildToonContext(
    projectDir,
    config
  );
  console.log(
    `Raw context: ~${rawContext.length} chars, ToonScope context: ~${toonContext.length} chars\n`
  );

  const resultsDir = path.resolve('benchmark/results');
  fs.mkdirSync(resultsDir, { recursive: true });
  const timestamp = new Date(Date.now()).toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(resultsDir, `agent-bench-${timestamp}.md`);
  appendLog(
    logPath,
    `# Agent benchmark transcript\n\n` +
      `- Project: \`${projectDir}\`\n` +
      `- Model: \`${model}\`\n` +
      `- Task set: \`${setName}\`\n` +
      `- Files: ${relFiles.length}\n` +
      `- Raw context: ~${rawContext.length} chars\n` +
      `- ToonScope context: ~${toonContext.length} chars\n\n---\n`
  );
  console.log(`Logging full responses to: ${logPath}\n`);

  const results: TaskResult[] = [];
  for (const task of tasks) {
    console.log(`Running task: ${task.id}...`);
    const [rawRes, toonRes] = await Promise.all([
      callGemini(model, apiKey, rawContext, task.question),
      callGemini(model, apiKey, toonContext, task.question),
    ]);

    appendLog(
      logPath,
      `\n## Task: ${task.id}\n\n` +
        `**Question:**\n\n${task.question}\n\n` +
        `### Raw context response\n\n` +
        `- Latency: ${rawRes.latencyMs} ms${rawRes.retries ? ` (after ${rawRes.retries} rate-limit retr${rawRes.retries === 1 ? 'y' : 'ies'})` : ''}\n` +
        `- Tokens: prompt=${rawRes.promptTokens}, completion=${rawRes.completionTokens}, total=${rawRes.totalTokens}\n` +
        (rawRes.error
          ? `- Error: ${rawRes.error}\n`
          : `\n\`\`\`\n${rawRes.answer}\n\`\`\`\n`) +
        `\n### ToonScope context response\n\n` +
        `- Latency: ${toonRes.latencyMs} ms${toonRes.retries ? ` (after ${toonRes.retries} rate-limit retr${toonRes.retries === 1 ? 'y' : 'ies'})` : ''}\n` +
        `- Tokens: prompt=${toonRes.promptTokens}, completion=${toonRes.completionTokens}, total=${toonRes.totalTokens}\n` +
        (toonRes.error
          ? `- Error: ${toonRes.error}\n`
          : `\n\`\`\`\n${toonRes.answer}\n\`\`\`\n`) +
        `\n---\n`
    );

    results.push({
      task,
      raw: { ...rawRes, coverage: fileCoverage(rawRes.answer, relFiles) },
      toon: { ...toonRes, coverage: fileCoverage(toonRes.answer, relFiles) },
    });
  }

  fs.rmSync(outputDir, { recursive: true, force: true });

  const table = new Table({
    head: [
      'Task',
      'Raw ms',
      'Toon ms',
      'Speedup',
      'Raw tok',
      'Toon tok',
      'Tok cut',
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
      r.raw.error
        ? `err: ${r.raw.error.replace(/\s+/g, ' ').slice(0, 40)}`
        : formatPercent(r.raw.coverage),
      r.toon.error
        ? `err: ${r.toon.error.replace(/\s+/g, ' ').slice(0, 40)}`
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
