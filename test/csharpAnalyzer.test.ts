import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeFile } from '../src/analyzer/index';
import { fixtureRoot, defaultTestConfig } from './helpers';

describe('C# analyzer', () => {
  const projectRoot = fixtureRoot('csharp-pkg');
  const config = defaultTestConfig(projectRoot);

  it('extracts public classes, methods, interfaces and enums', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'Calculator.cs'),
      config,
    });

    expect(analysis.language).toBe('csharp');
    expect(analysis.exports.map((e) => e.name).sort()).toEqual(
      ['Calculator', 'Color', 'IShape'].sort()
    );

    const add = analysis.signatures.find((s) => s.name === 'Calculator.Add')!;
    expect(add.isExported).toBe(true);
    expect(add.params.map((p) => p.name)).toEqual(['a', 'b']);
    expect(add.returnType).toBe('int');

    const secret = analysis.signatures.find(
      (s) => s.name === 'Calculator.Secret'
    )!;
    expect(secret.isExported).toBe(false);

    const area = analysis.signatures.find((s) => s.name === 'IShape.Area')!;
    expect(area.isExported).toBe(true);

    const color = analysis.types.find((t) => t.name === 'Color')!;
    expect(color.kind).toBe('enum');
    expect(color.definition).toContain('Red');

    expect(analysis.imports.some((i) => i.source === 'System')).toBe(true);
  });

  it('detects *Tests.cs files as test type', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'CalculatorTests.cs'),
      config,
    });
    expect(analysis.type).toBe('test');
  });
});
