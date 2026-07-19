import { describe, it, expect } from 'vitest';
import { runSummarization, type RunnerTask } from '../../src/ai/runner';
import { ProviderRequestError } from '../../src/ai/errors';
import type { AIProvider, SummarizeFileRequest, FileSummary } from '../../src/ai';
import { baseRequest } from './helpers';

function taskFor(path: string): RunnerTask {
  return { path, request: baseRequest({ path }) };
}

describe('runSummarization concurrency', () => {
  it('never exceeds the configured concurrency cap', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const provider: AIProvider = {
      async summarizeFile(): Promise<FileSummary> {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 15));
        inFlight -= 1;
        return { summary: 'ok' };
      },
    };

    const tasks = Array.from({ length: 20 }, (_, i) => taskFor(`file${i}.ts`));
    const { report } = await runSummarization({
      provider,
      tasks,
      concurrency: 4,
    });

    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBe(4);
    expect(report.succeeded).toBe(20);
    expect(report.failed).toBe(0);
  });
});

describe('runSummarization retries', () => {
  it('retries on a 429 and succeeds on the second attempt', async () => {
    let calls = 0;
    const provider: AIProvider = {
      async summarizeFile(): Promise<FileSummary> {
        calls += 1;
        if (calls === 1) {
          throw new ProviderRequestError('rate limited', {
            status: 429,
            retryAfterMs: 1,
          });
        }
        return { summary: 'recovered' };
      },
    };

    const { results, failures, report } = await runSummarization({
      provider,
      tasks: [taskFor('a.ts')],
      maxRetries: 3,
    });

    expect(calls).toBe(2);
    expect(results.get('a.ts')?.summary).toBe('recovered');
    expect(failures.size).toBe(0);
    expect(report.succeeded).toBe(1);
    expect(report.failed).toBe(0);
  });

  it('does not retry a non-retryable 400 and fails immediately', async () => {
    let calls = 0;
    const provider: AIProvider = {
      async summarizeFile(): Promise<FileSummary> {
        calls += 1;
        throw new ProviderRequestError('bad request', { status: 400 });
      },
    };

    const { report, failures } = await runSummarization({
      provider,
      tasks: [taskFor('a.ts')],
      maxRetries: 3,
    });

    expect(calls).toBe(1);
    expect(report.failed).toBe(1);
    expect(failures.get('a.ts')).toMatch(/bad request/);
  });

  it('falls back to a recorded failure (never throws) after persistent errors', async () => {
    let calls = 0;
    const provider: AIProvider = {
      async summarizeFile(): Promise<FileSummary> {
        calls += 1;
        throw new ProviderRequestError('still overloaded', { status: 503 });
      },
    };

    const { results, failures, report } = await runSummarization({
      provider,
      tasks: [taskFor('a.ts')],
      maxRetries: 2,
      cached: 5,
      skipped: 1,
    });

    expect(calls).toBe(3); // 1 initial + 2 retries
    expect(results.has('a.ts')).toBe(false);
    expect(failures.get('a.ts')).toMatch(/still overloaded/);
    expect(report).toEqual({ succeeded: 0, failed: 1, cached: 5, skipped: 1 });
  });

  it('does not let one persistently failing file abort the rest of the run', async () => {
    const provider: AIProvider = {
      async summarizeFile(req: SummarizeFileRequest): Promise<FileSummary> {
        if (req.path === 'bad.ts') {
          throw new ProviderRequestError('boom', { status: 500 });
        }
        return { summary: `ok:${req.path}` };
      },
    };

    const { results, failures, report } = await runSummarization({
      provider,
      tasks: [taskFor('good1.ts'), taskFor('bad.ts'), taskFor('good2.ts')],
      maxRetries: 0,
    });

    expect(results.get('good1.ts')?.summary).toBe('ok:good1.ts');
    expect(results.get('good2.ts')?.summary).toBe('ok:good2.ts');
    expect(failures.has('bad.ts')).toBe(true);
    expect(report.succeeded).toBe(2);
    expect(report.failed).toBe(1);
  });

  it('enforces a per-request timeout via AbortController', async () => {
    const provider: AIProvider = {
      summarizeFile(_req, signal): Promise<FileSummary> {
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve({ summary: 'too late' }), 2000);
          signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('aborted by timeout'));
          });
        });
      },
    };

    const { failures, report } = await runSummarization({
      provider,
      tasks: [taskFor('slow.ts')],
      timeoutMs: 20,
      maxRetries: 0,
    });

    expect(report.failed).toBe(1);
    expect(failures.get('slow.ts')).toMatch(/aborted/);
  });

  it('reports progress callbacks with the correct total', async () => {
    const provider: AIProvider = {
      async summarizeFile(): Promise<FileSummary> {
        return { summary: 'ok' };
      },
    };
    const progressCalls: Array<[number, number, string]> = [];

    await runSummarization({
      provider,
      tasks: [taskFor('a.ts'), taskFor('b.ts'), taskFor('c.ts')],
      onProgress: (current, total, file) =>
        progressCalls.push([current, total, file]),
    });

    expect(progressCalls).toHaveLength(3);
    expect(progressCalls.every(([, total]) => total === 3)).toBe(true);
  });
});
