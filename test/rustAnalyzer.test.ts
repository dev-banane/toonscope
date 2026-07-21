import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeFile } from '../src/analyzer/index';
import { fixtureRoot, defaultTestConfig } from './helpers';

describe('Rust analyzer', () => {
  const projectRoot = fixtureRoot('rust-pkg');
  const config = defaultTestConfig(projectRoot);

  it('extracts pub fns, structs, traits, enums and impl methods', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'src/models.rs'),
      config,
    });

    expect(analysis.language).toBe('rust');
    expect(analysis.exports.map((e) => e.name).sort()).toEqual(
      ['Color', 'Point', 'Shape', 'add_points'].sort()
    );

    const addPoints = analysis.signatures.find(
      (s) => s.name === 'add_points'
    )!;
    expect(addPoints.doc).toBe('Adds two points together.');
    expect(addPoints.params.map((p) => p.name)).toEqual(['a', 'b']);
    expect(addPoints.returnType).toBe('Point');

    const ctor = analysis.signatures.find((s) => s.name === 'Point.new')!;
    expect(ctor.kind).toBe('constructor');
    expect(ctor.doc).toBe('Creates a new point.');

    const sum = analysis.signatures.find((s) => s.name === 'Point.sum')!;
    expect(sum.kind).toBe('method');
    // `&self` is dropped from the param list.
    expect(sum.params.map((p) => p.name)).toEqual([]);

    const helper = analysis.signatures.find(
      (s) => s.name === 'private_helper'
    )!;
    expect(helper.isExported).toBe(false);

    const point = analysis.types.find((t) => t.name === 'Point')!;
    expect(point.kind).toBe('class');
    expect(point.definition).toContain('x: i32');

    const shape = analysis.types.find((t) => t.name === 'Shape')!;
    expect(shape.kind).toBe('interface');

    const color = analysis.types.find((t) => t.name === 'Color')!;
    expect(color.kind).toBe('enum');
    expect(color.definition).toContain('Red');

    const crateImport = analysis.imports.find((i) =>
      i.source.includes('crate::utils::helper')
    )!;
    expect(crateImport.resolvedPath).toBe('src/utils.rs');

    expect(
      analysis.imports.some((i) => i.source.includes('std::collections'))
    ).toBe(true);
  });

  it('resolves crate-relative test imports and detects the tests/ dir', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'tests/models_test.rs'),
      config,
    });
    expect(analysis.type).toBe('test');
  });
});
