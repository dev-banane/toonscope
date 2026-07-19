import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeFile } from '../src/analyzer/index';
import { fixtureRoot, defaultTestConfig } from './helpers';

describe('Python analyzer', () => {
  const projectRoot = fixtureRoot('python-pkg');
  const config = defaultTestConfig(projectRoot);

  it('resolves package re-exports and respects __all__ in __init__.py', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'mypkg/__init__.py'),
      config,
    });

    expect(analysis.language).toBe('python');
    expect(analysis.exports.map((e) => e.name).sort()).toEqual(
      ['Greeter', 'User', 'greet'].sort()
    );
    expect(
      analysis.imports.find((i) => i.source === '.models')?.resolvedPath
    ).toBe('mypkg/models.py');
    expect(
      analysis.imports.find((i) => i.source === '.utils')?.resolvedPath
    ).toBe('mypkg/utils.py');
    expect(analysis.summary).toMatch(/ToonScope python fixture/);
  });

  it('extracts dataclass fields, typed params/defaults, kwargs, and docstrings from models.py', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'mypkg/models.py'),
      config,
    });

    const userType = analysis.types.find((t) => t.name === 'User')!;
    expect(userType.doc).toBe('A user record.');
    expect(userType.definition).toContain('id: int');
    expect(userType.definition).toContain('name: str');
    expect(userType.definition).toContain('email: Optional[str]');

    const ctor = analysis.signatures.find((s) => s.name === 'Greeter.__init__')!;
    expect(ctor.kind).toBe('constructor');
    expect(ctor.doc).toBe('Create a greeter with a custom greeting.');
    // `self` is dropped; a bare `*` marks the keyword-only boundary.
    expect(ctor.params.map((p) => p.name)).toEqual(['greeting', '*', 'loud']);
    const greeting = ctor.params.find((p) => p.name === 'greeting')!;
    expect(greeting.type).toBe('str');
    expect(greeting.default).toBe('"Hello"');
    const loud = ctor.params.find((p) => p.name === 'loud')!;
    expect(loud.type).toBe('bool');
    expect(loud.default).toBe('False');

    const greet = analysis.signatures.find((s) => s.name === 'Greeter.greet')!;
    expect(greet.params.map((p) => p.name)).toEqual(['user', '*names', '**opts']);
    expect(greet.returnType).toBe('str');
    expect(greet.doc).toBe('Return a greeting for the given user.');

    const getter = analysis.signatures.find((s) => s.kind === 'getter');
    expect(getter?.name).toBe('Greeter.shout');
    const setter = analysis.signatures.find((s) => s.kind === 'setter');
    expect(setter?.name).toBe('Greeter.shout');

    // Private (single-underscore, non-dunder) methods are skipped entirely.
    expect(
      analysis.signatures.some((s) => s.name === 'Greeter._internal')
    ).toBe(false);
  });

  it('marks non-underscore top-level functions exported and skips private ones from exports', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'mypkg/utils.py'),
      config,
    });

    expect(analysis.exports.map((e) => e.name)).toEqual(['greet']);
    const greetSig = analysis.signatures.find((s) => s.name === 'greet')!;
    expect(greetSig.isExported).toBe(true);
    expect(greetSig.params).toEqual([
      { name: 'user', type: 'User' },
      { name: 'times', type: 'int', optional: true, default: '1' },
    ]);

    const internalSig = analysis.signatures.find(
      (s) => s.name === '_internal_helper'
    )!;
    expect(internalSig.isExported).toBe(false);
  });

  it('resolves absolute intra-project imports and detects test files', async () => {
    const analysis = await analyzeFile({
      projectRoot,
      absPath: path.join(projectRoot, 'tests/test_models.py'),
      config,
    });

    expect(analysis.type).toBe('test');
    expect(
      analysis.imports.every((i) => i.resolvedPath === 'mypkg/models.py')
    ).toBe(true);
    expect(analysis.exports.map((e) => e.name).sort()).toEqual(
      ['test_greeter', 'test_user_creation'].sort()
    );
  });
});
