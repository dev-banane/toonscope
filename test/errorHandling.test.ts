import path from 'node:path';
import fs from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fixtureRoot, defaultTestConfig } from './helpers';
import { analyzeFile } from '../src/analyzer/index';

describe('resilience to unparseable source files', () => {
  const projectRoot = fixtureRoot('broken-syntax');
  const config = defaultTestConfig(projectRoot);

  beforeEach(() => {
    fs.rmSync(path.join(projectRoot, '.toon'), {
      recursive: true,
      force: true,
    });
  });

  it('analyzeFile degrades gracefully instead of throwing on invalid syntax', async () => {
    // tree-sitter is error-tolerant (it emits ERROR nodes rather than
    // failing), so a garbled file should never crash the analyzer — this
    // pins that behavior as a regression guard.
    await expect(
      analyzeFile({
        projectRoot,
        absPath: path.join(projectRoot, 'src/broken.ts'),
        config,
      })
    ).resolves.toBeTruthy();
  });

  it('generateContext completes and includes the well-formed file even with a broken sibling', async () => {
    const { generateContext } = await import('../src/compiler/index');
    const ctx = await generateContext(projectRoot, config);

    expect(ctx.graph['src/good.ts']).toBeTruthy();
    expect(ctx.graph['src/good.ts'].exports).toContain('add');
  });

  it('does not abort the run when a file throws during analysis, and reports it', async () => {
    vi.resetModules();
    vi.doMock('../src/analyzer/index', async (importOriginal) => {
      const actual =
        await importOriginal<typeof import('../src/analyzer/index')>();
      return {
        ...actual,
        analyzeFile: vi.fn(async (params: Parameters<typeof actual.analyzeFile>[0]) => {
          if (params.absPath.replace(/\\/g, '/').endsWith('src/broken.ts')) {
            throw new Error('simulated analyzer crash');
          }
          return actual.analyzeFile(params);
        }),
      };
    });

    const { generateContext: generateContextMocked } = await import(
      '../src/compiler/index'
    );
    const ctx = await generateContextMocked(projectRoot, config);

    expect(ctx.graph['src/broken.ts']).toBeUndefined();
    expect(ctx.graph['src/good.ts']).toBeTruthy();
    expect(ctx.meta.errors?.count).toBe(1);
    expect(ctx.meta.errors?.files).toContain('src/broken.ts');

    vi.doUnmock('../src/analyzer/index');
    vi.resetModules();
  });
});
