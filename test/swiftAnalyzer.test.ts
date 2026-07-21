import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeFile } from '../src/analyzer/index';
import { fixtureRoot, defaultTestConfig } from './helpers';

describe('Swift analyzer', () => {
  const projectRoot = fixtureRoot('swift-pkg');
  const config = defaultTestConfig(projectRoot);

  it('extracts functions, classes, structs, protocols, and enums', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'Point.swift'),
      config,
    });

    expect(analysis.language).toBe('swift');
    expect(analysis.exports.map((e) => e.name).sort()).toEqual(
      ['Color', 'Point', 'Shape', 'Size', 'add'].sort()
    );

    const add = analysis.signatures.find((s) => s.name === 'add')!;
    expect(add.doc).toBe('Adds two ints.');
    expect(add.params.map((p) => p.name)).toEqual(['a', 'b']);
    expect(add.returnType).toBe('Int');

    const secret = analysis.signatures.find((s) => s.name === 'secret')!;
    expect(secret.isExported).toBe(false);

    const init = analysis.signatures.find((s) => s.name === 'Point.init')!;
    expect(init.kind).toBe('constructor');
    expect(init.params.map((p) => p.name)).toEqual(['x', 'y']);

    const sum = analysis.signatures.find((s) => s.name === 'Point.sum')!;
    expect(sum.kind).toBe('method');
    expect(sum.returnType).toBe('Int');

    const size = analysis.types.find((t) => t.name === 'Size')!;
    expect(size.kind).toBe('class');
    expect(size.definition).toContain('w: Int');

    const shape = analysis.types.find((t) => t.name === 'Shape')!;
    expect(shape.kind).toBe('interface');

    const color = analysis.types.find((t) => t.name === 'Color')!;
    expect(color.kind).toBe('enum');

    expect(analysis.imports.some((i) => i.source === 'Foundation')).toBe(true);
  });

  it('detects *Tests.swift files as test type', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'PointTests.swift'),
      config,
    });
    expect(analysis.type).toBe('test');
  });
});
