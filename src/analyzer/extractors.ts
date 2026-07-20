import path from 'node:path';
import type {
  ExportInfo,
  FileAnalysis,
  FileType,
  ImportInfo,
  ParamInfo,
  SignatureInfo,
  TypeInfo,
} from '../types';
import { resolveImportPath } from './moduleResolver';

function topLevelNodes(rootNode: any): any[] {
  return rootNode.namedChildren ?? [];
}

function nodeName(node: any): string {
  return node.childForFieldName?.('name')?.text ?? '';
}

function hasChildType(node: any, type: string): boolean {
  for (const c of node.children ?? []) {
    if (c.type === type) return true;
  }
  return false;
}

function isAsyncNode(node: any): boolean {
  return hasChildType(node, 'async');
}

function isGeneratorNode(node: any): boolean {
  return (
    hasChildType(node, '*') ||
    node.type === 'generator_function_declaration' ||
    node.type === 'generator_function'
  );
}

function findChild(node: any, ...types: string[]): any {
  for (const c of node.namedChildren ?? []) {
    if (types.includes(c.type)) return c;
  }
  return null;
}

function stringNodeText(strNode: any): string {
  return (strNode?.text ?? '').replace(/^['"`]|['"`]$/g, '');
}

function extractJSDoc(node: any): string | undefined {
  let prev: any = node.previousSibling;
  while (prev && prev.type === 'comment') {
    const text: string = prev.text ?? '';
    if (text.startsWith('/**')) {
      return (
        text
          .replace(/^\/\*\*\s*\n?/, '')
          .replace(/\s*\*\/$/, '')
          .replace(/^[ \t]*\*[ \t]?/gm, '')
          .trim() || undefined
      );
    }
    prev = prev.previousSibling;
  }
  return undefined;
}

export function firstDocLine(doc: string | undefined): string | undefined {
  if (!doc) return undefined;
  const line = doc
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line || undefined;
}

function patternText(patternNode: any): string {
  if (!patternNode) return '';
  if (
    patternNode.type === 'object_pattern' ||
    patternNode.type === 'array_pattern'
  ) {
    return patternNode.text.replace(/\s+/g, ' ').trim();
  }
  return patternNode.text ?? '';
}

function cleanTypeText(typeNode: any): string | undefined {
  if (!typeNode) return undefined;
  return typeNode.text.replace(/^:\s*/, '').trim() || undefined;
}

function extractParamInfo(node: any): ParamInfo | null {
  switch (node.type) {
    case 'identifier':
    case 'this':
      return { name: node.text };
    case 'required_parameter':
    case 'optional_parameter': {
      const pattern =
        node.childForFieldName?.('pattern') ?? node.namedChildren?.[0];
      const typeNode = node.childForFieldName?.('type');
      const valueNode = node.childForFieldName?.('value');
      const isRest = pattern?.type === 'rest_pattern';
      const name = isRest
        ? patternText(pattern.namedChildren?.[0])
        : patternText(pattern);
      const info: ParamInfo = { name };
      const type = cleanTypeText(typeNode);
      if (type) info.type = type;
      if (isRest) info.rest = true;
      else if (node.type === 'optional_parameter' || valueNode)
        info.optional = true;
      if (valueNode) info.default = valueNode.text.trim();
      return info;
    }
    case 'rest_parameter': {
      const pattern =
        node.childForFieldName?.('pattern') ??
        node.namedChildren?.find((c: any) => c.type !== 'type_annotation');
      const typeNode = node.childForFieldName?.('type');
      const info: ParamInfo = { name: patternText(pattern), rest: true };
      const type = cleanTypeText(typeNode);
      if (type) info.type = type;
      return info;
    }
    case 'rest_pattern': {
      const arg = node.namedChildren?.[0];
      return { name: patternText(arg), rest: true };
    }
    case 'assignment_pattern': {
      const left = node.childForFieldName?.('left') ?? node.namedChildren?.[0];
      const right =
        node.childForFieldName?.('right') ?? node.namedChildren?.[1];
      return {
        name: patternText(left),
        optional: true,
        default: right?.text?.trim(),
      };
    }
    case 'object_pattern':
    case 'array_pattern':
      return { name: patternText(node) };
    default:
      return node.text?.trim() ? { name: node.text.trim() } : null;
  }
}

function parseFormalParameters(formalParams: any): ParamInfo[] {
  if (!formalParams) return [];
  const out: ParamInfo[] = [];
  for (const child of formalParams.namedChildren ?? []) {
    const info = extractParamInfo(child);
    if (info && info.name) out.push(info);
  }
  return out;
}

function findFormalParams(node: any): any {
  return (
    node.childForFieldName?.('parameters') ??
    findChild(node, 'formal_parameters')
  );
}

function extractReturnType(node: any): string | undefined {
  const rt = node.childForFieldName?.('return_type');
  return cleanTypeText(rt);
}

export function parseExportsFromSource(rootNode: any): ExportInfo[] {
  const nodes = topLevelNodes(rootNode);
  const exports: ExportInfo[] = [];
  const seen = new Set<string>();

  function add(
    name: string,
    kind: ExportInfo['kind'],
    isDefault: boolean,
    reexport?: ExportInfo['reexport']
  ) {
    if (!name) return;
    const key = `${name}:${kind}:${isDefault}`;
    if (seen.has(key)) return;
    seen.add(key);
    exports.push({ name, kind, isDefault, ...(reexport ? { reexport } : {}) });
  }

  function processDecl(child: any, isDefault: boolean) {
    switch (child.type) {
      case 'function_declaration':
      case 'generator_function_declaration':
        add(nodeName(child) || 'default', 'function', isDefault);
        break;
      case 'class_declaration':
        add(nodeName(child) || 'default', 'class', isDefault);
        break;
      case 'lexical_declaration':
      case 'variable_declaration':
        for (const decl of child.namedChildren ?? []) {
          if (decl.type === 'variable_declarator')
            add(nodeName(decl), 'const', false);
        }
        break;
      case 'interface_declaration':
        add(nodeName(child), 'interface', false);
        break;
      case 'type_alias_declaration':
        add(nodeName(child), 'type', false);
        break;
      case 'enum_declaration':
        add(nodeName(child), 'enum', false);
        break;
      case 'export_clause':
        for (const spec of child.namedChildren ?? []) {
          if (spec.type === 'export_specifier') {
            const alias = spec.childForFieldName?.('alias')?.text;
            const name = spec.childForFieldName?.('name')?.text ?? '';
            add(alias ?? name, 'default', false);
          }
        }
        break;
      case 'arrow_function':
      case 'function_expression':
        if (isDefault) add('default', 'function', true);
        break;
      case 'identifier':
        if (isDefault) add(child.text, 'default', true);
        break;
      case 'call_expression':
        if (isDefault) {
          const callee =
            child.childForFieldName?.('function') ?? child.namedChildren?.[0];
          const calleeName =
            callee?.type === 'identifier'
              ? callee.text
              : callee?.type === 'member_expression'
                ? (callee.text.split('.').pop() ?? 'default')
                : 'default';
          add(calleeName, 'default', true);
        }
        break;
      case 'object_expression':
      case 'object':
      case 'array_expression':
      case 'array':
      case 'new_expression':
        if (isDefault) add('default', 'default', true);
        break;
    }
  }

  for (const node of nodes) {
    if (node.type !== 'export_statement') continue;
    const text: string = node.text;
    const isDefault = /^export\s+default\b/.test(text);
    const sourceNode = findChild(node, 'string');
    const hasSource = Boolean(sourceNode) && /\bfrom\s*['"]/.test(text);
    const isStarExport = /^export\s*\*/.test(text);

    if (hasSource && sourceNode) {
      const from = stringNodeText(sourceNode);
      if (isStarExport) {
        const nsNode =
          findChild(node, 'namespace_export') ??
          node.namedChildren?.find(
            (c: any) => c.type === 'identifier' && /\bas\s+/.test(node.text)
          );
        const alias =
          node.childForFieldName?.('alias')?.text ??
          nsNode?.namedChildren?.[0]?.text ??
          nsNode?.text;
        add(alias ?? '*', 'reexport', false, { from, star: !alias });
        continue;
      }
      const clause = findChild(node, 'export_clause');
      if (clause) {
        for (const spec of clause.namedChildren ?? []) {
          if (spec.type === 'export_specifier') {
            const alias = spec.childForFieldName?.('alias')?.text;
            const name = spec.childForFieldName?.('name')?.text ?? '';
            add(alias ?? name, 'reexport', false, { from });
          }
        }
      }
      continue;
    }

    for (const child of node.namedChildren ?? []) {
      processDecl(child, isDefault);
    }
  }

  exports.push(
    ...collectCjsExports(rootNode).filter((e) => {
      const key = `${e.name}:${e.kind}:${e.isDefault}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
  );

  return exports;
}

function isRequireCall(node: any): string | null {
  if (!node || node.type !== 'call_expression') return null;
  const callee = node.childForFieldName?.('function');
  if (!callee || callee.type !== 'identifier' || callee.text !== 'require')
    return null;
  const args = node.childForFieldName?.('arguments');
  const strNode = args?.namedChildren?.[0];
  if (!strNode || strNode.type !== 'string') return null;
  return stringNodeText(strNode);
}

function topLevelDeclKind(
  rootNode: any,
  name: string
): ExportInfo['kind'] | undefined {
  for (const node of topLevelNodes(rootNode)) {
    switch (node.type) {
      case 'function_declaration':
      case 'generator_function_declaration':
        if (nodeName(node) === name) return 'function';
        break;
      case 'class_declaration':
        if (nodeName(node) === name) return 'class';
        break;
      case 'lexical_declaration':
      case 'variable_declaration':
        for (const decl of node.namedChildren ?? []) {
          if (decl.type !== 'variable_declarator' || nodeName(decl) !== name)
            continue;
          const value = decl.childForFieldName?.('value');
          if (
            value?.type === 'arrow_function' ||
            value?.type === 'function_expression'
          )
            return 'function';
          if (value?.type === 'class') return 'class';
          return 'const';
        }
        break;
    }
  }
  return undefined;
}

function kindOfValueNode(node: any, rootNode?: any): ExportInfo['kind'] {
  if (!node) return 'const';
  switch (node.type) {
    case 'function_expression':
    case 'function':
    case 'arrow_function':
    case 'generator_function':
      return 'function';
    case 'class':
      return 'class';
    case 'identifier':
      return (rootNode && topLevelDeclKind(rootNode, node.text)) ?? 'const';
    default:
      return 'const';
  }
}

function nameHintFromValue(node: any): string | undefined {
  if (!node) return undefined;
  if (['function_expression', 'function', 'class'].includes(node.type)) {
    const n = node.childForFieldName?.('name')?.text;
    if (n) return n;
  }
  if (node.type === 'identifier') return node.text;
  return undefined;
}

function isModuleExportsMember(node: any): boolean {
  return (
    node?.type === 'member_expression' &&
    node.childForFieldName?.('object')?.text === 'module' &&
    node.childForFieldName?.('property')?.text === 'exports'
  );
}

export function collectCjsExports(rootNode: any): ExportInfo[] {
  const out: ExportInfo[] = [];
  for (const node of topLevelNodes(rootNode)) {
    if (node.type !== 'expression_statement') continue;
    const expr = node.namedChildren?.[0];
    if (!expr || expr.type !== 'assignment_expression') continue;
    const left = expr.childForFieldName?.('left');
    const right = expr.childForFieldName?.('right');
    if (!left) continue;

    if (left.type === 'member_expression') {
      const obj = left.childForFieldName?.('object');
      const prop = left.childForFieldName?.('property');
      const propName = prop?.text ?? '';

      const objIsExportsIdent =
        obj?.type === 'identifier' && obj.text === 'exports';
      if ((isModuleExportsMember(obj) || objIsExportsIdent) && propName) {
        out.push({
          name: propName,
          kind: kindOfValueNode(right, rootNode),
          isDefault: false,
        });
        continue;
      }

      if (isModuleExportsMember(left)) {
        if (right?.type === 'object') {
          for (const prop2 of right.namedChildren ?? []) {
            if (prop2.type === 'pair') {
              const keyNode = prop2.childForFieldName?.('key');
              const valNode = prop2.childForFieldName?.('value');
              const name = (keyNode?.text ?? '').replace(/^['"]|['"]$/g, '');
              if (name)
                out.push({
                  name,
                  kind: kindOfValueNode(valNode, rootNode),
                  isDefault: false,
                });
            } else if (
              prop2.type === 'shorthand_property_identifier' ||
              prop2.type === 'shorthand_property_identifier_pattern'
            ) {
              out.push({
                name: prop2.text,
                kind: topLevelDeclKind(rootNode, prop2.text) ?? 'const',
                isDefault: false,
              });
            }
          }
        } else {
          out.push({
            name: nameHintFromValue(right) ?? 'default',
            kind: kindOfValueNode(right, rootNode),
            isDefault: true,
          });
        }
      }
    }
  }
  return out;
}

function collectCjsSignatures(rootNode: any): SignatureInfo[] {
  const out: SignatureInfo[] = [];

  function addFromFunctionNode(name: string, fnNode: any, anchor: any) {
    if (
      ![
        'function_expression',
        'function',
        'arrow_function',
        'generator_function',
      ].includes(fnNode?.type)
    )
      return;
    const params = parseFormalParameters(findFormalParams(fnNode));
    out.push({
      name,
      kind: fnNode.type === 'arrow_function' ? 'arrow' : 'function',
      params,
      returnType: extractReturnType(fnNode),
      isAsync: isAsyncNode(fnNode),
      isGenerator: isGeneratorNode(fnNode),
      isExported: true,
      doc: firstDocLine(extractJSDoc(anchor)),
    });
  }

  for (const node of topLevelNodes(rootNode)) {
    if (node.type !== 'expression_statement') continue;
    const expr = node.namedChildren?.[0];
    if (!expr || expr.type !== 'assignment_expression') continue;
    const left = expr.childForFieldName?.('left');
    const right = expr.childForFieldName?.('right');
    if (!left || left.type !== 'member_expression') continue;

    const obj = left.childForFieldName?.('object');
    const prop = left.childForFieldName?.('property');
    const propName = prop?.text ?? '';
    const objIsExportsIdent =
      obj?.type === 'identifier' && obj.text === 'exports';

    if ((isModuleExportsMember(obj) || objIsExportsIdent) && propName) {
      addFromFunctionNode(propName, right, node);
      continue;
    }
    if (isModuleExportsMember(left)) {
      if (right?.type === 'object') {
        for (const prop2 of right.namedChildren ?? []) {
          if (prop2.type === 'pair') {
            const keyNode = prop2.childForFieldName?.('key');
            const valNode = prop2.childForFieldName?.('value');
            const name = (keyNode?.text ?? '').replace(/^['"]|['"]$/g, '');
            if (name) addFromFunctionNode(name, valNode, node);
          }
        }
      } else {
        addFromFunctionNode(nameHintFromValue(right) ?? 'default', right, node);
      }
    }
  }

  return out;
}

export function parseImportsFromSource(params: {
  rootNode: any;
  absPath: string;
  relPath: string;
  projectRoot: string;
}): ImportInfo[] {
  const { rootNode, absPath, projectRoot } = params;
  const nodes = topLevelNodes(rootNode);
  const imports: ImportInfo[] = [];

  function resolve(source: string): string | null {
    return resolveImportPath({ projectRoot, absPath, importSource: source });
  }

  for (const node of nodes) {
    if (node.type === 'import_statement') {
      const text: string = node.text;
      const isTypeOnly = /^import\s+type\b/.test(text);
      const sourceNode = findChild(node, 'string');
      if (!sourceNode) continue;
      const source = stringNodeText(sourceNode);
      const names: string[] = [];

      const clauseNode =
        node.childForFieldName?.('import_clause') ??
        findChild(node, 'import_clause');
      if (clauseNode) {
        for (const part of clauseNode.namedChildren ?? []) {
          switch (part.type) {
            case 'identifier':
              names.push(part.text);
              break;
            case 'namespace_import': {
              const id = findChild(part, 'identifier');
              if (id) names.push(id.text);
              break;
            }
            case 'named_imports':
              for (const spec of part.namedChildren ?? []) {
                if (spec.type === 'import_specifier') {
                  const alias = spec.childForFieldName?.('alias')?.text;
                  const name = spec.childForFieldName?.('name')?.text ?? '';
                  const resolved = (alias ?? name).replace(/^type\s+/, '');
                  if (resolved) names.push(resolved);
                }
              }
              break;
          }
        }
      }

      imports.push({
        source,
        resolvedPath: resolve(source),
        names,
        isTypeOnly,
      });
    }

    if (node.type === 'export_statement') {
      const sourceNode = findChild(node, 'string');
      if (!sourceNode) continue;
      const source = stringNodeText(sourceNode);
      const clause = findChild(node, 'export_clause');
      const names: string[] = [];
      if (clause) {
        for (const spec of clause.namedChildren ?? []) {
          if (spec.type === 'export_specifier') {
            const name = spec.childForFieldName?.('name')?.text ?? '';
            if (name) names.push(name);
          }
        }
      }
      imports.push({
        source,
        resolvedPath: resolve(source),
        names,
        isTypeOnly: false,
      });
    }
  }

  imports.push(...collectCjsImports(rootNode, resolve));

  return imports;
}

function collectCjsImports(
  rootNode: any,
  resolve: (source: string) => string | null
): ImportInfo[] {
  const out: ImportInfo[] = [];

  for (const node of topLevelNodes(rootNode)) {
    if (
      node.type === 'lexical_declaration' ||
      node.type === 'variable_declaration'
    ) {
      for (const decl of node.namedChildren ?? []) {
        if (decl.type !== 'variable_declarator') continue;
        const value = decl.childForFieldName?.('value');
        const source = isRequireCall(value);
        if (!source) continue;
        const nameNode = decl.childForFieldName?.('name');
        const names: string[] = [];
        if (nameNode?.type === 'identifier') {
          names.push(nameNode.text);
        } else if (nameNode?.type === 'object_pattern') {
          for (const p of nameNode.namedChildren ?? []) {
            if (
              p.type === 'shorthand_property_identifier_pattern' ||
              p.type === 'shorthand_property_identifier'
            ) {
              names.push(p.text);
            } else if (p.type === 'pair_pattern') {
              const valueNode = p.childForFieldName?.('value');
              if (valueNode) names.push(valueNode.text);
            }
          }
        }
        out.push({
          source,
          resolvedPath: resolve(source),
          names,
          isTypeOnly: false,
        });
      }
    } else if (node.type === 'expression_statement') {
      const expr = node.namedChildren?.[0];
      const source = isRequireCall(expr);
      if (source)
        out.push({
          source,
          resolvedPath: resolve(source),
          names: [],
          isTypeOnly: false,
        });
    }
  }

  return out;
}

export function parseSignaturesFromSource(rootNode: any): SignatureInfo[] {
  const nodes = topLevelNodes(rootNode);
  const sigs: SignatureInfo[] = [];

  function processFn(
    node: any,
    isExported: boolean,
    jsdocAnchor?: any,
    nameOverride?: string
  ) {
    const name = nodeName(node) || nameOverride;
    if (!name) return;
    sigs.push({
      name,
      kind: 'function',
      params: parseFormalParameters(findFormalParams(node)),
      returnType: extractReturnType(node),
      isAsync: isAsyncNode(node),
      isGenerator: isGeneratorNode(node),
      isExported,
      doc: firstDocLine(extractJSDoc(jsdocAnchor ?? node)),
    });
  }

  function processArrow(
    name: string,
    fnNode: any,
    isExported: boolean,
    jsdocAnchor?: any
  ) {
    sigs.push({
      name,
      kind: 'arrow',
      params: parseFormalParameters(findFormalParams(fnNode)),
      returnType: extractReturnType(fnNode),
      isAsync: isAsyncNode(fnNode),
      isGenerator: isGeneratorNode(fnNode),
      isExported,
      doc: firstDocLine(extractJSDoc(jsdocAnchor ?? fnNode)),
    });
  }

  function processClass(
    classNode: any,
    isExported: boolean,
    nameOverride?: string
  ) {
    const className = nodeName(classNode) || nameOverride || 'default';
    const classBody =
      classNode.childForFieldName?.('body') ??
      findChild(classNode, 'class_body');
    if (!classBody) return;

    for (const member of classBody.namedChildren ?? []) {
      if (member.type !== 'method_definition') continue;
      const methodName = member.childForFieldName?.('name')?.text ?? '';
      if (!methodName) continue;

      const isPrivate =
        methodName.startsWith('#') ||
        member.namedChildren?.some(
          (c: any) =>
            c.type === 'accessibility_modifier' && c.text === 'private'
        );
      if (isPrivate) continue;

      let kind: SignatureInfo['kind'] = 'method';
      if (methodName === 'constructor') kind = 'constructor';
      else if (hasChildType(member, 'get')) kind = 'getter';
      else if (hasChildType(member, 'set')) kind = 'setter';

      sigs.push({
        name: `${className}.${methodName}`,
        kind,
        className,
        params: parseFormalParameters(findFormalParams(member)),
        returnType:
          kind === 'constructor' ? undefined : extractReturnType(member),
        isAsync: isAsyncNode(member),
        isGenerator: isGeneratorNode(member),
        isExported,
        doc: firstDocLine(extractJSDoc(member)),
      });
    }
  }

  function processLexical(declNode: any, isExported: boolean, anchor?: any) {
    for (const decl of declNode.namedChildren ?? []) {
      if (decl.type !== 'variable_declarator') continue;
      const name = nodeName(decl);
      if (!name) continue;
      const value = decl.childForFieldName?.('value');
      if (
        value?.type === 'arrow_function' ||
        value?.type === 'function_expression'
      ) {
        processArrow(name, value, isExported, anchor);
      }
    }
  }

  for (const node of nodes) {
    if (node.type === 'export_statement') {
      const isDefault = /^export\s+default\b/.test(node.text);
      for (const child of node.namedChildren ?? []) {
        switch (child.type) {
          case 'function_declaration':
          case 'generator_function_declaration':
            processFn(child, true, node, isDefault ? 'default' : undefined);
            break;
          case 'class_declaration':
            processClass(child, true, isDefault ? 'default' : undefined);
            break;
          case 'lexical_declaration':
          case 'variable_declaration':
            processLexical(child, true, node);
            break;
          case 'arrow_function':
          case 'function_expression':
            if (isDefault) processArrow('default', child, true, node);
            break;
        }
      }
    } else {
      switch (node.type) {
        case 'function_declaration':
        case 'generator_function_declaration':
          processFn(node, false);
          break;
        case 'class_declaration':
          processClass(node, false);
          break;
        case 'lexical_declaration':
        case 'variable_declaration':
          processLexical(node, false);
          break;
      }
    }
  }

  sigs.push(...collectCjsSignatures(rootNode));

  return sigs;
}

export function parseTypesFromSource(rootNode: any): TypeInfo[] {
  const nodes = topLevelNodes(rootNode);
  const types: TypeInfo[] = [];

  function processTypeNode(node: any, isExported: boolean, anchor?: any) {
    switch (node.type) {
      case 'interface_declaration': {
        const name = nodeName(node);
        if (!name) return;
        const body =
          node.childForFieldName?.('body') ?? findChild(node, 'object_type');
        const props: string[] = [];
        if (body) {
          for (const member of body.namedChildren ?? []) {
            if (
              member.type === 'property_signature' ||
              member.type === 'method_signature'
            ) {
              const propName = member.childForFieldName?.('name')?.text ?? '';
              const typeNode =
                member.childForFieldName?.('type') ??
                findChild(member, 'type_annotation');
              const typeStr = typeNode?.text?.replace(/^:\s*/, '') ?? 'unknown';
              const optional = member.text.includes(`${propName}?`) ? '?' : '';
              if (propName) props.push(`${propName}${optional}: ${typeStr}`);
            }
          }
        }
        types.push({
          name,
          kind: 'interface',
          definition: `{ ${props.join(', ')} }`,
          isExported,
          doc: firstDocLine(extractJSDoc(anchor ?? node)),
        });
        break;
      }
      case 'type_alias_declaration': {
        const name = nodeName(node);
        if (!name) return;
        const valueNode =
          node.childForFieldName?.('value') ??
          node.namedChildren?.find(
            (c: any) =>
              !['type', 'identifier', 'type_parameters'].includes(c.type)
          );
        const def = valueNode?.text?.replace(/\s+/g, ' ').trim() ?? 'unknown';
        types.push({
          name,
          kind: 'type',
          definition: def,
          isExported,
          doc: firstDocLine(extractJSDoc(anchor ?? node)),
        });
        break;
      }
      case 'enum_declaration': {
        const name = nodeName(node);
        if (!name) return;
        const body =
          node.childForFieldName?.('body') ?? findChild(node, 'enum_body');
        const members: string[] = [];
        if (body) {
          for (const member of body.namedChildren ?? []) {
            if (member.type === 'enum_assignment') {
              const memberName = member.childForFieldName?.('name')?.text ?? '';
              const memberVal = member.childForFieldName?.('value')?.text;
              if (memberName)
                members.push(
                  memberVal ? `${memberName} = ${memberVal}` : memberName
                );
            } else if (
              member.type === 'property_identifier' ||
              member.type === 'identifier'
            ) {
              members.push(member.text);
            }
          }
        }
        types.push({
          name,
          kind: 'enum',
          definition: members.join(' | ') || '{}',
          isExported,
          doc: firstDocLine(extractJSDoc(anchor ?? node)),
        });
        break;
      }
    }
  }

  for (const node of nodes) {
    if (node.type === 'export_statement') {
      for (const child of node.namedChildren ?? [])
        processTypeNode(child, true, node);
    } else {
      processTypeNode(node, false);
    }
  }

  return types;
}

export function detectFileType(params: {
  absPath: string;
  relPath: string;
  sourceText: string;
  exports: ExportInfo[];
}): FileType {
  const { relPath, sourceText, exports } = params;
  const lower = relPath.toLowerCase();
  const ext = path.extname(params.absPath).toLowerCase();

  if (/\.(test|spec)\.[tj]sx?$/.test(lower) || lower.includes('/__tests__/'))
    return 'test';
  if (
    lower.includes('/pages/') ||
    lower.includes('/routes/') ||
    /\/app\/.*\/route\.[tj]sx?$/.test(lower) ||
    /route\.[tj]sx?$/.test(lower)
  )
    return 'route';
  if (lower.includes('/models/') || /\/model(s)?\//.test(lower)) return 'model';
  if (
    lower.includes('/types/') ||
    lower.includes('/interfaces/') ||
    lower.endsWith('.d.ts')
  )
    return 'types';
  if (
    lower.includes('/config/') ||
    /(\.config\.|config\.)[tj]sx?$/.test(lower) ||
    lower.endsWith('config.ts')
  )
    return 'config';

  const hasJSX =
    /return\s*\(\s*</.test(sourceText) ||
    /<([A-Z][A-Za-z0-9_]*)\s*[>{]/.test(sourceText) ||
    /React\./.test(sourceText);

  const exportedUseHook = exports.some(
    (e) => !e.isDefault && e.kind === 'function' && e.name.startsWith('use')
  );
  const hasHookExport =
    exportedUseHook || /\bexport\s+function\s+use[A-Z0-9_]*\b/.test(sourceText);
  if (hasHookExport) return 'hook';

  if (
    ext === '.tsx' &&
    hasJSX &&
    exports.some(
      (e) => (e.kind === 'function' || e.kind === 'class') && !e.isDefault
    )
  )
    return 'component';

  return 'module';
}

export function parseSummaryTemplate(analysis: FileAnalysis): string {
  const exportedNames = analysis.exports.map((e) => e.name).filter(Boolean);
  const firstExport = analysis.exports[0]?.name;

  const primarySig =
    analysis.signatures.find(
      (s) => s.isExported && s.name === firstExport && s.doc
    ) ?? analysis.signatures.find((s) => s.isExported && s.doc);
  const primaryType = analysis.types.find((t) => t.isExported && t.doc);
  const doc = primarySig?.doc ?? primaryType?.doc;
  if (doc) return doc;

  const importHookNames = analysis.imports
    .flatMap((i) => i.names)
    .filter((n) => n.startsWith('use'));
  const hooks = Array.from(new Set(importHookNames));

  function arityHint(sig?: SignatureInfo): string {
    if (!sig) return '';
    const n = sig.params.length;
    return n ? ` (${n} arg${n === 1 ? '' : 's'})` : ' (no args)';
  }

  switch (analysis.type) {
    case 'component': {
      const comp = exportedNames.join(', ');
      return `React component ${comp}.${hooks.length ? ` Uses hooks: ${hooks.join(', ')}.` : ''}`;
    }
    case 'hook': {
      const sig =
        analysis.signatures.find(
          (s) => s.isExported && s.name.startsWith('use')
        ) ??
        analysis.signatures.find((s) => s.isExported) ??
        analysis.signatures[0];
      const hookName = sig?.name ?? firstExport ?? '';
      const rt = sig?.returnType ? ` returning ${sig.returnType}` : '';
      return `Custom hook ${hookName}${rt}.`;
    }
    case 'route': {
      const methods = analysis.exports
        .map((e) => e.name)
        .filter((n) =>
          ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(n.toUpperCase())
        );
      return `API route handler${methods.length ? ` (${methods.join(', ')})` : ''}.`;
    }
    case 'module': {
      const mainSig = analysis.signatures.find((s) => s.isExported);
      return `Module exporting ${exportedNames.join(', ') || 'nothing'}${arityHint(mainSig)}.`;
    }
    case 'model':
      return `Database model exports ${exportedNames.join(', ')}.`;
    case 'types':
      return `Type definitions: ${exportedNames.join(', ')}.`;
    case 'config':
      return `Configuration module exporting ${exportedNames.join(', ')}.`;
    case 'test':
      return `Test file exporting ${exportedNames.join(', ') || 'nothing'}.`;
    default:
      return `${analysis.type} file.`;
  }
}
