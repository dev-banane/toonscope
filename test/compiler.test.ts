import path from 'node:path';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { generateContext } from '../src/compiler/index';
import { fixtureRoot, defaultTestConfig } from './helpers';
import { listSourceFiles, readTextFile } from '../src/utils/files';
import { countTokens } from '../src/utils/tokens';

describe('yaml compiler', () => {
  it('supports a host-provided AI summarizer without package-level credentials', async () => {
    const projectRoot = fixtureRoot('simple-react');
    const config = defaultTestConfig(projectRoot);
    const cachePath = path.join(projectRoot, '.toon', 'cache.json');
    fs.rmSync(cachePath, { force: true });
    let calls = 0;

    const ctx = await generateContext(projectRoot, config, {
      summarize: true,
      provider: {
        async summarizeFile({ path: filePath }) {
          calls += 1;
          return { summary: `Host summary for ${filePath}` };
        },
      },
    });

    expect(calls).toBeGreaterThan(0);
    expect(ctx.graph['src/components/UserCard.tsx']?.summary).toBe(
      'Host summary for src/components/UserCard.tsx'
    );
  });

  it('generates split yaml files with index, graph, types, and per-file entries', async () => {
    const projectRoot = fixtureRoot('simple-react');
    const config = defaultTestConfig(projectRoot);

    const ctx = await generateContext(projectRoot, config);

    expect(ctx.meta.project).toBe(path.basename(projectRoot));
    expect(ctx.meta.files).toBeGreaterThan(0);
    expect(ctx.graph).toBeTruthy();
    expect(ctx.types).toBeTruthy();

    const indexPath = path.join(projectRoot, config.output, 'index.yaml');
    const graphPath = path.join(projectRoot, config.output, 'graph.yaml');
    const typesPath = path.join(projectRoot, config.output, 'types.yaml');
    const filePath = path.join(
      projectRoot,
      config.output,
      'files',
      'src/components/UserCard.tsx.yaml'
    );
    const rawIndex = await import('node:fs').then((fs) =>
      fs.readFileSync(indexPath, 'utf8')
    );
    const rawGraph = await import('node:fs').then((fs) =>
      fs.readFileSync(graphPath, 'utf8')
    );
    const rawTypes = await import('node:fs').then((fs) =>
      fs.readFileSync(typesPath, 'utf8')
    );
    const rawFile = await import('node:fs').then((fs) =>
      fs.readFileSync(filePath, 'utf8')
    );
    const parsedIndex = yaml.parse(rawIndex) as any;
    const parsedGraph = yaml.parse(rawGraph) as any;
    const parsedTypes = yaml.parse(rawTypes) as any;
    const parsedFile = yaml.parse(rawFile) as any;

    expect(parsedIndex.project).toBe(path.basename(projectRoot));
    expect(parsedGraph.edges['src/components/UserCard.tsx']).toBeTruthy();
    expect(parsedTypes['User']).toBeTruthy();
    expect(parsedFile.path).toBe('src/components/UserCard.tsx');
  });

  it('prints token counts for test runs', async () => {
    const projectRoot = fixtureRoot('simple-react');
    const config = defaultTestConfig(projectRoot);
    const ctx = await generateContext(projectRoot, config);

    const sourceFiles = await listSourceFiles(
      projectRoot,
      config.include,
      config.exclude,
      config.languages
    );
    let rawTokens = 0;
    for (const relPath of sourceFiles) {
      rawTokens += countTokens(readTextFile(path.join(projectRoot, relPath)));
    }

    const toonDir = path.join(projectRoot, config.output);
    const toonYamlFiles = collectYamlFiles(toonDir);
    const toonTokens = toonYamlFiles.reduce(
      (sum, p) => sum + countTokens(fs.readFileSync(p, 'utf8')),
      0
    );
    const reduction =
      rawTokens > 0 ? ((rawTokens - toonTokens) / rawTokens) * 100 : 0;

    console.info(
      `[token-counts] fixture=simple-react raw=${rawTokens} toon=${toonTokens} reduction=${reduction.toFixed(1)}% files=${sourceFiles.length}`
    );

    expect(ctx.meta.totalTokens).toBeGreaterThan(0);
    expect(rawTokens).toBeGreaterThan(0);
    expect(toonTokens).toBeGreaterThan(0);
  });
});

function collectYamlFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const out: string[] = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && full.endsWith('.yaml')) out.push(full);
    }
  }
  return out;
}
