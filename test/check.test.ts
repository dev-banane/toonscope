import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateContext } from '../src/compiler/index';
import { checkStaleness } from '../src/compiler/check';
import { fixtureRoot, defaultTestConfig } from './helpers';

describe('checkStaleness', () => {
  it('reports not generated when .toon/ has never been built', async () => {
    const projectRoot = fixtureRoot('simple-react');
    const config = defaultTestConfig(projectRoot);

    const result = await checkStaleness(projectRoot, config);
    expect(result.generated).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('reports ok immediately after a fresh generate', async () => {
    const projectRoot = fixtureRoot('simple-react');
    const config = defaultTestConfig(projectRoot);

    await generateContext(projectRoot, config);
    const result = await checkStaleness(projectRoot, config);

    expect(result.generated).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.stale).toEqual([]);
    expect(result.checkedFiles).toBeGreaterThan(0);
  });

  it('flags a file as changed after it is edited post-generate', async () => {
    const projectRoot = fixtureRoot('simple-react');
    const config = defaultTestConfig(projectRoot);

    await generateContext(projectRoot, config);

    const target = path.join(projectRoot, 'src', 'api', 'auth.ts');
    const original = fs.readFileSync(target, 'utf8');
    try {
      fs.writeFileSync(target, `${original}\n// mutated for staleness test\n`);

      const result = await checkStaleness(projectRoot, config);
      expect(result.ok).toBe(false);
      expect(
        result.stale.some(
          (f) => f.path === 'src/api/auth.ts' && f.reason === 'changed'
        )
      ).toBe(true);
    } finally {
      fs.writeFileSync(target, original);
    }
  });
});
