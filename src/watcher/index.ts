import path from 'node:path';
import chokidar from 'chokidar';
import type { ToonConfig } from '../types';
import { applyIncrementalUpdate } from './incremental';
import { generateContext } from '../compiler/index';

export async function startWatcher(
  projectRoot: string,
  config: ToonConfig
): Promise<void> {
  await generateContext(projectRoot, config);
  const patterns = config.include.map((inc) => path.join(projectRoot, inc));
  const watcher = chokidar.watch(patterns, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });

  watcher.on('change', async (changedPath) => {
    try {
      await applyIncrementalUpdate({
        projectRoot,
        config,
        changedAbsPath: changedPath,
      });
    } catch {
      await generateContext(projectRoot, config);
    }
  });

  watcher.on('add', async () => {
    await generateContext(projectRoot, config);
  });
  watcher.on('unlink', async () => {
    await generateContext(projectRoot, config);
  });
}
