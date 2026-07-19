import { execSync } from 'node:child_process';
import { countTokens } from '../src/utils/tokens';

export function tryCountRepomix(projectDir: string): {
  tokens: number;
  error?: string;
} {
  try {
    const output = execSync(`npx repomix --compress "${projectDir}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { tokens: countTokens(output) };
  } catch (e: any) {
    return { tokens: 0, error: String(e?.message ?? e) };
  }
}
