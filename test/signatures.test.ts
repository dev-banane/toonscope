import { describe, expect, it } from 'vitest';
import { parseFile } from '../src/analyzer/parser';
import {
  parseExportsFromSource,
  parseSignaturesFromSource,
} from '../src/analyzer/extractors';

async function parseTs(source: string) {
  const tree = await parseFile(source, '.ts');
  try {
    return {
      exports: parseExportsFromSource(tree.rootNode),
      signatures: parseSignaturesFromSource(tree.rootNode),
    };
  } finally {
    tree.delete();
  }
}

describe('TS/JS signature extraction edge cases', () => {
  it('captures optional params, defaults, and rest params', async () => {
    const { signatures } = await parseTs(
      `export function withParams(a: string, b?: number, c: string = 'x', ...rest: string[]): void {}`
    );
    const sig = signatures.find((s) => s.name === 'withParams')!;
    expect(sig).toBeTruthy();
    expect(sig.params).toEqual([
      { name: 'a', type: 'string' },
      { name: 'b', type: 'number', optional: true },
      { name: 'c', type: 'string', optional: true, default: "'x'" },
      { name: 'rest', type: 'string[]', rest: true },
    ]);
    expect(sig.returnType).toBe('void');
  });

  it('captures destructured params as a rendered pattern name', async () => {
    const { signatures } = await parseTs(
      `export function withDestructure({ a, b }: { a: number; b: string }, [x, y]: number[]): void {}`
    );
    const sig = signatures.find((s) => s.name === 'withDestructure')!;
    expect(sig.params[0].name).toBe('{ a, b }');
    expect(sig.params[1].name).toBe('[x, y]');
  });

  it('preserves generic type parameters in param/return types', async () => {
    const { signatures } = await parseTs(
      `export function generic<T extends object>(items: T[]): T[] { return items; }`
    );
    const sig = signatures.find((s) => s.name === 'generic')!;
    expect(sig.params[0]).toEqual({ name: 'items', type: 'T[]' });
    expect(sig.returnType).toBe('T[]');
  });

  it('detects async generators', async () => {
    const { signatures } = await parseTs(
      `export async function* asyncGen(): AsyncGenerator<number> { yield 1; }`
    );
    const sig = signatures.find((s) => s.name === 'asyncGen')!;
    expect(sig.isAsync).toBe(true);
    expect(sig.isGenerator).toBe(true);
    expect(sig.returnType).toBe('AsyncGenerator<number>');
  });

  it('captures class constructor, getters, and setters', async () => {
    const { signatures } = await parseTs(`
      export class Box<T> {
        private secret: number = 0;
        constructor(public value: T, label: string = 'box') {}
        get label(): string { return 'box'; }
        set label(v: string) {}
        compute(x: number): number { return x; }
      }
    `);
    const ctor = signatures.find((s) => s.name === 'Box.constructor')!;
    expect(ctor.kind).toBe('constructor');
    expect(ctor.params.map((p) => p.name)).toEqual(['value', 'label']);

    const getter = signatures.find((s) => s.kind === 'getter');
    expect(getter?.name).toBe('Box.label');
    const setter = signatures.find((s) => s.kind === 'setter');
    expect(setter?.name).toBe('Box.label');

    const method = signatures.find((s) => s.name === 'Box.compute')!;
    expect(method.kind).toBe('method');
    expect(method.className).toBe('Box');
  });

  it('gives an anonymous default export function the name "default"', async () => {
    const { exports, signatures } = await parseTs(
      `export default function() { return 42; }`
    );
    expect(exports.some((e) => e.name === 'default' && e.isDefault)).toBe(true);
    expect(signatures.some((s) => s.name === 'default' && s.isExported)).toBe(
      true
    );
  });

  it('gives an anonymous default export arrow function the name "default"', async () => {
    const { exports, signatures } = await parseTs(
      `export default () => 42;`
    );
    expect(exports.some((e) => e.name === 'default' && e.isDefault)).toBe(true);
    expect(signatures.some((s) => s.name === 'default' && s.kind === 'arrow')).toBe(
      true
    );
  });

  it('records `export { x } from "./y"` as a re-export, not a default', async () => {
    const { exports } = await parseTs(`export { helper } from './utils';`);
    const entry = exports.find((e) => e.name === 'helper')!;
    expect(entry.kind).toBe('reexport');
    expect(entry.isDefault).toBe(false);
    expect(entry.reexport).toEqual({ from: './utils' });
  });

  it('records `export * from "./y"` as a star re-export', async () => {
    const { exports } = await parseTs(`export * from './utils';`);
    const entry = exports.find((e) => e.kind === 'reexport')!;
    expect(entry.reexport?.from).toBe('./utils');
    expect(entry.reexport?.star).toBe(true);
  });

  it('records `export * as ns from "./y"` with the namespace alias', async () => {
    const { exports } = await parseTs(`export * as utils from './utils';`);
    const entry = exports.find((e) => e.kind === 'reexport')!;
    expect(entry.name).toBe('utils');
    expect(entry.reexport?.from).toBe('./utils');
  });

  it('keeps non-exported top-level functions as internal signatures', async () => {
    const { signatures } = await parseTs(`
      function helper(x: number): number { return x; }
      export function pub(): number { return helper(1); }
    `);
    const helper = signatures.find((s) => s.name === 'helper')!;
    expect(helper.isExported).toBe(false);
    const pub = signatures.find((s) => s.name === 'pub')!;
    expect(pub.isExported).toBe(true);
  });
});
