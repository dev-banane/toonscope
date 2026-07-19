import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeFile } from '../src/analyzer/index';
import { buildProjectGraph } from '../src/compiler/buildGraph';
import { fixtureRoot, defaultTestConfig } from './helpers';

describe('CommonJS extraction', () => {
  const projectRoot = fixtureRoot('commonjs-lib');
  const config = defaultTestConfig(projectRoot);

  it('reads `module.exports = { a, b }` shorthand as function exports', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'src/lib/math.js'),
      config,
    });

    expect(analysis.exports.map((e) => e.name).sort()).toEqual(['add', 'multiply']);
    expect(analysis.exports.every((e) => e.kind === 'function')).toBe(true);
    const add = analysis.signatures.find((s) => s.name === 'add')!;
    expect(add.isExported).toBe(true);
    expect(add.params.map((p) => p.name)).toEqual(['a', 'b']);
    const multiply = analysis.signatures.find((s) => s.name === 'multiply')!;
    expect(multiply.params[1]).toEqual({ name: 'b', optional: true, default: '1' });
  });

  it('reads `exports.x = ...` assignments and resolves `require()` imports', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'src/lib/logger.js'),
      config,
    });

    expect(analysis.exports.map((e) => e.name).sort()).toEqual(['LEVEL', 'log']);
    const imp = analysis.imports.find((i) => i.source === './math')!;
    expect(imp.resolvedPath).toBe('src/lib/math.js');
    expect(imp.names).toEqual(['add']);
  });

  it('reads `module.exports.x = function ...` and namespace/destructured `require()`', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'src/index.js'),
      config,
    });

    expect(analysis.exports.map((e) => e.name)).toEqual(['run']);
    const mathImport = analysis.imports.find((i) => i.source === './lib/math')!;
    expect(mathImport.resolvedPath).toBe('src/lib/math.js');
    expect(mathImport.names).toEqual(['math']);
    const loggerImport = analysis.imports.find((i) => i.source === './lib/logger')!;
    expect(loggerImport.resolvedPath).toBe('src/lib/logger.js');
    expect(loggerImport.names).toEqual(['log']);
  });

  it('produces correct graph edges across the require() chain', async () => {
    const graph = await buildProjectGraph({ projectRoot, config, useCache: false });

    const indexDeps = graph.edges.imports.get('src/index.js') ?? new Set();
    expect(indexDeps.has('src/lib/math.js')).toBe(true);
    expect(indexDeps.has('src/lib/logger.js')).toBe(true);

    const mathImportedBy = graph.edges.importedBy.get('src/lib/math.js') ?? new Set();
    expect(mathImportedBy.has('src/lib/logger.js')).toBe(true);
    expect(mathImportedBy.has('src/index.js')).toBe(true);
  });
});
