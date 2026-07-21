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
      if (isExported)
        exports.push({ name, kind: 'function', isDefault: false });
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
      .map((s) =>
        s
          .trim()
          .split(/\s+as\s+/)
          .pop()!
          .trim()
      )
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
      const raw = node.text
        .replace(/^use\s+/, '')
        .replace(/;$/, '')
        .trim();
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

// ---------- C ----------

function pointerDepth(declarator: any): number {
  let d = declarator;
  let depth = 0;
  while (d && d.type === 'pointer_declarator') {
    depth++;
    d = d.childForFieldName?.('declarator');
  }
  return depth;
}

function cParams(paramList: any): ParamInfo[] {
  const out: ParamInfo[] = [];
  for (const p of children(paramList)) {
    if (p.type !== 'parameter_declaration') continue;
    const type = fieldText(p, 'type');
    const declarator = p.childForFieldName?.('declarator');
    let nameNode = declarator;
    if (declarator && declarator.type !== 'identifier') {
      nameNode = findDescendant(declarator, 'identifier');
    }
    const name = nameNode?.text ?? '';
    if (!name) continue;
    const info: ParamInfo = { name };
    if (type)
      info.type = `${type.replace(/\s+/g, ' ').trim()}${'*'.repeat(pointerDepth(declarator))}`;
    out.push(info);
  }
  return out;
}

function cFunctionInfo(
  node: any
): { name: string; params: ParamInfo[]; returnType?: string } | null {
  const declarator = findDescendant(node, 'function_declarator');
  if (!declarator) return null;
  let nameNode = declarator.childForFieldName?.('declarator');
  let name = nameNode?.text ?? '';
  if (nameNode?.type === 'qualified_identifier') {
    name = nameNode.childForFieldName?.('name')?.text ?? name;
  }
  const returnTypeNode = node.childForFieldName?.('type');
  return {
    name,
    params: cParams(declarator.childForFieldName?.('parameters')),
    returnType: returnTypeNode?.text?.trim(),
  };
}

function isStaticNode(node: any): boolean {
  return children(node).some(
    (c: any) => c.type === 'storage_class_specifier' && c.text === 'static'
  );
}

