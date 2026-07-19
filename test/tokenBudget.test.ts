import path from 'node:path';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateContext } from '../src/compiler/index';
import { fixtureRoot, defaultTestConfig } from './helpers';

function totalBytes(dir: string, onlyYaml: boolean): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (!onlyYaml || full.endsWith('.yaml')) total += fs.statSync(full).size;
    }
  }
  return total;
}

describe('token-budget regression (small-file bloat guard)', () => {
  it('keeps per-file yaml under the source it describes for simple-react', async () => {
    const projectRoot = fixtureRoot('simple-react');
    const config = defaultTestConfig(projectRoot);
    await generateContext(projectRoot, config);

    const rawBytes = totalBytes(path.join(projectRoot, 'src'), false);
    const outputDir = path.join(projectRoot, config.output);

    const filesOnlyBytes = totalBytes(path.join(outputDir, 'files'), true);
    expect(filesOnlyBytes).toBeLessThan(rawBytes * 1.5);

    const totalOutputBytes = totalBytes(outputDir, true);
    expect(totalOutputBytes).toBeLessThan(rawBytes * 2.2);
  });
});
