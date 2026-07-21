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

// ---------- Rust ----------

function parseRustUsePath(raw: string): { basePath: string; names: string[] } {
  const braceMatch = raw.match(/^(.*)::\{(.+)\}$/s);
  if (braceMatch) {
    const base = braceMatch[1];
    const names = braceMatch[2]
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/).pop()!.trim())
      .filter(Boolean);
    return { basePath: base, names };
  }
  const asMatch = raw.match(/^(.*)\s+as\s+(\w+)$/);
  if (asMatch) return { basePath: asMatch[1], names: [asMatch[2]] };
  const segs = raw.split('::');
  return { basePath: raw, names: [segs[segs.length - 1]] };
}

function resolveRustImport(
  projectRoot: string,
  absPath: string,
  basePath: string
): string | null {
  let segs = basePath.split('::').filter(Boolean);
  let baseDir: string;
  if (segs[0] === 'crate') {
    baseDir = path.join(projectRoot, 'src');
    segs = segs.slice(1);
  } else if (segs[0] === 'self' || segs[0] === 'super') {
    let dir = path.dirname(absPath);
    if (segs[0] === 'super') dir = path.dirname(dir);
    baseDir = dir;
    segs = segs.slice(1);
  } else {
    return null;
  }
  if (!segs.length) return null;
  const dropLast = segs.slice(0, -1);
  const candidateSegs = dropLast.length ? [segs, dropLast] : [segs];
  for (const s of candidateSegs) {
    if (!s.length) continue;
    const candidates = [
      path.join(baseDir, ...s) + '.rs',
      path.join(baseDir, ...s, 'mod.rs'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return normalizeProjectRelativePath(projectRoot, c);
    }
  }
  return null;
}

function hasPubModifier(node: any): boolean {
  return children(node).some((c: any) => c.type === 'visibility_modifier');
}

function rustParams(paramsNode: any): ParamInfo[] {
  const out: ParamInfo[] = [];
  for (const p of children(paramsNode)) {
    if (p.type !== 'parameter') continue;
    const patternNode = p.childForFieldName?.('pattern');
    const typeNode = p.childForFieldName?.('type');
    const name = patternNode?.text ?? '';
    if (!name) continue;
    const info: ParamInfo = { name };
    if (typeNode) info.type = typeNode.text;
    out.push(info);
  }
  return out;
}

function rustFnSignature(node: any, className?: string): SignatureInfo {
  const name = fieldText(node, 'name') ?? '';
  const isAsync = children(node).some((c: any) => c.type === 'async');
  return {
    name: className ? `${className}.${name}` : name,
    kind: className ? (name === 'new' ? 'constructor' : 'method') : 'function',
    className,
    params: rustParams(node.childForFieldName?.('parameters')),
    returnType: fieldText(node, 'return_type'),
    isAsync,
    isGenerator: false,
    isExported: hasPubModifier(node),
    doc: leadingDoc(node),
  };
}

function analyzeRust(ctx: Ctx): GenericAnalysisResult {
  const { rootNode, absPath, relPath, projectRoot } = ctx;
  const imports: ImportInfo[] = [];
  const signatures: SignatureInfo[] = [];
  const types: TypeInfo[] = [];
  const exports: ExportInfo[] = [];

  for (const node of children(rootNode)) {
    if (node.type === 'use_declaration') {
      const raw = node.text.replace(/^use\s+/, '').replace(/;$/, '').trim();
      const { basePath, names } = parseRustUsePath(raw);
      imports.push({
        source: raw,
        resolvedPath: resolveRustImport(projectRoot, absPath, basePath),
        names,
        isTypeOnly: false,
      });
      continue;
    }

    if (node.type === 'function_item') {
      const sig = rustFnSignature(node);
      if (!sig.name) continue;
      signatures.push(sig);
      if (sig.isExported)
        exports.push({ name: sig.name, kind: 'function', isDefault: false });
      continue;
    }

    if (node.type === 'struct_item' || node.type === 'enum_item') {
      const name = fieldText(node, 'name') ?? '';
      if (!name) continue;
      const isExported = hasPubModifier(node);
      const bodyNode = node.childForFieldName?.('body');
      let definition = 'unknown';
      const kind: TypeInfo['kind'] =
        node.type === 'enum_item' ? 'enum' : 'class';

      if (node.type === 'struct_item' && bodyNode) {
        const fields: string[] = [];
        for (const f of children(bodyNode)) {
          if (f.type === 'field_declaration') {
            const fname = fieldText(f, 'name');
            const ftype = fieldText(f, 'type');
            if (fname) fields.push(ftype ? `${fname}: ${ftype}` : fname);
          }
        }
        definition = `{ ${fields.join(', ')} }`;
      } else if (node.type === 'enum_item' && bodyNode) {
        const variants: string[] = [];
        for (const v of children(bodyNode)) {
          if (v.type === 'enum_variant') {
            const vname = fieldText(v, 'name');
            if (vname) variants.push(vname);
          }
        }
        definition = variants.join(' | ') || '{}';
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
          kind: kind === 'enum' ? 'enum' : 'class',
          isDefault: false,
        });
      continue;
    }

    if (node.type === 'trait_item') {
      const name = fieldText(node, 'name') ?? '';
      if (!name) continue;
      const isExported = hasPubModifier(node);
      types.push({
        name,
        kind: 'interface',
        definition: '{}',
        isExported,
        doc: leadingDoc(node),
      });
      if (isExported)
        exports.push({ name, kind: 'interface', isDefault: false });
      const body = node.childForFieldName?.('body');
      for (const m of children(body)) {
        if (
          m.type === 'function_signature_item' ||
          m.type === 'function_item'
        ) {
          const sig = rustFnSignature(m, name);
          sig.isExported = isExported;
          signatures.push(sig);
        }
      }
      continue;
    }

    if (node.type === 'impl_item') {
      const typeName = fieldText(node, 'type') ?? '';
      const body = node.childForFieldName?.('body');
      for (const m of children(body)) {
        if (m.type === 'function_item') {
          signatures.push(rustFnSignature(m, typeName));
        }
      }
      continue;
    }
  }

  const fileType = detectGenericFileType({
    relPath,
    testPattern: /_test\.rs$/,
    testDirRegex: /\/tests\//,
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
    case 'rust':
      return analyzeRust(ctx);
    default:
      throw new Error(`analyzeGeneric: unsupported language ${language}`);
  }
}