function analyzeCLike(ctx: Ctx, opts: { cpp: boolean }): GenericAnalysisResult {
  const { rootNode, absPath, relPath, projectRoot } = ctx;
  const imports: ImportInfo[] = [];
  const signatures: SignatureInfo[] = [];
  const types: TypeInfo[] = [];
  const exports: ExportInfo[] = [];

  function resolveInclude(raw: string, quoted: boolean): string | null {
    if (!quoted) return null;
    const candidate = path.join(path.dirname(absPath), raw);
    return fs.existsSync(candidate)
      ? normalizeProjectRelativePath(projectRoot, candidate)
      : null;
  }

  function walkTop(nodes: any[]) {
    for (const node of nodes) {
      if (node.type === 'preproc_include') {
        const pathNode = node.childForFieldName?.('path');
        const quoted = pathNode?.type === 'string_literal';
        const raw = (pathNode?.text ?? '').replace(/^["<]|[">]$/g, '');
        imports.push({
          source: raw,
          resolvedPath: resolveInclude(raw, quoted),
          names: [],
          isTypeOnly: false,
        });
        continue;
      }

      if (node.type === 'namespace_definition') {
        walkTop(children(node.childForFieldName?.('body')));
        continue;
      }

      if (
        node.type === 'preproc_ifdef' ||
        node.type === 'preproc_if' ||
        node.type === 'linkage_specification'
      ) {
        walkTop(children(node));
        continue;
      }

      if (node.type === 'function_definition') {
        const info = cFunctionInfo(node);
        if (!info || !info.name) continue;
        const isExported = !isStaticNode(node);
        signatures.push({
          name: info.name,
          kind: 'function',
          params: info.params,
          returnType: info.returnType,
          isAsync: false,
          isGenerator: false,
          isExported,
          doc: leadingDoc(node),
        });
        if (isExported)
          exports.push({ name: info.name, kind: 'function', isDefault: false });
        continue;
      }

      if (
        node.type === 'struct_specifier' ||
        node.type === 'enum_specifier' ||
        node.type === 'union_specifier'
      ) {
        const name = fieldText(node, 'name');
        if (!name) continue;
        const body = node.childForFieldName?.('body');
        let definition = '{}';
        let kind: TypeInfo['kind'] = 'class';
        if (node.type === 'enum_specifier') {
          kind = 'enum';
          const members: string[] = [];
          for (const e of children(body))
            if (e.type === 'enumerator')
              members.push(fieldText(e, 'name') ?? '');
          definition = members.filter(Boolean).join(' | ') || '{}';
        } else {
          const fields: string[] = [];
          for (const f of children(body)) {
            if (f.type === 'field_declaration') {
              const ftype = fieldText(f, 'type');
              const decl = f.childForFieldName?.('declarator');
              const fname =
                decl?.type === 'identifier' || decl?.type === 'field_identifier'
                  ? decl.text
                  : findDescendant(decl, 'field_identifier')?.text;
              if (fname) fields.push(ftype ? `${fname}: ${ftype}` : fname);
            }
          }
          definition = `{ ${fields.join(', ')} }`;
        }
        types.push({
          name,
          kind,
          definition,
          isExported: true,
          doc: leadingDoc(node),
        });
        exports.push({
          name,
          kind: kind === 'enum' ? 'enum' : 'class',
          isDefault: false,
        });
        continue;
      }

      if (opts.cpp && node.type === 'class_specifier') {
        const name = fieldText(node, 'name');
        if (!name) continue;
        const body = node.childForFieldName?.('body');
        const fields: string[] = [];
        for (const member of children(body)) {
          if (
            member.type === 'field_declaration' ||
            member.type === 'declaration'
          ) {
            const declarator = member.childForFieldName?.('declarator');
            const fnDeclarator =
              declarator?.type === 'function_declarator' ? declarator : null;
            if (fnDeclarator) {
              const nameNode = fnDeclarator.childForFieldName?.('declarator');
              const methodName = nameNode?.text ?? '';
              if (!methodName) continue;
              signatures.push({
                name: `${name}.${methodName}`,
                kind: methodName === name ? 'constructor' : 'method',
                className: name,
                params: cParams(fnDeclarator.childForFieldName?.('parameters')),
                returnType: fieldText(member, 'type'),
                isAsync: false,
                isGenerator: false,
                isExported: true,
                doc: leadingDoc(member),
              });
            } else {
              const ftype = fieldText(member, 'type');
              const fname =
                declarator?.type === 'field_identifier'
                  ? declarator.text
                  : findDescendant(declarator, 'field_identifier')?.text;
              if (fname) fields.push(ftype ? `${fname}: ${ftype}` : fname);
            }
          } else if (member.type === 'function_definition') {
            const info = cFunctionInfo(member);
            if (info?.name) {
              signatures.push({
                name: `${name}.${info.name}`,
                kind: info.name === name ? 'constructor' : 'method',
                className: name,
                params: info.params,
                returnType: info.returnType,
                isAsync: false,
                isGenerator: false,
                isExported: true,
                doc: leadingDoc(member),
              });
            }
          }
        }
        types.push({
          name,
          kind: 'class',
          definition: `{ ${fields.join(', ')} }`,
          isExported: true,
          doc: leadingDoc(node),
        });
        exports.push({ name, kind: 'class', isDefault: false });
        continue;
      }
    }
  }

  walkTop(children(rootNode));

  const fileType = detectGenericFileType({
    relPath,
    testPattern: /(^|\/)test_.*\.(c|cc|cpp|cxx)$|_test\.(c|cc|cpp|cxx)$/,
    testDirRegex: /\/tests?\//,
  });
  const summary = genericSummary({ fileType, exports, signatures });
  return { exports, imports, signatures, types, summary, fileType };
}

// ---------- C# ----------

function csParams(node: any): ParamInfo[] {
  const out: ParamInfo[] = [];
  for (const p of children(node)) {
    if (p.type !== 'parameter') continue;
    const name = fieldText(p, 'name') ?? '';
    if (!name) continue;
    const type = fieldText(p, 'type');
    const info: ParamInfo = { name };
    if (type) info.type = type;
    out.push(info);
  }
  return out;
}

function hasModifierCs(node: any, mod: string): boolean {
  return children(node).some(
    (c: any) => c.type === 'modifier' && c.text === mod
  );
}

