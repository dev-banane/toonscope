import fs from 'node:fs';
import path from 'node:path';
import type { FileAnalysis, Language, ToonConfig } from '../types';
import { sha256Hex } from '../utils/hash';
import { normalizeProjectRelativePath } from '../utils/files';
import {
  parseExportsFromSource,
  parseImportsFromSource,
  parseSignaturesFromSource,
  parseTypesFromSource,
  detectFileType,
  parseSummaryTemplate,
} from './extractors';
import { analyzePython } from './python';
import { analyzeGeneric } from './generic';
import { parseFile } from './parser';

const EXT_TO_LANGUAGE: Record<string, Language> = {
  '.py': 'python',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.cs': 'csharp',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.rb': 'ruby',
};

const GENERIC_LANGUAGES = new Set<Language>([
  'go',
  'rust',
  'c',
  'cpp',
  'csharp',
  'java',
  'kotlin',
  'ruby',
]);

function languageForExt(ext: string): Language {
  return EXT_TO_LANGUAGE[ext] ?? 'javascript';
}

export async function analyzeFile(params: {
  projectRoot: string;
  absPath: string;
  config: ToonConfig;
}): Promise<FileAnalysis> {
  const { projectRoot, absPath } = params;
  const relPath = normalizeProjectRelativePath(projectRoot, absPath);
  const sourceText = fs.readFileSync(absPath, 'utf8');
  const contentHash = sha256Hex(sourceText);
  const fileExt = path.extname(absPath).toLowerCase();
  const language = languageForExt(fileExt);
  const lastAnalyzed = new Date().toISOString();

  const tree = await parseFile(sourceText, fileExt);
  try {
    const rootNode = tree.rootNode;

    if (language === 'python') {
      const result = analyzePython({
        rootNode,
        absPath,
        relPath,
        projectRoot,
        sourceText,
      });
      return {
        path: relPath,
        language,
        type: result.fileType,
        exports: result.exports,
        imports: result.imports,
        signatures: result.signatures,
        types: result.types,
        summary: result.summary,
        contentHash,
        lastAnalyzed,
      };
    }

    if (GENERIC_LANGUAGES.has(language)) {
      const result = analyzeGeneric(language, {
        rootNode,
        absPath,
        relPath,
        projectRoot,
        sourceText,
      });
      return {
        path: relPath,
        language,
        type: result.fileType,
        exports: result.exports,
        imports: result.imports,
        signatures: result.signatures,
        types: result.types,
        summary: result.summary,
        contentHash,
        lastAnalyzed,
      };
    }

    const exports = parseExportsFromSource(rootNode);
    const imports = parseImportsFromSource({
      rootNode,
      absPath,
      relPath,
      projectRoot,
    });
    const signatures = parseSignaturesFromSource(rootNode);
    const types = parseTypesFromSource(rootNode);
    const exportedTopLevelNames = new Set(
      exports.filter((e) => !e.name.includes('.')).map((e) => e.name)
    );
    for (const sig of signatures) {
      if (!sig.className && exportedTopLevelNames.has(sig.name)) {
        sig.isExported = true;
      }
    }
    for (const t of types) {
      if (exportedTopLevelNames.has(t.name)) t.isExported = true;
    }

    const type = detectFileType({
      absPath,
      relPath,
      sourceText,
      exports,
    });

    const summary = parseSummaryTemplate({
      path: relPath,
      language,
      type,
      exports,
      imports,
      signatures,
      types,
      summary: '',
      contentHash,
      lastAnalyzed,
    });

    return {
      path: relPath,
      language,
      type,
      exports,
      imports,
      signatures,
      types,
      summary,
      contentHash,
      lastAnalyzed,
    };
  } finally {
    tree.delete();
  }
}

export function fileExtFromRelPath(relPath: string): string {
  return path.extname(relPath).toLowerCase();
}
