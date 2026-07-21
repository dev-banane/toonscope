import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeFile } from '../src/analyzer/index';
import { fixtureRoot, defaultTestConfig } from './helpers';

describe('PHP analyzer', () => {
  const projectRoot = fixtureRoot('php-pkg');
  const config = defaultTestConfig(projectRoot);

  it('extracts functions, classes, interfaces, and use imports', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'Point.php'),
      config,
    });

    expect(analysis.language).toBe('php');
    expect(analysis.exports.map((e) => e.name).sort()).toEqual(
      ['Point', 'Shape', 'add'].sort()
    );

    const add = analysis.signatures.find((s) => s.name === 'add')!;
    expect(add.doc).toBe('Adds two ints.');
    expect(add.params.map((p) => p.name)).toEqual(['a', 'b']);

    const ctor = analysis.signatures.find(
      (s) => s.name === 'Point.__construct'
    )!;
    expect(ctor.kind).toBe('constructor');

    const sum = analysis.signatures.find((s) => s.name === 'Point.sum')!;
    expect(sum.isExported).toBe(true);

    const hidden = analysis.signatures.find((s) => s.name === 'Point.hidden')!;
    expect(hidden.isExported).toBe(false);

    const shape = analysis.types.find((t) => t.name === 'Shape')!;
    expect(shape.kind).toBe('interface');

    const helperImport = analysis.imports.find(
      (i) => i.source === 'MyApp\\Helper'
    )!;
    expect(helperImport.names).toEqual(['Helper']);

    const aliasedImport = analysis.imports.find((i) =>
      i.source.includes('Other')
    )!;
    expect(aliasedImport.names).toEqual(['OtherThing']);
  });

  it('detects *Test.php files as test type', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'PointTest.php'),
      config,
    });
    expect(analysis.type).toBe('test');
  });
});
