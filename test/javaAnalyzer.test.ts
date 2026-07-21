import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeFile } from '../src/analyzer/index';
import { fixtureRoot, defaultTestConfig } from './helpers';

describe('Java analyzer', () => {
  const projectRoot = fixtureRoot('java-pkg');
  const config = defaultTestConfig(projectRoot);

  it('extracts public classes, methods, interfaces, enums and resolves package imports', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'com/example/Calculator.java'),
      config,
    });

    expect(analysis.language).toBe('java');
    expect(analysis.exports.map((e) => e.name).sort()).toEqual(
      ['Calculator', 'Color', 'Shape'].sort()
    );

    const add = analysis.signatures.find((s) => s.name === 'Calculator.add')!;
    expect(add.isExported).toBe(true);
    expect(add.doc).toBeUndefined();
    expect(add.params.map((p) => p.name)).toEqual(['a', 'b']);
    expect(add.returnType).toBe('int');

    const secret = analysis.signatures.find(
      (s) => s.name === 'Calculator.secret'
    )!;
    expect(secret.isExported).toBe(false);

    const shape = analysis.types.find((t) => t.name === 'Shape')!;
    expect(shape.kind).toBe('interface');
    expect(shape.isExported).toBe(true);

    const color = analysis.types.find((t) => t.name === 'Color')!;
    expect(color.kind).toBe('enum');
    expect(color.definition).toContain('RED');

    const helperImport = analysis.imports.find(
      (i) => i.source === 'com.example.Helper'
    )!;
    expect(helperImport.resolvedPath).toBe('com/example/Helper.java');

    const utilImport = analysis.imports.find(
      (i) => i.source === 'java.util.List'
    )!;
    expect(utilImport.resolvedPath).toBeNull();
  });

  it('detects files under a test/ dir as test type', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'com/example/test/CalculatorTest.java'),
      config,
    });
    expect(analysis.type).toBe('test');
  });
});
