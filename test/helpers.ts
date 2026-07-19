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
    output: '.toon',
    defaultDepth: 2,
    languages: ['typescript', 'javascript', 'python'],
    splitThreshold: 15,
  };
}
