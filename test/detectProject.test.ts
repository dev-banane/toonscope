import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectIncludeDirs, detectLanguages } from '../src/utils/detectProject';

describe('project detection for `init`', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toonscope-detect-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to ["src"] when no recognizable source root exists', () => {
    expect(detectIncludeDirs(dir)).toEqual(['src']);
  });

  it('detects multiple workspace-style source roots (monorepo shape)', () => {
    fs.mkdirSync(path.join(dir, 'app'));
    fs.mkdirSync(path.join(dir, 'server'));
    fs.mkdirSync(path.join(dir, 'shared'));
    fs.mkdirSync(path.join(dir, 'not-a-candidate'));

    const dirs = detectIncludeDirs(dir);
    expect(dirs).toEqual(expect.arrayContaining(['app', 'server', 'shared']));
    expect(dirs).not.toContain('not-a-candidate');
  });

  it('detects only the languages actually present on disk', async () => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(dir, 'src', 'b.py'), 'a = 1\n');

    const langs = await detectLanguages(dir, ['src']);
    expect(langs.sort()).toEqual(['python', 'typescript']);
  });

  it('falls back to all three languages when nothing is found', async () => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const langs = await detectLanguages(dir, ['src']);
    expect(langs.sort()).toEqual(['javascript', 'python', 'typescript']);
  });
});
