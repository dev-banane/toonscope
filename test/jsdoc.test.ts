import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { parseFile } from '../src/analyzer/parser';
import {
  parseSignaturesFromSource,
  parseTypesFromSource,
} from '../src/analyzer/extractors';
import { analyzeFile } from '../src/analyzer/index';
import { writeFileyaml } from '../src/compiler/yaml-emitter';
import { defaultTestConfig } from './helpers';

async function parseTs(source: string) {
  const tree = await parseFile(source, '.ts');
  try {
    return {
      signatures: parseSignaturesFromSource(tree.rootNode),
      types: parseTypesFromSource(tree.rootNode),
    };
  } finally {
    tree.delete();
  }
}

describe('TS/JS JSDoc extraction', () => {
  it('captures JSDoc first line on an exported function', async () => {
    const { signatures } = await parseTs(
      `/** Fetch a user by id. */\nexport async function getUser(id: number): Promise<string> { return "x"; }`
    );
    const sig = signatures.find((s) => s.name === 'getUser')!;
    expect(sig.doc).toBe('Fetch a user by id.');
  });

  it('captures JSDoc on an internal (non-exported) function', async () => {
    const { signatures } = await parseTs(
      `/** Internal helper. */\nfunction helper(a: string): void {}`
    );
    const sig = signatures.find((s) => s.name === 'helper')!;
    expect(sig.isExported).toBe(false);
    expect(sig.doc).toBe('Internal helper.');
  });

  it('captures JSDoc on an exported const arrow function', async () => {
    const { signatures } = await parseTs(
      `/** Formats a date string. */\nexport const formatDate = (d: string): string => d;`
    );
    const sig = signatures.find((s) => s.name === 'formatDate')!;
    expect(sig.kind).toBe('arrow');
    expect(sig.doc).toBe('Formats a date string.');
  });

  it('captures JSDoc on a class method', async () => {
    const { signatures } = await parseTs(`
      export class Repo {
        /** Save the entity and return its id. */
        save(entity: object): number { return 1; }
      }
    `);
    const sig = signatures.find((s) => s.name === 'Repo.save')!;
    expect(sig.doc).toBe('Save the entity and return its id.');
  });

  it('captures JSDoc on an exported interface (TypeInfo.doc)', async () => {
    const { types } = await parseTs(
      `/** A user of the system. */\nexport interface User { id: string }`
    );
    const t = types.find((x) => x.name === 'User')!;
    expect(t.doc).toBe('A user of the system.');
  });

  it('uses only the first line of a multi-line JSDoc and skips non-JSDoc comments', async () => {
    const { signatures } = await parseTs(
      [
        '/**',
        ' * Computes the total.',
        ' *',
        ' * Longer explanation that should not appear.',
        ' */',
        '// eslint-disable-next-line some-rule',
        'export function total(xs: number[]): number { return 0; }',
        '',
        '// just a line comment, not JSDoc',
        'export function untouched(): void {}',
      ].join('\n')
    );
    expect(signatures.find((s) => s.name === 'total')!.doc).toBe(
      'Computes the total.'
    );
    expect(signatures.find((s) => s.name === 'untouched')!.doc).toBeUndefined();
  });

  describe('per-file YAML emission', () => {
    const tmpProject = fs.mkdtempSync(
      path.join(os.tmpdir(), 'toonscope-jsdoc-')
    );

    afterAll(() => {
      fs.rmSync(tmpProject, { recursive: true, force: true });
    });

    it('renders the {sig, doc} object form for documented TS functions, like Python', async () => {
      const srcDir = path.join(tmpProject, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      const filePath = path.join(srcDir, 'users.ts');
      fs.writeFileSync(
        filePath,
        `/** Fetch a user by id. */\nexport async function getUser(id: number): Promise<string> { return "x"; }\n\nexport function plain(): void {}\n`,
        'utf8'
      );

      const analysis = await analyzeFile({
        projectRoot: tmpProject,
        absPath: filePath,
        config: defaultTestConfig(tmpProject),
      });
      const outDir = path.join(tmpProject, '.toon');
      const emitted = writeFileyaml(outDir, analysis);
      const parsed = yaml.parse(fs.readFileSync(emitted, 'utf8'));

      expect(parsed.functions.getUser).toEqual({
        sig: 'async getUser(id: number) => Promise<string>',
        doc: 'Fetch a user by id.',
      });
      expect(typeof parsed.functions.plain).toBe('string');
    });
  });
});