function analyzeCSharp(ctx: Ctx): GenericAnalysisResult {
  const { rootNode, relPath } = ctx;
  const imports: ImportInfo[] = [];
  const signatures: SignatureInfo[] = [];
  const types: TypeInfo[] = [];
  const exports: ExportInfo[] = [];

  function walkBody(body: any, className: string, isTypeExported: boolean) {
    for (const member of children(body)) {
      if (member.type === 'method_declaration') {
        const name = fieldText(member, 'name') ?? '';
        if (!name) continue;
        const isPublic =
          hasModifierCs(member, 'public') ||
          (isTypeExported && !hasModifierCs(member, 'private'));
        signatures.push({
          name: `${className}.${name}`,
          kind: 'method',
          className,
          params: csParams(member.childForFieldName?.('parameters')),
          returnType: fieldText(member, 'type'),
          isAsync: hasModifierCs(member, 'async'),
          isGenerator: false,
          isExported: isPublic,
          doc: leadingDoc(member),
        });
      } else if (member.type === 'constructor_declaration') {
        const name = fieldText(member, 'name') ?? className;
        signatures.push({
          name: `${className}.${name}`,
          kind: 'constructor',
          className,
          params: csParams(member.childForFieldName?.('parameters')),
          isAsync: false,
          isGenerator: false,
          isExported: hasModifierCs(member, 'public'),
          doc: leadingDoc(member),
        });
      }
    }
  }

  function walkTypeDecl(node: any) {
    const name = fieldText(node, 'name') ?? '';
    if (!name) return;
    const isExported = hasModifierCs(node, 'public');
    const body = node.childForFieldName?.('body');
    let kind: TypeInfo['kind'] = 'class';
    let definition = '{}';
    if (node.type === 'interface_declaration') kind = 'interface';
    else if (node.type === 'enum_declaration') kind = 'enum';

    if (node.type === 'enum_declaration' && body) {
      const members: string[] = [];
      for (const m of children(body))
        if (m.type === 'enum_member_declaration')
          members.push(fieldText(m, 'name') ?? '');
      definition = members.filter(Boolean).join(' | ') || '{}';
    }

    types.push({ name, kind, definition, isExported, doc: leadingDoc(node) });
    if (isExported)
      exports.push({
        name,
        kind:
          kind === 'interface'
            ? 'interface'
            : kind === 'enum'
              ? 'enum'
              : 'class',
        isDefault: false,
      });
    if (body) walkBody(body, name, isExported);
  }

  function walk(nodes: any[]) {
    for (const node of nodes) {
      if (node.type === 'using_directive') {
        const nameNode = children(node)[0];
        const raw = nameNode?.text ?? '';
        imports.push({
          source: raw,
          resolvedPath: null,
          names: raw ? [raw.split('.').pop()!] : [],
          isTypeOnly: false,
        });
        continue;
      }
      if (node.type === 'namespace_declaration') {
        walk(children(node.childForFieldName?.('body')));
        continue;
      }
      if (
        [
          'class_declaration',
          'interface_declaration',
          'struct_declaration',
          'enum_declaration',
          'record_declaration',
        ].includes(node.type)
      ) {
        walkTypeDecl(node);
        continue;
      }
    }
  }

  walk(children(rootNode));

  const fileType = detectGenericFileType({
    relPath,
    testPattern: /tests?\.cs$/i,
    testDirRegex: /\/tests?\//,
  });
  const summary = genericSummary({ fileType, exports, signatures });
  return { exports, imports, signatures, types, summary, fileType };
}

// ---------- Java ----------

function javaParams(paramList: any): ParamInfo[] {
  const out: ParamInfo[] = [];
  for (const p of children(paramList)) {
    if (p.type !== 'formal_parameter' && p.type !== 'spread_parameter')
      continue;
    const name = fieldText(p, 'name') ?? '';
    if (!name) continue;
    const type = fieldText(p, 'type');
    const info: ParamInfo = { name };
    if (type) info.type = type;
    if (p.type === 'spread_parameter') info.rest = true;
    out.push(info);
  }
  return out;
}

function hasJavaModifier(node: any, mod: string): boolean {
  const modifiers = children(node).find((c: any) => c.type === 'modifiers');
  if (!modifiers) return false;
  return new RegExp(`(^|\\s)${mod}(\\s|$)`).test(modifiers.text);
}

