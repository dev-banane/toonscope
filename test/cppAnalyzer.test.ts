import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeFile } from '../src/analyzer/index';
import { fixtureRoot, defaultTestConfig } from './helpers';

describe('C++ analyzer', () => {
  const projectRoot = fixtureRoot('cpp-pkg');
  const config = defaultTestConfig(projectRoot);

  it('extracts class prototypes (from headers) and free functions', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'point.hpp'),
      config,
    });

    expect(analysis.language).toBe('cpp');
    expect(analysis.exports.map((e) => e.name)).toEqual(['Point']);

    const point = analysis.types.find((t) => t.name === 'Point')!;
    expect(point.kind).toBe('class');
    expect(point.doc).toBe('Point is a 2D coordinate with basic operations.');
    expect(point.definition).toContain('x: int');

    const ctor = analysis.signatures.find((s) => s.name === 'Point.Point')!;
    expect(ctor.kind).toBe('constructor');
    expect(ctor.params.map((p) => p.name)).toEqual(['x', 'y']);

    const sum = analysis.signatures.find((s) => s.name === 'Point.sum')!;
    expect(sum.kind).toBe('method');

    const localInclude = analysis.imports.find((i) => i.source === 'point.hpp');
    expect(localInclude).toBeUndefined();
    const sysInclude = analysis.imports.find((i) => i.source === 'string')!;
    expect(sysInclude.resolvedPath).toBeNull();
  });

  it('extracts free functions defined in the .cpp file', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'point.cpp'),
      config,
    });
    const distance = analysis.signatures.find((s) => s.name === 'distance')!;
    expect(distance.doc).toBe(
      'distance computes the taxicab distance between two points.'
    );
    expect(distance.params.map((p) => p.name)).toEqual(['a', 'b']);

    const localInclude = analysis.imports.find((i) => i.source === 'point.hpp')!;
    expect(localInclude.resolvedPath).toBe('point.hpp');
  });

  it('detects *_test.cpp files as test type', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'point_test.cpp'),
      config,
    });
    expect(analysis.type).toBe('test');
  });
});
