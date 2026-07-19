import { describe, expect, it } from 'vitest';
import { parseFile } from '../src/analyzer/parser';

describe('WASM tree-sitter parser', () => {
  it('parses a TypeScript snippet', async () => {
    const tree = await parseFile(
      'export interface Foo { bar: string; }\nexport function baz(x: number): number { return x + 1; }\n',
      '.ts'
    );
    try {
      expect(tree.rootNode.namedChildren.length).toBeGreaterThan(0);
    } finally {
      tree.delete();
    }
  });

  it('parses a TSX snippet', async () => {
    const tree = await parseFile(
      'export function Hello({ name }: { name: string }) { return <div>Hello {name}</div>; }\n',
      '.tsx'
    );
    try {
      expect(tree.rootNode.namedChildren.length).toBeGreaterThan(0);
    } finally {
      tree.delete();
    }
  });

  it('parses a JavaScript snippet', async () => {
    const tree = await parseFile(
      'function add(a, b) { return a + b; }\nmodule.exports = { add };\n',
      '.js'
    );
    try {
      expect(tree.rootNode.namedChildren.length).toBeGreaterThan(0);
    } finally {
      tree.delete();
    }
  });

  it('parses a Python snippet', async () => {
    const tree = await parseFile(
      'def add(a, b):\n    return a + b\n',
      '.py'
    );
    try {
      expect(tree.rootNode.namedChildren.length).toBeGreaterThan(0);
    } finally {
      tree.delete();
    }
  });
});