function analyzeJava(ctx: Ctx): GenericAnalysisResult {
  const { rootNode, relPath, projectRoot } = ctx;
  const imports: ImportInfo[] = [];
  const signatures: SignatureInfo[] = [];
  const types: TypeInfo[] = [];
  const exports: ExportInfo[] = [];

  function resolveJavaImport(dotted: string): string | null {
    const parts = dotted.split('.');
    const withExt = path.join(projectRoot, ...parts) + '.java';
    return fs.existsSync(withExt)
      ? normalizeProjectRelativePath(projectRoot, withExt)
      : null;
  }

  function walkClassBody(
    body: any,
    className: string,
    isTopExported: boolean,
    implicitPublic: boolean
  ) {
    for (const member of children(body)) {
      if (member.type === 'method_declaration') {
        const name = fieldText(member, 'name') ?? '';
        if (!name) continue;
        const isPublic = hasJavaModifier(member, 'public') || implicitPublic;
        signatures.push({
          name: `${className}.${name}`,
          kind: 'method',
          className,
          params: javaParams(member.childForFieldName?.('parameters')),
          returnType: fieldText(member, 'type'),
          isAsync: false,
          isGenerator: false,
          isExported: isTopExported && isPublic,
          doc: leadingDoc(member),
        });
      } else if (member.type === 'constructor_declaration') {
        const isPublic = hasJavaModifier(member, 'public');
        signatures.push({
          name: `${className}.${className}`,
          kind: 'constructor',
          className,
          params: javaParams(member.childForFieldName?.('parameters')),
          isAsync: false,
          isGenerator: false,
          isExported: isTopExported && isPublic,
          doc: leadingDoc(member),
        });
      }
    }
  }

  function walkTypeDecl(node: any) {
    const name = fieldText(node, 'name') ?? '';
    if (!name) return;
    const isExported = hasJavaModifier(node, 'public');
    const body = node.childForFieldName?.('body');
    let kind: TypeInfo['kind'] = 'class';
    let definition = '{}';
    if (node.type === 'interface_declaration') kind = 'interface';
    else if (node.type === 'enum_declaration') kind = 'enum';

    if (node.type === 'enum_declaration' && body) {
      const constants: string[] = [];
      for (const c of children(body))
        if (c.type === 'enum_constant')
          constants.push(fieldText(c, 'name') ?? '');
      definition = constants.filter(Boolean).join(' | ') || '{}';
    } else if (body) {
      const members: string[] = [];
      for (const m of children(body)) {
        if (m.type === 'field_declaration') {
          const type = fieldText(m, 'type');
          const declarator = children(m).find(
            (c: any) => c.type === 'variable_declarator'
          );
          const fname = declarator?.childForFieldName?.('name')?.text;
          if (fname) members.push(type ? `${fname}: ${type}` : fname);
        }
      }
      definition = `{ ${members.join(', ')} }`;
    }

    types.push({ name, kind, definition, isExported, doc: leadingDoc(node) });
    if (isExported)
      exports.push({
        name,
        kind:
          kind === 'interface'
            ? 'interface'
            : kind === 'enum'
              ? 'enum'
              : 'class',
        isDefault: false,
      });

    if (body)
      walkClassBody(
        body,
        name,
        isExported,
        node.type === 'interface_declaration'
      );
  }

  for (const node of children(rootNode)) {
    if (node.type === 'import_declaration') {
      const scoped = children(node)[0];
      const dotted = scoped?.text ?? '';
      const nameSeg = dotted.split('.').pop() ?? dotted;
      imports.push({
        source: dotted,
        resolvedPath: resolveJavaImport(dotted),
        names: nameSeg ? [nameSeg] : [],
        isTypeOnly: false,
      });
      continue;
    }
    if (
      [
        'class_declaration',
        'interface_declaration',
        'enum_declaration',
        'record_declaration',
      ].includes(node.type)
    ) {
      walkTypeDecl(node);
      continue;
    }
  }

  const fileType = detectGenericFileType({
    relPath,
    testPattern: /tests?\.java$/i,
    testDirRegex: /\/test\//,
  });
  const summary = genericSummary({ fileType, exports, signatures });
  return { exports, imports, signatures, types, summary, fileType };
}

// ---------- Kotlin ----------

function kotlinParams(paramsNode: any): ParamInfo[] {
  const out: ParamInfo[] = [];
  for (const p of children(paramsNode)) {
    if (p.type !== 'parameter') continue;
    const named = children(p);
    const name = named[0]?.text ?? '';
    if (!name) continue;
    const typeNode = named[1];
    const info: ParamInfo = { name };
    if (typeNode) info.type = typeNode.text;
    out.push(info);
  }
  return out;
}

function kotlinFunctionParts(node: any): {
  name: string;
  paramsNode: any;
  returnTypeNode: any;
} {
  const named = children(node);
  const name =
    named.find((c: any) => c.type === 'simple_identifier')?.text ?? '';
  const paramsNode = named.find(
    (c: any) => c.type === 'function_value_parameters'
  );
  const bodyIdx = named.findIndex((c: any) => c.type === 'function_body');
  const paramsIdx = named.indexOf(paramsNode);
  const between = named.slice(
    paramsIdx + 1,
    bodyIdx >= 0 ? bodyIdx : named.length
  );
  const returnTypeNode = between[0] ?? null;
  return { name, paramsNode, returnTypeNode };
}

function hasKotlinModifier(node: any, mod: string): boolean {
  const modifiers = children(node).find((c: any) => c.type === 'modifiers');
  if (!modifiers) return false;
  return modifiers.text.includes(mod);
}

