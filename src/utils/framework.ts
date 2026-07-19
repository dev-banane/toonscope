import fs from 'node:fs';
import path from 'node:path';

export function detectFramework(projectRoot: string): string | undefined {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return undefined;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as any;
    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    } as Record<string, string>;

    if (deps.next) return 'next.js';
    if (deps.react) return 'react';
    if (deps.express) return 'express';
    if (deps.svelte) return 'svelte';

    const hasPagesDir = fs.existsSync(path.join(projectRoot, 'pages'));
    const hasAppDir = fs.existsSync(path.join(projectRoot, 'app'));
    if (hasPagesDir || hasAppDir) return 'next.js';
  } catch {}

  return undefined;
}
