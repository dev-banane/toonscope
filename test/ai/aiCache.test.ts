import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import yaml from 'yaml';
import { generateContext } from '../../src/compiler/index';
import { fixtureRoot, defaultTestConfig } from '../helpers';
import { mockOkResponse } from './helpers';

function withGeminiResponse(fetchMock: ReturnType<typeof vi.fn>) {
  fetchMock.mockImplementation(async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    const promptText: string = body.contents[0].parts[0].text;
    const pathMatch = /Path: (.+)/.exec(promptText);
    const filePath = pathMatch?.[1] ?? 'unknown';
    return mockOkResponse({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  summary: `AI summary for ${filePath}.`,
                  functions: { formatDate: 'Formats a date string for display.' },
                }),
              },
            ],
          },
        },
      ],
    });
  });
}

function copyFixtureToTmp(name: string): string {
  const src = fixtureRoot(name);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `toonscope-${name}-`));
  fs.cpSync(src, tmp, { recursive: true });
  fs.rmSync(path.join(tmp, '.toon'), { recursive: true, force: true });
  return tmp;
}

describe('AI summary cache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('performs zero fetch calls on a second run with unchanged files, and re-summarizes only a changed file', async () => {
    const projectRoot = copyFixtureToTmp('simple-react');
    const config = defaultTestConfig(projectRoot);
    config.ai = { provider: 'google', apiKey: 'test-key', model: 'gemini-2.5-flash' };

    const fetchMock = vi.fn();
    withGeminiResponse(fetchMock);
    vi.stubGlobal('fetch', fetchMock);

    await generateContext(projectRoot, config, { summarize: true });
    const firstCallCount = fetchMock.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    fetchMock.mockClear();
    await generateContext(projectRoot, config, { summarize: true });
    expect(fetchMock).not.toHaveBeenCalled();

    const changedAbs = path.join(projectRoot, 'src/utils/format.ts');
    const original = fs.readFileSync(changedAbs, 'utf8');
    fs.writeFileSync(changedAbs, `${original}\nexport const EXTRA = 1;\n`, 'utf8');

    fetchMock.mockClear();
    await generateContext(projectRoot, config, { summarize: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, changedInit] = fetchMock.mock.calls[0];
    const changedBody = JSON.parse(changedInit.body);
    expect(changedBody.contents[0].parts[0].text).toContain('src/utils/format.ts');

    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('fills in per-function AI docs for undocumented functions and renders them in the per-file yaml, without overwriting existing docs', async () => {
    const projectRoot = copyFixtureToTmp('simple-react');
    const config = defaultTestConfig(projectRoot);
    config.ai = { provider: 'google', apiKey: 'test-key' };

    const fetchMock = vi.fn();
    withGeminiResponse(fetchMock);
    vi.stubGlobal('fetch', fetchMock);

    await generateContext(projectRoot, config, { summarize: true });

    const filePath = path.join(
      config.output,
      'files',
      'src/utils/format.ts.yaml'
    );
    const parsed = yaml.parse(fs.readFileSync(filePath, 'utf8')) as any;

    expect(parsed.summary).toContain('AI summary for src/utils/format.ts');
    const fnEntry = parsed.functions?.formatDate;
    expect(fnEntry).toBeTruthy();
    expect(typeof fnEntry === 'object' ? fnEntry.doc : fnEntry).toBe(
      'Formats a date string for display.'
    );

    fs.rmSync(projectRoot, { recursive: true, force: true });
  });
});
