import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeFile } from '../src/analyzer/index';
import { buildProjectGraph } from '../src/compiler/buildGraph';
import { fixtureRoot, defaultTestConfig } from './helpers';

describe('tsconfig path alias resolution', () => {
  const projectRoot = fixtureRoot('ts-paths');
  const config = defaultTestConfig(projectRoot);

  it('resolves an `@/*` alias import to its baseUrl+paths target file', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'src/index.ts'),
      config,
    });

    const imp = analysis.imports.find((i) => i.source === '@/utils/math')!;
    expect(imp).toBeTruthy();
    expect(imp.resolvedPath).toBe('src/utils/math.ts');
  });

  it('produces a graph edge for the alias-resolved import', async () => {
    const graph = await buildProjectGraph({ projectRoot, config, useCache: false });

    const deps = graph.edges.imports.get('src/index.ts') ?? new Set();
    expect(deps.has('src/utils/math.ts')).toBe(true);
    const importedBy = graph.edges.importedBy.get('src/utils/math.ts') ?? new Set();
    expect(importedBy.has('src/index.ts')).toBe(true);
  });
});

describe('tsconfig path alias pointed at build output (dist/)', () => {
  // Mirrors a common monorepo layout (e.g. a workspace package whose
  // `paths` alias points at its compiled `dist/` — resolving how it would
  // once published — while `dist/**` is excluded from analysis like any
  // other build output). Resolving literally to the `.js`/`.d.ts` in
  // `dist/` would create a graph edge to a file that is never analyzed
  // (silently excluded), instead of the real TypeScript source sitting
  // right next to it under `lib/`.
  const projectRoot = fixtureRoot('ts-paths-dist');
  const config = { ...defaultTestConfig(projectRoot), include: ['src', 'pkg'] };

  it('resolves an alias pointed at dist/ to the mirrored source file, not the compiled output', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'src/index.ts'),
      config,
    });

    const imp = analysis.imports.find((i) => i.source === '@pkg/lib/helper')!;
    expect(imp).toBeTruthy();
    expect(imp.resolvedPath).toBe('pkg/lib/helper.ts');
  });

  it('produces a graph edge that lands on an actually-analyzed node', async () => {
    const graph = await buildProjectGraph({ projectRoot, config, useCache: false });

    const deps = graph.edges.imports.get('src/index.ts') ?? new Set();
    expect(deps.has('pkg/lib/helper.ts')).toBe(true);
    expect(graph.nodes.has('pkg/lib/helper.ts')).toBe(true);
    for (const dep of deps) {
      expect(dep).not.toMatch(/\/dist\//);
    }
  });
});
