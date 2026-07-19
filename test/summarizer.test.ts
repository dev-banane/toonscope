import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeFile } from '../src/analyzer/index';
import { templateSummary } from '../src/analyzer/summarizer';
import { fixtureRoot, defaultTestConfig } from './helpers';

describe('Template summarizer', () => {
  it('summarizes components and hooks using extracted structure', async () => {
    const projectRoot = fixtureRoot('simple-react');
    const config = defaultTestConfig(projectRoot);

    const userCardAbs = path.join(projectRoot, 'src/components/UserCard.tsx');
    const useAuthAbs = path.join(projectRoot, 'src/hooks/useAuth.ts');

    const userCard = await analyzeFile({
      projectRoot,
      absPath: userCardAbs,
      config,
    });
    const userCardSummary = templateSummary(userCard);
    expect(userCardSummary).toContain('React component');
    expect(userCardSummary).toContain('UserCard');

    const useAuth = await analyzeFile({
      projectRoot,
      absPath: useAuthAbs,
      config,
    });
    const useAuthSummary = templateSummary(useAuth);
    expect(useAuthSummary).toContain('Custom hook');
    expect(useAuthSummary).toContain('useAuth');
  });
});
