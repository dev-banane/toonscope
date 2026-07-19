export function formatPercent(n: number): string {
  return `${n.toFixed(1)}%`;
}

export function formatInt(n: number): string {
  return n.toLocaleString();
}
