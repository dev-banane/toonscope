import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeFile } from '../src/analyzer/index';
import { fixtureRoot, defaultTestConfig } from './helpers';

describe('Go analyzer', () => {
  const projectRoot = fixtureRoot('go-pkg');
  const config = defaultTestConfig(projectRoot);

  it('extracts exported functions, methods, structs and interfaces', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'mypkg/models.go'),
      config,
    });

    expect(analysis.language).toBe('go');
    expect(analysis.exports.map((e) => e.name).sort()).toEqual(
      ['NewPoint', 'Point', 'Shape'].sort()
    );

    const newPoint = analysis.signatures.find((s) => s.name === 'NewPoint')!;
    expect(newPoint.isExported).toBe(true);
    expect(newPoint.doc).toBe('NewPoint creates a Point.');
    expect(newPoint.params.map((p) => p.name)).toEqual(['x', 'y']);
    expect(newPoint.returnType).toBe('Point');

    const move = analysis.signatures.find((s) => s.name === 'Point.Move')!;
    expect(move.kind).toBe('method');
    expect(move.className).toBe('Point');
    expect(move.params.map((p) => p.name)).toEqual(['dx', 'dy']);

    const helper = analysis.signatures.find(
      (s) => s.name === 'unexportedHelper'
    )!;
    expect(helper.isExported).toBe(false);

    const point = analysis.types.find((t) => t.name === 'Point')!;
    expect(point.kind).toBe('class');
    expect(point.definition).toContain('X int');

    const shape = analysis.types.find((t) => t.name === 'Shape')!;
    expect(shape.kind).toBe('interface');
    expect(shape.definition).toContain('Area');

    expect(analysis.imports.some((i) => i.source === 'fmt')).toBe(true);
  });

  it('detects _test.go files as test type', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'mypkg/models_test.go'),
      config,
    });
    expect(analysis.type).toBe('test');
    expect(analysis.exports.map((e) => e.name)).toEqual(['TestNewPoint']);
  });
});
