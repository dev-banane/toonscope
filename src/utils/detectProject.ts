import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import type { Language } from '../types';
import { DEFAULT_JUNK_EXCLUDES } from './files';

const CANDIDATE_INCLUDE_DIRS = [
  'src',
  'app',
  'apps',
  'server',
  'packages',
  'lib',
  'shared',
];

export function detectIncludeDirs(projectRoot: string): string[] {
  const found = CANDIDATE_INCLUDE_DIRS.filter((d) => {
    try {
      const p = path.join(projectRoot, d);
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
  return found.length ? found : ['src'];
}

const EXT_LANGUAGE: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.cs': 'csharp',
  '.java': 'java',
};

export async function detectLanguages(
  projectRoot: string,
  includeDirs: string[]
): Promise<Language[]> {
  const patterns = includeDirs.map((d) =>
    path.posix.join(d.replace(/\\/g, '/'), '**/*')
  );
  let matches: string[] = [];
  try {
    matches = await fg(patterns, {
      cwd: projectRoot,
      ignore: DEFAULT_JUNK_EXCLUDES,
      onlyFiles: true,
      dot: false,
    });
  } catch {
    matches = [];
  }

  const langs = new Set<Language>();
  for (const m of matches) {
    const lang = EXT_LANGUAGE[path.extname(m).toLowerCase()];
    if (lang) langs.add(lang);
  }
  return langs.size ? [...langs] : ['typescript', 'javascript', 'python'];
}
