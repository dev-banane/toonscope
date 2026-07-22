import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DebugSystemInfo } from '../cli/renderer';

function detectCaseSensitiveFs(): boolean | 'unknown' {
  const dir = os.tmpdir();
  const marker = `toonscope-case-probe-${process.pid}-${Date.now()}`;
  const lower = path.join(dir, `${marker}.tmp`);
  const upper = path.join(dir, `${marker.toUpperCase()}.TMP`);
  try {
    fs.writeFileSync(lower, '');
    const sensitive = !fs.existsSync(upper);
    fs.rmSync(lower, { force: true });
    return sensitive;
  } catch {
    return 'unknown';
  }
}

export function gatherDebugSystemInfo(params: {
  toonscopeVersion: string;
  projectRoot: string;
  configPath: string;
  configSource: 'file' | 'default';
  include: string[];
  exclude: string[];
  languages: string[];
  output: string;
}): DebugSystemInfo {
  const cpus = os.cpus();
  return {
    toonscopeVersion: params.toonscopeVersion,
    nodeVersion: process.version,
    platform: `${os.platform()} (${os.type()})`,
    osRelease: os.release(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model?.trim() ?? 'unknown',
    cpuCount: cpus.length,
    totalMemGB: (os.totalmem() / 1024 ** 3).toFixed(1),
    freeMemGB: (os.freemem() / 1024 ** 3).toFixed(1),
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    caseSensitiveFs: detectCaseSensitiveFs(),
    cwd: process.cwd(),
    projectRoot: params.projectRoot,
    configPath: params.configPath,
    configSource: params.configSource,
    include: params.include,
    exclude: params.exclude,
    languages: params.languages,
    output: params.output,
  };
}
