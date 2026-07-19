import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyIntegrationFiles,
  detectTools,
  removeIntegrationBlocks,
} from '../src/integrations/index';
import { DEFAULT_CONFIG } from '../src/config';

describe('integration file management', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toonscope-integ-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('detectTools never throws, even against a nonexistent project root', () => {
    expect(() => detectTools(path.join(dir, 'does-not-exist'))).not.toThrow();
  });

  it('generates a windsurf rule file when integrations.windsurf is enabled', () => {
    const results = applyIntegrationFiles({
      projectRoot: dir,
      config: {
        ...DEFAULT_CONFIG,
        integrations: { ...DEFAULT_CONFIG.integrations, windsurf: true, agents: false },
      },
      stats: { fileCount: 0, reductionPct: 0 },
    });

    const windsurfPath = path.join(dir, '.windsurf', 'rules', 'toonscope.md');
    expect(fs.existsSync(windsurfPath)).toBe(true);
    const content = fs.readFileSync(windsurfPath, 'utf8');
    expect(content).toContain('trigger: always_on');
    expect(content).toContain('.toon/index.yaml');
    expect(results.some((r) => r.path === windsurfPath)).toBe(true);
  });

  it('mentions the current .toon/ output shape in the AGENTS.md managed block', () => {
    applyIntegrationFiles({
      projectRoot: dir,
      config: DEFAULT_CONFIG,
      stats: { fileCount: 10, reductionPct: 85.2 },
    });
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(content).toContain('.toon/index.yaml');
    expect(content).toContain('.toon/graph.yaml');
    expect(content).toContain('.toon/types.yaml');
    expect(content).toContain('.toon/files/<path>.yaml');
    expect(content).toContain('toonscope scope <file> --depth 2');
    expect(content).toContain('85%');
  });

  it('removeIntegrationBlocks strips the managed block and deletes rule-only files', () => {
    applyIntegrationFiles({
      projectRoot: dir,
      config: {
        ...DEFAULT_CONFIG,
        integrations: {
          ...DEFAULT_CONFIG.integrations,
          cursor: true,
          windsurf: true,
        },
      },
      stats: { fileCount: 0, reductionPct: 0 },
    });

    // Simulate a user having their own content around the managed block.
    const agentsPath = path.join(dir, 'AGENTS.md');
    const existing = fs.readFileSync(agentsPath, 'utf8');
    fs.writeFileSync(agentsPath, `# My Project\n\nSome notes.\n\n${existing}`);

    const results = removeIntegrationBlocks(dir);

    expect(fs.existsSync(path.join(dir, '.cursor', 'rules', 'toonscope.mdc'))).toBe(
      false
    );
    expect(
      fs.existsSync(path.join(dir, '.windsurf', 'rules', 'toonscope.md'))
    ).toBe(false);

    const agentsAfter = fs.readFileSync(agentsPath, 'utf8');
    expect(agentsAfter).toContain('# My Project');
    expect(agentsAfter).not.toContain('toonscope:start');
    expect(agentsAfter).not.toContain('.toon/index.yaml');

    expect(results.some((r) => r.path.endsWith('toonscope.mdc'))).toBe(true);
  });

  it('is idempotent when there is nothing to remove', () => {
    const results = removeIntegrationBlocks(dir);
    expect(results).toEqual([]);
  });
});
