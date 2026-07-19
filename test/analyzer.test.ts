import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeFile } from '../src/analyzer/index';
import { loadConfig } from '../src/config';
import { fixtureRoot, defaultTestConfig } from './helpers';

describe('Analyzer', () => {
  it('extracts component, hook, and types from simple-react fixtures', async () => {
    const projectRoot = fixtureRoot('simple-react');
    const config = defaultTestConfig(projectRoot);

    const userCardPath = path.join(projectRoot, 'src/components/UserCard.tsx');
    const useAuthPath = path.join(projectRoot, 'src/hooks/useAuth.ts');
    const userTypesPath = path.join(projectRoot, 'src/types/user.ts');

    const userCard = await analyzeFile({
      projectRoot,
      absPath: userCardPath,
      config,
    });
    expect(userCard.type).toBe('component');
    expect(userCard.exports.map((e) => e.name)).toContain('UserCard');
    expect(
      userCard.imports.some((i) =>
        i.resolvedPath?.endsWith('src/hooks/useAuth.ts')
      )
    ).toBe(true);

    const useAuth = await analyzeFile({
      projectRoot,
      absPath: useAuthPath,
      config,
    });
    expect(useAuth.type).toBe('hook');
    expect(useAuth.exports.map((e) => e.name)).toContain('useAuth');
    expect(
      useAuth.imports.some((i) => i.resolvedPath?.endsWith('src/api/auth.ts'))
    ).toBe(true);

    const userTypes = await analyzeFile({
      projectRoot,
      absPath: userTypesPath,
      config,
    });
    expect(userTypes.type).toBe('types');
    expect(userTypes.exports.map((e) => e.name)).toContain('User');
    expect(
      userTypes.types.some((t) => t.name === 'User' || t.name === 'Role')
    ).toBe(true);
  });
});
