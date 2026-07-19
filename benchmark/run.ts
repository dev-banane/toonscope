import path from 'node:path';
import fs from 'node:fs';
import Table from 'cli-table3';
import { loadConfig } from '../src/config';
import { listSourceFiles, readTextFile } from '../src/utils/files';
import { countTokens } from '../src/utils/tokens';
import { generateContext } from '../src/compiler/index';
import { buildProjectGraph } from '../src/compiler/buildGraph';
import { scopeContext } from '../src/graph/scope';
import { assembleScopeYaml } from '../src/compiler/assembler';
import { formatInt, formatPercent } from './report';

async function main() {
  const projectDir = process.argv[2];
  if (!projectDir) {
    console.error('Usage: tsx benchmark/run.ts <projectDir>');
    process.exit(1);
  }

  const absProjectDir = path.resolve(projectDir);
  const projectName = path.basename(absProjectDir);

  const config = loadConfig(absProjectDir);
  const absFiles = await listSourceFiles(
    absProjectDir,
    config.include,
    config.exclude,
    config.languages
  );

  let rawTokens = 0;
  for (const relPath of absFiles) {
    const absPath = path.join(absProjectDir, relPath);
    rawTokens += countTokens(readTextFile(absPath));
  }

  const ctx = await generateContext(absProjectDir, config);
  const outputDir = path.isAbsolute(config.output)
    ? config.output
    : path.join(absProjectDir, config.output);
  const yamlFiles = listyamlFiles(outputDir).filter((p) => p.endsWith('.yaml'));
  const contextTokens = yamlFiles.reduce(
    (sum, p) => sum + countTokens(fs.readFileSync(p, 'utf8')),
    0
  );
  const alwaysReadTokens = ['index.yaml', 'graph.yaml', 'types.yaml']
    .map((name) => path.join(outputDir, name))
    .filter((p) => fs.existsSync(p))
    .reduce((sum, p) => sum + countTokens(fs.readFileSync(p, 'utf8')), 0);
  const perFileyamls = yamlFiles.filter((p) =>
    p.includes(`${path.sep}files${path.sep}`)
  );
  const avgFileyamlTokens = perFileyamls.length
    ? perFileyamls.reduce(
        (sum, p) => sum + countTokens(fs.readFileSync(p, 'utf8')),
        0
      ) / perFileyamls.length
    : 0;

  let scopedTokens = 0;
  if (absFiles.length > 0) {
    const graph = await buildProjectGraph({
      projectRoot: absProjectDir,
      config,
      useCache: true,
    });
    const target = absFiles[0];
    const scoped = scopeContext(graph, target, config.defaultDepth);
    const scopeOut = assembleScopeYaml({
      outputDir,
      targetFile: target,
      scopedAnalyses: scoped,
      graph,
      depth: config.defaultDepth,
    });
    scopedTokens = scopeOut.tokens;
  }

  const reduction =
    rawTokens > 0 ? ((rawTokens - contextTokens) / rawTokens) * 100 : 0;

  const table = new Table({
    chars: {
      top: '─',
      'top-mid': '┬',
      'top-left': '┌',
      'top-right': '┐',
      bottom: '─',
      'bottom-mid': '┴',
      'bottom-left': '└',
      'bottom-right': '┘',
      left: '│',
      'left-mid': '├',
      mid: '─',
      'mid-mid': '┼',
      right: '│',
      'right-mid': '┤',
      middle: '│',
    },
    style: { head: [], border: [] },
    colWidths: [36, 26],
  });
  table.push(
    ['ToonScope Benchmark Report', projectName],
    ['Files analyzed', formatInt(absFiles.length)],
    ['Raw source tokens', formatInt(rawTokens)],
    ['ToonScope context tokens', formatInt(contextTokens)],
    ['Token reduction', formatPercent(reduction)],
    ['Always-read tokens (index+graph+types)', formatInt(alwaysReadTokens)],
    ['Avg tokens per files/*.yaml', avgFileyamlTokens.toFixed(1)],
    ['Typical scope tokens', formatInt(scopedTokens)]
  );
  console.log(`\n${table.toString()}\n`);
}

function listyamlFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const d = stack.pop()!;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && p.endsWith('.yaml')) out.push(p);
    }
  }
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