function analyzeKotlin(ctx: Ctx): GenericAnalysisResult {
  const { rootNode, relPath, projectRoot } = ctx;
  const imports: ImportInfo[] = [];
  const signatures: SignatureInfo[] = [];
  const types: TypeInfo[] = [];
  const exports: ExportInfo[] = [];

  function resolveKotlinImport(dotted: string): string | null {
    const parts = dotted.split('.');
    const withExt = path.join(projectRoot, ...parts) + '.kt';
    return fs.existsSync(withExt)
      ? normalizeProjectRelativePath(projectRoot, withExt)
      : null;
  }

  function walkClassBody(
    body: any,
    className: string,
    isTypeExported: boolean
  ) {
    for (const member of children(body)) {
      if (member.type !== 'function_declaration') continue;
      const { name, paramsNode, returnTypeNode } = kotlinFunctionParts(member);
      if (!name) continue;
      const isPrivate = hasKotlinModifier(member, 'private');
      signatures.push({
        name: `${className}.${name}`,
        kind: 'method',
        className,
        params: kotlinParams(paramsNode),
        returnType: returnTypeNode?.text,
        isAsync: false,
        isGenerator: false,
        isExported: isTypeExported && !isPrivate,
        doc: leadingDoc(member),
      });
    }
  }

  for (const node of children(rootNode)) {
    if (node.type === 'import_list') {
      for (const header of children(node)) {
        if (header.type !== 'import_header') continue;
        const idNode = children(header)[0];
        const dotted = idNode?.text ?? '';
        const nameSeg = dotted.split('.').pop() ?? dotted;
        imports.push({
          source: dotted,
          resolvedPath: resolveKotlinImport(dotted),
          names: nameSeg ? [nameSeg] : [],
          isTypeOnly: false,
        });
      }
      continue;
    }

    if (node.type === 'function_declaration') {
      const { name, paramsNode, returnTypeNode } = kotlinFunctionParts(node);
      if (!name) continue;
      const isExported = !hasKotlinModifier(node, 'private');
      signatures.push({
        name,
        kind: 'function',
        params: kotlinParams(paramsNode),
        returnType: returnTypeNode?.text,
        isAsync: false,
        isGenerator: false,
        isExported,
        doc: leadingDoc(node),
      });
      if (isExported)
        exports.push({ name, kind: 'function', isDefault: false });
      continue;
    }

    if (node.type === 'class_declaration') {
      const keyword = node.child(0)?.type ?? 'class';
      const named = children(node);
      const name =
        named.find((c: any) => c.type === 'type_identifier')?.text ?? '';
      if (!name) continue;
      const kind: TypeInfo['kind'] =
        keyword === 'interface'
          ? 'interface'
          : keyword === 'enum'
            ? 'enum'
            : 'class';
      const isExported = !hasKotlinModifier(node, 'private');
      const body = named.find(
        (c: any) => c.type === 'class_body' || c.type === 'enum_class_body'
      );

      const props: string[] = [];
      const primaryCtor = named.find(
        (c: any) => c.type === 'primary_constructor'
      );
      if (primaryCtor) {
        for (const param of children(primaryCtor)) {
          if (param.type !== 'class_parameter') continue;
          const pname = children(param).find(
            (c: any) => c.type === 'simple_identifier'
          )?.text;
          const ptype = children(param).find(
            (c: any) => c.type === 'user_type'
          )?.text;
          if (pname) props.push(ptype ? `${pname}: ${ptype}` : pname);
        }
      }
      if (kind === 'enum' && body) {
        const entries = children(body)
          .filter((c: any) => c.type === 'enum_entry')
          .map((c: any) => children(c)[0]?.text)
          .filter(Boolean);
        types.push({
          name,
          kind,
          definition: entries.join(' | ') || '{}',
          isExported,
          doc: leadingDoc(node),
        });
      } else {
        types.push({
          name,
          kind,
          definition: `{ ${props.join(', ')} }`,
          isExported,
          doc: leadingDoc(node),
        });
      }
      if (isExported)
        exports.push({
          name,
          kind:
            kind === 'interface'
              ? 'interface'
              : kind === 'enum'
                ? 'enum'
                : 'class',
          isDefault: false,
        });

      if (body) walkClassBody(body, name, isExported);
      continue;
    }
  }

  const fileType = detectGenericFileType({
    relPath,
    testPattern: /tests?\.kt$/i,
    testDirRegex: /\/test\//,
  });
  const summary = genericSummary({ fileType, exports, signatures });
  return { exports, imports, signatures, types, summary, fileType };
}

// ---------- Ruby ----------

