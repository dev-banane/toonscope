import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProjectGraph } from '../src/compiler/buildGraph';
import { fixtureRoot, defaultTestConfig } from './helpers';

describe('Dependency graph', () => {
  it('builds correct import edges for simple-react', async () => {
    const projectRoot = fixtureRoot('simple-react');
    const config = defaultTestConfig(projectRoot);

    const graph = await buildProjectGraph({
      projectRoot,
      config,
      useCache: false,
    });

    const userList = 'src/components/UserList.tsx';
    const userCard = 'src/components/UserCard.tsx';
    const useAuth = 'src/hooks/useAuth.ts';

    const depsFromList = graph.edges.imports.get(userList) ?? new Set<string>();
    expect([...depsFromList]).toContain(userCard);

    const depsFromCard = graph.edges.imports.get(userCard) ?? new Set<string>();
    expect([...depsFromCard]).toContain(useAuth);
  });
});
