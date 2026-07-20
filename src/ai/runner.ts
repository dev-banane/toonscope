import type { AIProvider, SummarizeFileRequest, FileSummary } from './index';
import { ProviderRequestError } from './errors';

export interface RunnerTask {
  path: string;
  request: SummarizeFileRequest;
}

export interface SummarizationReport {
  succeeded: number;
  failed: number;
  cached: number;
  skipped: number;
}

export interface RunSummarizationParams {
  provider: AIProvider;
  tasks: RunnerTask[];
  concurrency?: number;
  maxRetries?: number;
  timeoutMs?: number;
  cached?: number;
  skipped?: number;
  onProgress?: (current: number, total: number, file: string) => void;
}

export interface RunSummarizationResult {
  results: Map<string, FileSummary>;
  failures: Map<string, string>;
  report: SummarizationReport;
}

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(err: unknown): boolean {
  if (err instanceof ProviderRequestError) {
    if (err.status === 429) return true;
    if (typeof err.status === 'number' && err.status >= 500) return true;
    return typeof err.status !== 'number';
  }
  return true;
}

function backoffDelayMs(attempt: number, retryAfterMs?: number): number {
  if (typeof retryAfterMs === 'number') return retryAfterMs;
  const base = 500 * 2 ** attempt;
  const jitter = Math.random() * base * 0.5;
  return base + jitter;
}

async function summarizeWithRetry(
  provider: AIProvider,
  task: RunnerTask,
  maxRetries: number,
  timeoutMs: number
): Promise<FileSummary> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await provider.summarizeFile(
        task.request,
        controller.signal
      );
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt === maxRetries || !isRetryable(err)) throw err;
      const retryAfterMs =
        err instanceof ProviderRequestError ? err.retryAfterMs : undefined;
      await sleep(backoffDelayMs(attempt, retryAfterMs));
    }
  }
  throw lastErr;
}

export async function runSummarization(
  params: RunSummarizationParams
): Promise<RunSummarizationResult> {
  const {
    provider,
    tasks,
    concurrency = DEFAULT_CONCURRENCY,
    maxRetries = DEFAULT_MAX_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cached = 0,
    skipped = 0,
    onProgress,
  } = params;

  const results = new Map<string, FileSummary>();
  const failures = new Map<string, string>();
  const total = tasks.length;
  let completed = 0;
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= tasks.length) return;
      const task = tasks[i];
      try {
        const summary = await summarizeWithRetry(
          provider,
          task,
          maxRetries,
          timeoutMs
        );
        results.set(task.path, summary);
      } catch (err) {
        failures.set(
          task.path,
          err instanceof Error ? err.message : String(err)
        );
      } finally {
        completed += 1;
        onProgress?.(completed, total, task.path);
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, tasks.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return {
    results,
    failures,
    report: {
      succeeded: results.size,
      failed: failures.size,
      cached,
      skipped,
    },
  };
}
