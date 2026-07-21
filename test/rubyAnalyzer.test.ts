import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeFile } from '../src/analyzer/index';
import { fixtureRoot, defaultTestConfig } from './helpers';

describe('Ruby analyzer', () => {
  const projectRoot = fixtureRoot('ruby-pkg');
  const config = defaultTestConfig(projectRoot);

  it('extracts methods, classes, modules and resolves require_relative', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'point.rb'),
      config,
    });

    expect(analysis.language).toBe('ruby');
    expect(analysis.exports.map((e) => e.name).sort()).toEqual(
      ['Greetable', 'Point', 'add'].sort()
    );

    const add = analysis.signatures.find((s) => s.name === 'add')!;
    expect(add.doc).toBe('Adds two numbers together.');
    expect(add.params.map((p) => p.name)).toEqual(['a', 'b']);

    const ctor = analysis.signatures.find(
      (s) => s.name === 'Point.initialize'
    )!;
    expect(ctor.kind).toBe('constructor');
    expect(ctor.doc).toBe('Creates a new point.');

    const sum = analysis.signatures.find((s) => s.name === 'Point.sum')!;
    expect(sum.kind).toBe('method');

    const greet = analysis.signatures.find(
      (s) => s.name === 'Greetable.greet'
    )!;
    expect(greet).toBeTruthy();

    const relImport = analysis.imports.find((i) => i.source === './helper')!;
    expect(relImport.resolvedPath).toBe('helper.rb');

    const gemImport = analysis.imports.find((i) => i.source === 'json')!;
    expect(gemImport.resolvedPath).toBeNull();
  });

  it('detects files under spec/ as test type', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'spec/point_spec.rb'),
      config,
    });
    expect(analysis.type).toBe('test');
    const rel = analysis.imports.find((i) => i.source === '../point')!;
    expect(rel.resolvedPath).toBe('point.rb');
  });
});
