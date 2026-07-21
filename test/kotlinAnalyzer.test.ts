import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeFile } from '../src/analyzer/index';
import { fixtureRoot, defaultTestConfig } from './helpers';

describe('Kotlin analyzer', () => {
  const projectRoot = fixtureRoot('kotlin-pkg');
  const config = defaultTestConfig(projectRoot);

  it('extracts functions, classes, interfaces, and enums', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'com/example/Calculator.kt'),
      config,
    });

    expect(analysis.language).toBe('kotlin');
    expect(analysis.exports.map((e) => e.name).sort()).toEqual(
      ['Color', 'Point', 'Shape', 'add'].sort()
    );

    const add = analysis.signatures.find((s) => s.name === 'add')!;
    expect(add.params.map((p) => p.name)).toEqual(['a', 'b']);
    expect(add.returnType).toBe('Int');

    const secret = analysis.signatures.find((s) => s.name === 'secret')!;
    expect(secret.isExported).toBe(false);

    const sum = analysis.signatures.find((s) => s.name === 'Point.sum')!;
    expect(sum.isExported).toBe(true);
    expect(sum.returnType).toBe('Int');

    const hidden = analysis.signatures.find((s) => s.name === 'Point.hidden')!;
    expect(hidden.isExported).toBe(false);

    const point = analysis.types.find((t) => t.name === 'Point')!;
    expect(point.kind).toBe('class');
    expect(point.definition).toContain('x: Int');

    const shape = analysis.types.find((t) => t.name === 'Shape')!;
    expect(shape.kind).toBe('interface');

    const color = analysis.types.find((t) => t.name === 'Color')!;
    expect(color.kind).toBe('enum');
    expect(color.definition).toContain('RED');

    expect(analysis.imports.some((i) => i.source === 'kotlin.math.PI')).toBe(
      true
    );
  });

  it('detects files under a test/ dir as test type', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'com/example/test/CalculatorTest.kt'),
      config,
    });
    expect(analysis.type).toBe('test');
  });
});
