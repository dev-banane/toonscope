import path from 'node:path';
import fs from 'node:fs';
import { Parser, Language, Tree } from 'web-tree-sitter';

export type GrammarName =
  | 'javascript'
  | 'typescript'
  | 'tsx'
  | 'python'
  | 'go'
  | 'rust'
  | 'c'
  | 'cpp'
  | 'c_sharp'
  | 'java'
  | 'kotlin';

const WASM_FILE_BY_GRAMMAR: Record<GrammarName, string> = {
  javascript: 'tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
  c: 'tree-sitter-c.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  c_sharp: 'tree-sitter-c_sharp.wasm',
  java: 'tree-sitter-java.wasm',
  kotlin: 'tree-sitter-kotlin.wasm',
};

const GRAMMAR_BY_EXT: Record<string, GrammarName> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.cs': 'c_sharp',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
};

export function grammarForFileExt(ext: string): GrammarName {
  return GRAMMAR_BY_EXT[ext.toLowerCase()] ?? 'javascript';
}

function findWasmDir(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'wasm');
    if (fs.existsSync(path.join(candidate, WASM_FILE_BY_GRAMMAR.javascript))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `toonscope: could not locate the wasm/ directory containing tree-sitter grammars (searched upward from ${startDir}).`
  );
}

let cachedWasmDir: string | null = null;
function resolveWasmDir(): string {
  if (!cachedWasmDir) {
    cachedWasmDir = findWasmDir(__dirname);
  }
  return cachedWasmDir;
}

let initPromise: Promise<void> | null = null;
function ensureParserInit(): Promise<void> {
  if (!initPromise) initPromise = Parser.init();
  return initPromise;
}

const languageCache = new Map<GrammarName, Language>();

async function loadLanguage(name: GrammarName): Promise<Language> {
  const cached = languageCache.get(name);
  if (cached) return cached;

  await ensureParserInit();
  const wasmPath = path.join(resolveWasmDir(), WASM_FILE_BY_GRAMMAR[name]);
  const language = await Language.load(wasmPath);
  languageCache.set(name, language);
  return language;
}

export async function parseFile(
  sourceText: string,
  ext: string
): Promise<Tree> {
  const grammarName = grammarForFileExt(ext);
  const language = await loadLanguage(grammarName);
  const parser = new Parser();
  try {
    parser.setLanguage(language);
    const tree = parser.parse(sourceText);
    if (!tree) {
      throw new Error(
        `toonscope: failed to parse source with grammar ${grammarName}`
      );
    }
    return tree;
  } finally {
    parser.delete();
  }
}
