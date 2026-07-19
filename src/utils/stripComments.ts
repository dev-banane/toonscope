export function stripComments(sourceText: string): string {
  const withoutBlock = sourceText.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutBlock.replace(/\/\/.*$/gm, '');
}