function rubyParams(paramsNode: any): ParamInfo[] {
  const out: ParamInfo[] = [];
  for (const p of children(paramsNode)) {
    switch (p.type) {
      case 'identifier':
        out.push({ name: p.text });
        break;
      case 'optional_parameter': {
        const name = fieldText(p, 'name') ?? children(p)[0]?.text ?? '';
        const value = fieldText(p, 'value');
        out.push({ name, optional: true, default: value });
        break;
      }
      case 'splat_parameter':
        out.push({ name: `*${children(p)[0]?.text ?? ''}`, rest: true });
        break;
      case 'hash_splat_parameter':
        out.push({ name: `**${children(p)[0]?.text ?? ''}`, rest: true });
        break;
      case 'keyword_parameter': {
        const name = fieldText(p, 'name') ?? children(p)[0]?.text ?? '';
        const value = fieldText(p, 'value');
        out.push({ name, optional: value !== undefined, default: value });
        break;
      }
      case 'block_parameter':
        out.push({ name: `&${children(p)[0]?.text ?? ''}` });
        break;
      default:
        if (p.text) out.push({ name: p.text });
    }
  }
  return out;
}

function analyzeRuby(ctx: Ctx): GenericAnalysisResult {
  const { rootNode, absPath, relPath, projectRoot } = ctx;
  const imports: ImportInfo[] = [];
  const signatures: SignatureInfo[] = [];
  const types: TypeInfo[] = [];
  const exports: ExportInfo[] = [];

  function processMethod(node: any, className?: string) {
    const name = fieldText(node, 'name') ?? '';
    if (!name) return;
    signatures.push({
      name: className ? `${className}.${name}` : name,
      kind: className
        ? name === 'initialize'
          ? 'constructor'
          : 'method'
        : 'function',
      className,
      params: rubyParams(node.childForFieldName?.('parameters')),
      isAsync: false,
      isGenerator: false,
      isExported: true,
      doc: leadingDoc(node),
    });
    if (!className) exports.push({ name, kind: 'function', isDefault: false });
  }

  function walk(nodes: any[]) {
    for (const node of nodes) {
      if (node.type === 'call') {
        const method = fieldText(node, 'method');
        if (method === 'require' || method === 'require_relative') {
          const argList = node.childForFieldName?.('arguments');
          const strNode = children(argList)[0];
          const raw =
            children(strNode).find((c: any) => c.type === 'string_content')
              ?.text ?? '';
          let resolvedPath: string | null = null;
          if (method === 'require_relative' && raw) {
            const candidate = path.join(path.dirname(absPath), `${raw}.rb`);
            if (fs.existsSync(candidate))
              resolvedPath = normalizeProjectRelativePath(
                projectRoot,
                candidate
              );
          }
          imports.push({
            source: raw,
            resolvedPath,
            names: [],
            isTypeOnly: false,
          });
        }
        continue;
      }
      if (node.type === 'method') {
        processMethod(node);
        continue;
      }
      if (node.type === 'class' || node.type === 'module') {
        const name = fieldText(node, 'name') ?? '';
        if (!name) continue;
        const body = node.childForFieldName?.('body');
        types.push({
          name,
          kind: node.type === 'module' ? 'interface' : 'class',
          definition: '{}',
          isExported: true,
          doc: leadingDoc(node),
        });
        exports.push({
          name,
          kind: node.type === 'module' ? 'interface' : 'class',
          isDefault: false,
        });
        for (const member of children(body)) {
          if (member.type === 'method') processMethod(member, name);
        }
        continue;
      }
    }
  }

  walk(children(rootNode));

  const fileType = detectGenericFileType({
    relPath,
    testPattern: /(_spec|_test)\.rb$/,
    testDirRegex: /\/(spec|test)\//,
  });
  const summary = genericSummary({ fileType, exports, signatures });
  return { exports, imports, signatures, types, summary, fileType };
}

// ---------- Swift ----------

function swiftParamsFrom(paramNodes: any[]): ParamInfo[] {
  const out: ParamInfo[] = [];
  for (const p of paramNodes) {
    if (p.type !== 'parameter') continue;
    const named = children(p);
    const name = named[0]?.text ?? '';
    if (!name) continue;
    const typeNode = named
      .slice(1)
      .find((c: any) => c.type === 'user_type' || c.type === 'type_annotation');
    const info: ParamInfo = { name };
    if (typeNode) info.type = typeNode.text.replace(/^:\s*/, '');
    out.push(info);
  }
  return out;
}

function swiftFunctionSignature(returnTypeSkipName: any[]): any {
  return returnTypeSkipName
    .filter(
      (c: any) =>
        c.type !== 'parameter' &&
        c.type !== 'simple_identifier' &&
        !/modifier/i.test(c.type)
    )
    .pop();
}

function isSwiftPrivate(node: any): boolean {
  return children(node).some(
    (c: any) => c.type === 'modifiers' && /private|fileprivate/.test(c.text)
  );
}

