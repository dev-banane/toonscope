import { describe, expect, it } from 'vitest';
import { buildProjectGraph } from '../src/compiler/buildGraph';
import { scopeContext } from '../src/graph/scope';
import { fixtureRoot, defaultTestConfig } from './helpers';

describe('Scope query', () => {
  it('includes transitive dependencies up to depth for simple-react', async () => {
    const projectRoot = fixtureRoot('simple-react');
    const config = defaultTestConfig(projectRoot);
    const graph = await buildProjectGraph({
      projectRoot,
      config,
      useCache: false,
    });

    const target = 'src/components/UserCard.tsx';
    const scopedDepth2 = scopeContext(graph, target, 2);
    const paths2 = scopedDepth2.map((a) => a.path);

    expect(paths2).toContain('src/components/UserCard.tsx');
    expect(paths2).toContain('src/hooks/useAuth.ts');
    expect(paths2).toContain('src/api/auth.ts');

    const scopedDepth1 = scopeContext(graph, target, 1);
    const paths1 = scopedDepth1.map((a) => a.path);
    expect(paths1).toContain('src/hooks/useAuth.ts');
    expect(paths1).not.toContain('src/api/auth.ts');
  });
});
