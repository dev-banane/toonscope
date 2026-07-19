import type { DependencyGraph, FileAnalysis } from '../types';

export function scopeContext(
  graph: DependencyGraph,
  targetFile: string,
  depth: number
): FileAnalysis[] {
  const visited = new Set<string>();
  const queue: Array<[string, number]> = [[targetFile, 0]];

  while (queue.length > 0) {
    const [file, d] = queue.shift()!;
    if (visited.has(file) || d > depth) continue;
    visited.add(file);

    const imports = graph.edges.imports.get(file) ?? new Set<string>();
    const importedBy = graph.edges.importedBy.get(file) ?? new Set<string>();

    for (const dep of [...imports, ...importedBy]) {
      if (!visited.has(dep)) queue.push([dep, d + 1]);
    }
  }

  return [...visited]
    .map((p) => graph.nodes.get(p))
    .filter((n): n is FileAnalysis => Boolean(n))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function scopeProjectContext(
  graph: DependencyGraph,
  targetFile: string,
  depth: number
): FileAnalysis[] {
  return scopeContext(graph, targetFile, depth);
}