function analyzeSwift(ctx: Ctx): GenericAnalysisResult {
  const { rootNode, relPath } = ctx;
  const imports: ImportInfo[] = [];
  const signatures: SignatureInfo[] = [];
  const types: TypeInfo[] = [];
  const exports: ExportInfo[] = [];

  for (const node of children(rootNode)) {
    if (node.type === 'import_declaration') {
      const idNode = children(node)[0];
      const raw = idNode?.text ?? '';
      imports.push({
        source: raw,
        resolvedPath: null,
        names: raw ? [raw.split('.').pop()!] : [],
        isTypeOnly: false,
      });
      continue;
    }

    if (node.type === 'function_declaration') {
      const name = fieldText(node, 'name') ?? '';
      if (!name) continue;
      const named = children(node);
      const bodyIdx = named.findIndex((c: any) => c.type === 'function_body');
      const before = bodyIdx >= 0 ? named.slice(0, bodyIdx) : named;
      const params = before.filter((c: any) => c.type === 'parameter');
      const returnTypeNode = swiftFunctionSignature(before);
      const isExported = !isSwiftPrivate(node);
      signatures.push({
        name,
        kind: 'function',
        params: swiftParamsFrom(params),
        returnType: returnTypeNode?.text,
        isAsync: /\basync\b/.test(node.text.split('{')[0] ?? ''),
        isGenerator: false,
        isExported,
        doc: leadingDoc(node),
      });
      if (isExported)
        exports.push({ name, kind: 'function', isDefault: false });
      continue;
    }

    if (node.type === 'class_declaration') {
      const named = children(node);
      const name =
        named.find((c: any) => c.type === 'type_identifier')?.text ?? '';
      if (!name) continue;
      const keyword = node.child(0)?.type ?? 'class';
      const kind: TypeInfo['kind'] = keyword === 'enum' ? 'enum' : 'class';
      const isExported = !isSwiftPrivate(node);
      const body = node.childForFieldName?.('body');

      const props: string[] = [];
      if (body) {
        for (const member of children(body)) {
          if (member.type === 'property_declaration') {
            const patternNode = children(member).find(
              (c: any) => c.type === 'pattern'
            );
            const pname = children(patternNode)[0]?.text ?? '';
            const typeAnn = children(member).find(
              (c: any) => c.type === 'type_annotation'
            );
            if (pname)
              props.push(
                typeAnn
                  ? `${pname}: ${typeAnn.text.replace(/^:\s*/, '')}`
                  : pname
              );
          } else if (
            member.type === 'function_declaration' ||
            member.type === 'init_declaration'
          ) {
            const mnamed = children(member);
            const mname =
              member.type === 'init_declaration'
                ? 'init'
                : (fieldText(member, 'name') ?? '');
            if (!mname) continue;
            const mBodyIdx = mnamed.findIndex(
              (c: any) => c.type === 'function_body'
            );
            const mBefore = mBodyIdx >= 0 ? mnamed.slice(0, mBodyIdx) : mnamed;
            const mParams = mBefore.filter((c: any) => c.type === 'parameter');
            const mReturn = swiftFunctionSignature(mBefore);
            signatures.push({
              name: `${name}.${mname}`,
              kind:
                member.type === 'init_declaration' ? 'constructor' : 'method',
              className: name,
              params: swiftParamsFrom(mParams),
              returnType:
                member.type === 'init_declaration' ? undefined : mReturn?.text,
              isAsync: false,
              isGenerator: false,
              isExported: isExported && !isSwiftPrivate(member),
              doc: leadingDoc(member),
            });
          } else if (member.type === 'enum_entry') {
            props.push(children(member)[0]?.text ?? '');
          }
        }
      }

      types.push({
        name,
        kind,
        definition:
          kind === 'enum'
            ? props.join(' | ') || '{}'
            : `{ ${props.join(', ')} }`,
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

    if (node.type === 'protocol_declaration') {
      const name = fieldText(node, 'name') ?? '';
      if (!name) continue;
      const isExported = !isSwiftPrivate(node);
      types.push({
        name,
        kind: 'interface',
        definition: '{}',
        isExported,
        doc: leadingDoc(node),
      });
      if (isExported)
        exports.push({ name, kind: 'interface', isDefault: false });
      continue;
    }
  }

  const fileType = detectGenericFileType({
    relPath,
    testPattern: /tests\.swift$/i,
  });
  const summary = genericSummary({ fileType, exports, signatures });
  return { exports, imports, signatures, types, summary, fileType };
}

// ---------- PHP ----------

function phpParams(node: any): ParamInfo[] {
  const out: ParamInfo[] = [];
  for (const p of children(node)) {
    if (p.type !== 'simple_parameter' && p.type !== 'variadic_parameter')
      continue;
    const nameNode = p.childForFieldName?.('name');
    const name = (nameNode?.text ?? '').replace(/^\$/, '');
    if (!name) continue;
    const typeNode = p.childForFieldName?.('type');
    const defaultNode = p.childForFieldName?.('default_value');
    const info: ParamInfo = { name };
    if (typeNode) info.type = typeNode.text;
    if (defaultNode) {
      info.optional = true;
      info.default = defaultNode.text;
    }
    if (p.type === 'variadic_parameter') info.rest = true;
    out.push(info);
  }
  return out;
}

function isPhpPrivateMember(node: any): boolean {
  return children(node).some(
    (c: any) =>
      c.type === 'visibility_modifier' &&
      (c.text === 'private' || c.text === 'protected')
  );
}

function analyzePhp(ctx: Ctx): GenericAnalysisResult {
  const { rootNode, relPath } = ctx;
  const imports: ImportInfo[] = [];
  const signatures: SignatureInfo[] = [];
  const types: TypeInfo[] = [];
  const exports: ExportInfo[] = [];

  for (const node of children(rootNode)) {
    if (node.type === 'namespace_use_declaration') {
      for (const clause of children(node)) {
        if (clause.type !== 'namespace_use_clause') continue;
        const qualified = children(clause).find(
          (c: any) => c.type === 'qualified_name' || c.type === 'name'
        );
        const raw = qualified?.text ?? '';
        const aliasClause = children(clause).find(
          (c: any) => c.type === 'namespace_aliasing_clause'
        );
        const alias = children(aliasClause)[0]?.text;
        const nameSeg = alias ?? raw.split('\\').pop() ?? raw;
        imports.push({
          source: raw,
          resolvedPath: null,
          names: nameSeg ? [nameSeg] : [],
          isTypeOnly: false,
        });
      }
      continue;
    }

    if (node.type === 'function_definition') {
      const name = fieldText(node, 'name') ?? '';
      if (!name) continue;
      signatures.push({
        name,
        kind: 'function',
        params: phpParams(node.childForFieldName?.('parameters')),
        isAsync: false,
        isGenerator: false,
        isExported: true,
        doc: leadingDoc(node),
      });
      exports.push({ name, kind: 'function', isDefault: false });
      continue;
    }

    if (
      [
        'class_declaration',
        'interface_declaration',
        'trait_declaration',
        'enum_declaration',
      ].includes(node.type)
    ) {
      const name = fieldText(node, 'name') ?? '';
      if (!name) continue;
      const body = node.childForFieldName?.('body');
      const kind: TypeInfo['kind'] =
        node.type === 'interface_declaration'
          ? 'interface'
          : node.type === 'enum_declaration'
            ? 'enum'
            : 'class';
      const props: string[] = [];
      for (const member of children(body)) {
        if (member.type === 'method_declaration') {
          const mname = fieldText(member, 'name') ?? '';
          if (!mname) continue;
          const isPriv = isPhpPrivateMember(member);
          signatures.push({
            name: `${name}.${mname}`,
            kind: mname === '__construct' ? 'constructor' : 'method',
            className: name,
            params: phpParams(member.childForFieldName?.('parameters')),
            isAsync: false,
            isGenerator: false,
            isExported: !isPriv,
            doc: leadingDoc(member),
          });
        } else if (member.type === 'property_declaration') {
          for (const el of children(member)) {
            if (el.type !== 'property_element') continue;
            const varNode = children(el)[0];
            const pname = (varNode?.text ?? '').replace(/^\$/, '');
            if (pname) props.push(pname);
          }
        }
      }
      types.push({
        name,
        kind,
        definition: `{ ${props.join(', ')} }`,
        isExported: true,
        doc: leadingDoc(node),
      });
      exports.push({
        name,
        kind:
          kind === 'interface'
            ? 'interface'
            : kind === 'enum'
              ? 'enum'
              : 'class',
        isDefault: false,
      });
      continue;
    }
  }

  const fileType = detectGenericFileType({
    relPath,
    testPattern: /test\.php$/i,
    testDirRegex: /\/tests?\//,
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
    case 'c':
      return analyzeCLike(ctx, { cpp: false });
    case 'cpp':
      return analyzeCLike(ctx, { cpp: true });
    case 'csharp':
      return analyzeCSharp(ctx);
    case 'java':
      return analyzeJava(ctx);
    case 'kotlin':
      return analyzeKotlin(ctx);
    case 'ruby':
      return analyzeRuby(ctx);
    case 'swift':
      return analyzeSwift(ctx);
    case 'php':
      return analyzePhp(ctx);
    default:
      throw new Error(`analyzeGeneric: unsupported language ${language}`);
  }
}
