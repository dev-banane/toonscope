import fs from 'node:fs';
import path from 'node:path';

const HOOK_START = '# >>> toonscope hook >>>';
const HOOK_END = '# <<< toonscope hook <<<';

const HOOK_BODY = [
  '(',
  '  if command -v npx >/dev/null 2>&1; then',
  '    if ! npx --no-install toonscope check --quiet >/dev/null 2>&1; then',
  '      npx --no-install toonscope generate --quiet >/dev/null 2>&1',
  '      git add .toon >/dev/null 2>&1',
  '    fi',
  '  fi',
  ') || true',
].join('\n');

export interface HookResult {
  path: string;
  action: 'created' | 'updated' | 'unchanged' | 'skipped';
  note?: string;
}

function huskyDir(projectRoot: string): string | null {
  const dir = path.join(projectRoot, '.husky');
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? dir : null;
}

function gitHooksDir(projectRoot: string): string | null {
  const gitPath = path.join(projectRoot, '.git');
  if (!fs.existsSync(gitPath)) return null;
  const stat = fs.statSync(gitPath);
  if (stat.isDirectory()) return path.join(gitPath, 'hooks');
  try {
    const contents = fs.readFileSync(gitPath, 'utf8');
    const match = contents.match(/^gitdir:\s*(.+)$/m);
    if (match) {
      const resolved = path.resolve(projectRoot, match[1].trim());
      return path.join(resolved, 'hooks');
    }
  } catch {
    // ignore, fall through
  }
  return null;
}

function hookFilePath(projectRoot: string): {
  filePath: string | null;
  husky: boolean;
} {
  const husky = huskyDir(projectRoot);
  if (husky) return { filePath: path.join(husky, 'pre-commit'), husky: true };
  const hooksDir = gitHooksDir(projectRoot);
  return {
    filePath: hooksDir ? path.join(hooksDir, 'pre-commit') : null,
    husky: false,
  };
}

export function installPrecommitHook(projectRoot: string): HookResult {
  const { filePath } = hookFilePath(projectRoot);
  if (!filePath) {
    return { path: '', action: 'skipped', note: 'no .git directory found' };
  }

  const wrapped = `${HOOK_START}\n${HOOK_BODY}\n${HOOK_END}\n`;

  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `#!/bin/sh\n\n${wrapped}`, 'utf8');
    fs.chmodSync(filePath, 0o755);
    return { path: filePath, action: 'created' };
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const s = raw.indexOf(HOOK_START);
  const e = raw.indexOf(HOOK_END);
  let next: string;
  if (s !== -1 && e !== -1 && e > s) {
    const block = `${HOOK_START}\n${HOOK_BODY}\n${HOOK_END}`;
    if (raw.slice(s, e + HOOK_END.length) === block) {
      return { path: filePath, action: 'unchanged' };
    }
    const before = raw.slice(0, s).replace(/\s*$/, '\n');
    const after = raw.slice(e + HOOK_END.length).replace(/^\s*/, '\n');
    next = `${before}${wrapped}${after}`.replace(/\n{3,}/g, '\n\n');
  } else {
    const divider = raw.trimEnd().length ? '\n\n' : '';
    next = `${raw.trimEnd()}${divider}${wrapped}`;
  }

  if (next === raw) return { path: filePath, action: 'unchanged' };
  fs.writeFileSync(filePath, next, 'utf8');
  fs.chmodSync(filePath, 0o755);
  return { path: filePath, action: 'updated' };
}

export function removePrecommitHook(projectRoot: string): HookResult {
  const { filePath } = hookFilePath(projectRoot);
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      path: filePath ?? '',
      action: 'unchanged',
      note: 'no hook installed',
    };
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const s = raw.indexOf(HOOK_START);
  const e = raw.indexOf(HOOK_END);
  if (s === -1 || e === -1 || e <= s) {
    return {
      path: filePath,
      action: 'unchanged',
      note: 'no ToonScope block found',
    };
  }

  const before = raw.slice(0, s).trimEnd();
  const after = raw.slice(e + HOOK_END.length).trimStart();
  const remainder = [before, after].filter(Boolean).join('\n\n');
  const strippedOfShebang = remainder.replace(/^#!.*\n?/, '').trim();

  if (strippedOfShebang.length === 0) {
    fs.unlinkSync(filePath);
    return {
      path: filePath,
      action: 'updated',
      note: 'removed empty hook file',
    };
  }

  fs.writeFileSync(filePath, `${remainder}\n`, 'utf8');
  return {
    path: filePath,
    action: 'updated',
    note: 'stripped ToonScope block',
  };
}

export function hasPrecommitHook(projectRoot: string): boolean {
  const { filePath } = hookFilePath(projectRoot);
  if (!filePath || !fs.existsSync(filePath)) return false;
  return fs.readFileSync(filePath, 'utf8').includes(HOOK_START);
}
