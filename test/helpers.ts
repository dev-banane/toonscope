import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type { ToonConfig } from '../src/types';

export function fixtureRoot(fixtureName: string): string {
  return path.join(process.cwd(), 'test', 'fixtures', fixtureName);
}

export function defaultTestConfig(projectRoot: string): ToonConfig {
  return {
    include: ['src'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/__pycache__/**',
      '**/.venv/**',
      '**/venv/**',
    ],
    output: fs.mkdtempSync(path.join(os.tmpdir(), 'toonscope-test-')),
    defaultDepth: 2,
    languages: ['typescript', 'javascript', 'python', 'go'],
    splitThreshold: 15,
  };
}
