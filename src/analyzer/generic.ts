import fs from 'node:fs';
import path from 'node:path';
import type {
  ExportInfo,
  FileType,
  ImportInfo,
  Language,
  ParamInfo,
  SignatureInfo,
  TypeInfo,
} from '../types';
import { normalizeProjectRelativePath } from '../utils/files';

export interface GenericAnalysisResult {
  exports: ExportInfo[];
  imports: ImportInfo[];
  signatures: SignatureInfo[];
  types: TypeInfo[];
  summary: string;
  fileType: FileType;
}

interface Ctx {
  rootNode: any;
  absPath: string;
  relPath: string;
  projectRoot: string;
  sourceText: string;
}

// ---------- shared helpers ----------

function children(node: any): any[] {
  return node?.namedChildren ?? [];
}

function fieldText(node: any, field: string): string | undefined {
  return node?.childForFieldName?.(field)?.text;
}

function findDescendant(node: any, type: string): any {
  if (!node) return null;
  if (node.type === type) return node;
  for (const c of node.namedChildren ?? []) {
    const found = findDescendant(c, type);
    if (found) return found;
  }
  return null;
}

function stripCommentMarkers(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*\/\*\*?!?/, '')
        .replace(/\*\/\s*$/, '')
        .replace(/^\s*\*\/?/, '')
        .replace(/^\s*\/\/\/?!?/, '')
        .replace(/^\s*#/, '')
        .trim()
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function leadingDoc(node: any): string | undefined {
  if (!node) return undefined;
  const parts: string[] = [];
  let prev = node.previousSibling;
  while (prev && /comment/i.test(prev.type)) {
    parts.unshift(stripCommentMarkers(prev.text));
    prev = prev.previousSibling;
  }
  const joined = parts.join(' ').trim();
  return joined || undefined;
}

function detectGenericFileType(params: {
  relPath: string;
  testPattern: RegExp;
  testDirRegex?: RegExp;
}): FileType {
  const lower = params.relPath.toLowerCase();
  if (
    params.testPattern.test(lower) ||
    (params.testDirRegex && params.testDirRegex.test(lower))
  )
    return 'test';
  if (/\/models?\//.test(lower)) return 'model';
  if (/\/config\//.test(lower)) return 'config';
  if (/\/(routes?|controllers?|api)\//.test(lower)) return 'route';
  return 'module';
}

function genericSummary(params: {
  fileType: FileType;
  exports: ExportInfo[];
  signatures: SignatureInfo[];
}): string {
  const { fileType, exports, signatures } = params;
  const names = exports.map((e) => e.name).filter(Boolean);
  switch (fileType) {
    case 'test':
      return `Test file exercising ${names.join(', ') || 'nothing'}.`;
    case 'model':
      return `Model module defining ${names.join(', ') || 'nothing'}.`;
    case 'config':
      return `Configuration module exposing ${names.join(', ') || 'nothing'}.`;
    case 'route':
      return `Route/API module exposing ${names.join(', ') || 'nothing'}.`;
    default: {
      const mainSig = signatures.find((s) => s.isExported);
      const arity = mainSig
        ? ` (${mainSig.params.length} arg${mainSig.params.length === 1 ? '' : 's'})`
        : '';
      return `Module exporting ${names.join(', ') || 'nothing'}${names.length && mainSig ? arity : ''}.`;
    }
  }
}

// ---------- Go ----------

function goParams(paramList: any): ParamInfo[] {
  const out: ParamInfo[] = [];
  for (const p of children(paramList)) {
    if (
      p.type !== 'parameter_declaration' &&
      p.type !== 'variadic_parameter_declaration'
    )
      continue;
    const name = fieldText(p, 'name') ?? '';
    const type = fieldText(p, 'type');
    if (!name) continue;
    const info: ParamInfo = { name };
    if (type) info.type = type;
    if (p.type === 'variadic_parameter_declaration') info.rest = true;
    out.push(info);
  }
  return out;
}

function analyzeGo(ctx: Ctx): GenericAnalysisResult {
  const { rootNode, relPath } = ctx;
  const imports: ImportInfo[] = [];
  const signatures: SignatureInfo[] = [];
  const types: TypeInfo[] = [];
  const exports: ExportInfo[] = [];

  const isExportedName = (name: string) => /^[A-Z]/.test(name);

  for (const node of children(rootNode)) {
    if (node.type === 'import_declaration') {
      const listNode = children(node).find(
        (c: any) => c.type === 'import_spec_list'
      );
      const specs = listNode
        ? children(listNode)
        : children(node).filter((c: any) => c.type === 'import_spec');
      for (const spec of specs) {
        const pathNode = spec.childForFieldName?.('path');
        const nameNode = spec.childForFieldName?.('name');
        const raw = (pathNode?.text ?? '').replace(/^"|"$/g, '');
        const alias = nameNode?.text;
        const binding = alias ?? raw.split('/').pop() ?? raw;
        imports.push({
          source: raw,
          resolvedPath: null,
          names: binding ? [binding] : [],
          isTypeOnly: false,
        });
      }
      continue;
    }

    if (node.type === 'function_declaration') {
      const name = fieldText(node, 'name') ?? '';
      if (!name) continue;
      const isExported = isExportedName(name);
      signatures.push({
        name,
        kind: 'function',
        params: goParams(node.childForFieldName?.('parameters')),
        returnType: fieldText(node, 'result'),
        isAsync: false,
        isGenerator: false,
        isExported,
        doc: leadingDoc(node),
      });
      if (isExported) exports.push({ name, kind: 'function', isDefault: false });
      continue;
    }

    if (node.type === 'method_declaration') {
      const name = fieldText(node, 'name') ?? '';
      if (!name) continue;
      const receiverList = node.childForFieldName?.('receiver');
      const receiverDecl = children(receiverList)[0];
      const recvType = (
        receiverDecl?.childForFieldName?.('type')?.text ?? ''
      ).replace(/^\*/, '');
      signatures.push({
        name: recvType ? `${recvType}.${name}` : name,
        kind: 'method',
        className: recvType || undefined,
        params: goParams(node.childForFieldName?.('parameters')),
        returnType: fieldText(node, 'result'),
        isAsync: false,
        isGenerator: false,
        isExported: isExportedName(name),
        doc: leadingDoc(node),
      });
      continue;
    }

    if (node.type === 'type_declaration') {
      for (const spec of children(node)) {
        if (spec.type !== 'type_spec') continue;
        const name = fieldText(spec, 'name') ?? '';
        if (!name) continue;
        const typeNode = spec.childForFieldName?.('type');
        const isExported = isExportedName(name);
        let kind: TypeInfo['kind'] = 'type';
        let definition =
          typeNode?.text?.replace(/\s+/g, ' ').trim() ?? 'unknown';

        if (typeNode?.type === 'struct_type') {
          kind = 'class';
          const fields: string[] = [];
          const fieldList = children(typeNode).find(
            (c: any) => c.type === 'field_declaration_list'
          );
          for (const f of children(fieldList)) {
            if (f.type === 'field_declaration') {
              const fname = fieldText(f, 'name');
              const ftype = fieldText(f, 'type');
              if (fname) fields.push(ftype ? `${fname} ${ftype}` : fname);
            }
          }
          definition = `{ ${fields.join(', ')} }`;
        } else if (typeNode?.type === 'interface_type') {
          kind = 'interface';
          const methods: string[] = [];
          for (const m of children(typeNode)) {
            if (m.type === 'method_spec') {
              const mname = fieldText(m, 'name');
              if (mname) methods.push(mname);
            }
          }
          definition = `{ ${methods.join(', ')} }`;
        }

        types.push({
          name,
          kind,
          definition,
          isExported,
          doc: leadingDoc(node),
        });
        if (isExported)
          exports.push({
            name,
            kind: kind === 'interface' ? 'interface' : 'class',
            isDefault: false,
          });
      }
      continue;
    }
  }

  const fileType = detectGenericFileType({
    relPath,
    testPattern: /_test\.go$/,
  });
  const summary = genericSummary({ fileType, exports, signatures });
  return { exports, imports, signatures, types, summary, fileType };
}

// ---------- dispatcher ----------

export function analyzeGeneric(
  language: Language,
  ctx: Ctx
): GenericAnalysisResult {
  switch (language) {
    case 'go':
      return analyzeGo(ctx);
    default:
      throw new Error(`analyzeGeneric: unsupported language ${language}`);
  }
}
