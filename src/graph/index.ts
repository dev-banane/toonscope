import type { DependencyGraph, FileAnalysis } from '../types';

export function buildGraph(analyses: FileAnalysis[]): DependencyGraph {
  const graph: DependencyGraph = {
    nodes: new Map(),
    edges: {
      imports: new Map(),
      importedBy: new Map(),
    },
  };

  for (const a of analyses) {
    graph.nodes.set(a.path, a);
    const deps = new Set<string>();

    for (const imp of a.imports) {
      if (imp.resolvedPath) deps.add(imp.resolvedPath);
    }

    graph.edges.imports.set(a.path, deps);
  }

  for (const [src, deps] of graph.edges.imports) {
    for (const dep of deps) {
      if (!graph.edges.importedBy.has(dep))
        graph.edges.importedBy.set(dep, new Set());
      graph.edges.importedBy.get(dep)!.add(src);
    }
  }

  return graph;
}
