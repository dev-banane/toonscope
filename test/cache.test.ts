import path from 'node:path';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateContext } from '../src/compiler/index';
import { fixtureRoot, defaultTestConfig } from './helpers';

describe('Cache', () => {
  it('reuses cached analyses on subsequent generate runs', async () => {
    const projectRoot = fixtureRoot('simple-react');
    const config = defaultTestConfig(projectRoot);

    const cachePath = path.join(config.output, 'cache.json');

    await generateContext(projectRoot, config);
    const firstRaw = fs.readFileSync(cachePath, 'utf8');
    const first = JSON.parse(firstRaw) as any;

    await generateContext(projectRoot, config);
    const secondRaw = fs.readFileSync(cachePath, 'utf8');
    const second = JSON.parse(secondRaw) as any;

    const keys = Object.keys(first);
    expect(Object.keys(second).sort()).toEqual(keys.sort());

    for (const k of keys) {
      expect(second[k].contentHash).toBe(first[k].contentHash);
      expect(second[k].analysisHash).toBe(first[k].analysisHash);
      expect(second[k].summarySource).toBe(first[k].summarySource);
      expect(second[k].summary).toBe(first[k].summary);
      expect(second[k].analyzerVersion).toBe(first[k].analyzerVersion);
    }
  });

  it('`force` bypasses a warm cache and re-derives every entry', async () => {
    const projectRoot = fixtureRoot('simple-react');
    const config = defaultTestConfig(projectRoot);

    const cachePath = path.join(config.output, 'cache.json');

    await generateContext(projectRoot, config);
    const warm = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as any;
    const someKey = Object.keys(warm)[0];
    // Tamper with a cached summary — contentHash/analyzerVersion still
    // match, so a normal (non-forced) run would reuse it unchanged.
    warm[someKey].summary = 'STALE_SENTINEL_VALUE';
    warm[someKey].templateSummary = 'STALE_SENTINEL_VALUE';
    fs.writeFileSync(cachePath, JSON.stringify(warm, null, 2));

    await generateContext(projectRoot, config, { force: true });
    const rebuilt = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as any;
    expect(rebuilt[someKey].summary).not.toBe('STALE_SENTINEL_VALUE');
  });
});
