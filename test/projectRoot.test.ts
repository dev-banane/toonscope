import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveProjectRoot, configFileExists } from '../src/config';

describe('resolveProjectRoot marker priority and home guard', () => {
  let base: string; // fake home directory
  const mk = (...segs: string[]) => {
    const p = path.join(base, ...segs);
    fs.mkdirSync(p, { recursive: true });
    return p;
  };
  const touch = (...segs: string[]) =>
    fs.writeFileSync(path.join(base, ...segs), '');

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'toonscope-root-'));
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('falls back to cwd itself when no marker exists anywhere below home', () => {
    const cwd = mk('some', 'fresh', 'dir');
    expect(resolveProjectRoot(cwd, { homeDir: base })).toBe(cwd);
  });

  it('nearest .git beats a farther AND a nearer-tier-crossing package.json', () => {
    mk('outer');
    touch('outer', 'package.json');
    mk('outer', 'inner', '.git');
    const cwd = mk('outer', 'inner', 'sub');
    expect(resolveProjectRoot(cwd, { homeDir: base })).toBe(
      path.join(base, 'outer', 'inner')
    );
  });

  it('.toonscope.yaml beats .git, even when the .git is nearer', () => {
    mk('repo', '.git');
    touch('repo', '.toonscope.yaml');
    mk('repo', 'pkg', '.git'); // nested repo, nearer to cwd
    const cwd = mk('repo', 'pkg', 'src');
    expect(resolveProjectRoot(cwd, { homeDir: base })).toBe(
      path.join(base, 'repo')
    );
  });

  it('never implicitly resolves to the home directory (stray package.json in $HOME)', () => {
    touch('package.json'); // the exact real-world trigger
    const cwd = mk('projects', 'fresh-dir');
    expect(resolveProjectRoot(cwd, { homeDir: base })).toBe(cwd);
  });

  it('never resolves above home when starting inside it', () => {
    const parent = path.dirname(base);
    mk('.git');
    const cwd = mk('deep', 'dir');
    const resolved = resolveProjectRoot(cwd, { homeDir: base });
    expect(resolved).toBe(cwd);
    expect(resolved.startsWith(parent + path.sep)).toBe(true);
  });

  it('still resolves to home when the user explicitly runs there', () => {
    touch('package.json');
    expect(resolveProjectRoot(base, { homeDir: base })).toBe(base);
  });

  it('a package.json between cwd and home is still found (guard only blocks home itself)', () => {
    mk('work', 'proj');
    touch('work', 'proj', 'package.json');
    const cwd = mk('work', 'proj', 'src', 'deep');
    expect(resolveProjectRoot(cwd, { homeDir: base })).toBe(
      path.join(base, 'work', 'proj')
    );
  });

  it('configFileExists reflects .toonscope.yaml presence at the root', () => {
    const root = mk('cfgproj');
    expect(configFileExists(root)).toBe(false);
    touch('cfgproj', '.toonscope.yaml');
    expect(configFileExists(root)).toBe(true);
  });
});

describe('generate without .toonscope.yaml (config-gated integrations)', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toonscope-nocfg-'));
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: 'nocfg-project', version: '1.0.0' })
    );
    fs.mkdirSync(path.join(projectDir, 'src'));
    fs.writeFileSync(
      path.join(projectDir, 'src', 'index.ts'),
      'export function hello(): string {\n  return "hi";\n}\n'
    );
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('writes .toon/ but does NOT create AGENTS.md or other integration files', () => {
    const tsxCli = path.join(
      process.cwd(),
      'node_modules',
      'tsx',
      'dist',
      'cli.mjs'
    );
    const cliTs = path.join(process.cwd(), 'src', 'cli.ts');
    const res = spawnSync(
      process.execPath,
      [tsxCli, cliTs, 'generate', '--quiet'],
      { cwd: projectDir, encoding: 'utf8', timeout: 120_000 }
    );

    expect(res.status).toBe(0);
    expect(fs.existsSync(path.join(projectDir, '.toon', 'index.yaml'))).toBe(
      true
    );
    expect(fs.existsSync(path.join(projectDir, 'AGENTS.md'))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, 'CLAUDE.md'))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, '.cursor'))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, '.gitignore'))).toBe(false);
  }, 150_000);
});
