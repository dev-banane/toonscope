import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeFile } from '../src/analyzer/index';
import { fixtureRoot, defaultTestConfig } from './helpers';

describe('C analyzer', () => {
  const projectRoot = fixtureRoot('c-pkg');
  const config = defaultTestConfig(projectRoot);

  it('extracts functions, structs, enums, and resolves local includes', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'point.c'),
      config,
    });

    expect(analysis.language).toBe('c');
    expect(analysis.exports.map((e) => e.name).sort()).toEqual(
      ['Color', 'add_points'].sort()
    );

    const addPoints = analysis.signatures.find(
      (s) => s.name === 'add_points'
    )!;
    expect(addPoints.doc).toBe('add_points sums two points.');
    expect(addPoints.params.map((p) => p.name)).toEqual(['a', 'b']);
    expect(addPoints.returnType).toBe('struct Point');

    const helper = analysis.signatures.find(
      (s) => s.name === 'private_helper'
    )!;
    expect(helper.isExported).toBe(false);

    const color = analysis.types.find((t) => t.name === 'Color')!;
    expect(color.kind).toBe('enum');
    expect(color.definition).toContain('RED');

    const localInclude = analysis.imports.find((i) => i.source === 'point.h')!;
    expect(localInclude.resolvedPath).toBe('point.h');

    const sysInclude = analysis.imports.find((i) => i.source === 'stdio.h')!;
    expect(sysInclude.resolvedPath).toBeNull();
  });

  it('extracts struct fields from the header', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'point.h'),
      config,
    });
    const point = analysis.types.find((t) => t.name === 'Point')!;
    expect(point.kind).toBe('class');
    expect(point.definition).toContain('x: int');
  });

  it('detects test_*.c as a test file', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'test_point.c'),
      config,
    });
    expect(analysis.type).toBe('test');
  });
});
