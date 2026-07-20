import fs from 'node:fs';
import path from 'node:path';
import type {
  ExportInfo,
  FileType,
  ImportInfo,
  ParamInfo,
  SignatureInfo,
  TypeInfo,
} from '../types';
import { normalizeProjectRelativePath } from '../utils/files';
import { firstDocLine } from './extractors';

export interface PythonAnalysisResult {
  exports: ExportInfo[];
  imports: ImportInfo[];
  signatures: SignatureInfo[];
  types: TypeInfo[];
  summary: string;
  fileType: FileType;
}

function moduleChildren(rootNode: any): any[] {
  return rootNode.namedChildren ?? [];
}

function stringNodeContent(stringNode: any): string {
  if (!stringNode) return '';
  const content = stringNode.namedChildren?.find(
    (c: any) => c.type === 'string_content'
  );
  if (content) return content.text;
  return (stringNode.text ?? '')
    .replace(/^([rRbBuUfF]*)("""|'''|"|')/, '')
    .replace(/("""|'''|"|')$/, '');
}

function leadingDocstring(bodyOrModule: any): string | undefined {
  const first = bodyOrModule?.namedChildren?.[0];
  if (!first || first.type !== 'expression_statement') return undefined;
  const inner = first.namedChildren?.[0];
  if (!inner || inner.type !== 'string') return undefined;
  return stringNodeContent(inner).trim() || undefined;
}

function unwrapDecorated(node: any): { inner: any; decorators: string[] } {
  if (node.type !== 'decorated_definition')
    return { inner: node, decorators: [] };
  const decorators: string[] = [];
  for (const c of node.namedChildren ?? []) {
    if (c.type === 'decorator') decorators.push(decoratorName(c));
  }
  const inner =
    node.childForFieldName?.('definition') ??
    node.namedChildren?.find(
      (c: any) =>
        c.type === 'function_definition' || c.type === 'class_definition'
    );
  return { inner, decorators };
}

function decoratorName(decNode: any): string {
  const inner = decNode.namedChildren?.[0];
  if (!inner) return decNode.text.replace(/^@/, '').trim();
  if (inner.type === 'call') {
    const fn =
      inner.childForFieldName?.('function') ?? inner.namedChildren?.[0];
    return fn?.text ?? inner.text;
  }
  return inner.text;
}

function cleanPyType(typeFieldNode: any): string | undefined {
  if (!typeFieldNode) return undefined;
  let text: string = typeFieldNode.text?.trim() ?? '';
  if (!text) return undefined;
  if (/^["'].*["']$/.test(text)) text = text.slice(1, -1);
  return text;
}

function pyParam(node: any): ParamInfo | null {
  switch (node.type) {
    case 'identifier':
      return { name: node.text };
    case 'typed_parameter': {
      // `*args: T` / `**kwargs: T` parse as typed_parameter wrapping a
      // list_splat_pattern/dictionary_splat_pattern, not a bare identifier.
      const splat = node.namedChildren?.find(
        (c: any) =>
          c.type === 'list_splat_pattern' ||
          c.type === 'dictionary_splat_pattern'
      );
      const type = cleanPyType(node.childForFieldName?.('type'));
      if (splat) {
        const inner = splat.namedChildren?.[0]?.text ?? '';
        const prefix = splat.type === 'list_splat_pattern' ? '*' : '**';
        const info: ParamInfo = { name: `${prefix}${inner}`, rest: true };
        if (type) info.type = type;
        return info;
      }
      const name =
        node.namedChildren?.find((c: any) => c.type === 'identifier')?.text ??
        '';
      const info: ParamInfo = { name };
      if (type) info.type = type;
      return info;
    }
    case 'default_parameter': {
      const name =
        node.childForFieldName?.('name')?.text ??
        node.namedChildren?.[0]?.text ??
        '';
      const def = node.childForFieldName?.('value')?.text;
      return { name, optional: true, default: def };
    }
    case 'typed_default_parameter': {
      const name = node.childForFieldName?.('name')?.text ?? '';
      const type = cleanPyType(node.childForFieldName?.('type'));
      const def = node.childForFieldName?.('value')?.text;
      const info: ParamInfo = { name, optional: true, default: def };
      if (type) info.type = type;
      return info;
    }
    case 'list_splat_pattern': {
      const name = node.namedChildren?.[0]?.text ?? 'args';
      return { name: `*${name}`, rest: true };
    }
    case 'dictionary_splat_pattern': {
      const name = node.namedChildren?.[0]?.text ?? 'kwargs';
      return { name: `**${name}`, rest: true };
    }
    case 'positional_separator':
      return { name: '/' };
    case 'keyword_separator':
      return { name: '*' };
    default:
      return node.text ? { name: node.text.trim() } : null;
  }
}

function parsePyParams(paramsNode: any, dropFirst?: boolean): ParamInfo[] {
  if (!paramsNode) return [];
  const raw = (paramsNode.namedChildren ?? [])
    .map(pyParam)
    .filter((p: ParamInfo | null): p is ParamInfo => Boolean(p && p.name));
  if (
    dropFirst &&
    raw.length &&
    (raw[0].name === 'self' || raw[0].name === 'cls')
  ) {
    return raw.slice(1);
  }
  return raw;
}

function functionSignature(
  fnNode: any,
  isExported: boolean,
  className?: string,
  kindOverride?: SignatureInfo['kind'],
  dropFirstParam?: boolean
): SignatureInfo {
  const name = fnNode.childForFieldName?.('name')?.text ?? '';
  const isAsync = (fnNode.children ?? []).some((c: any) => c.type === 'async');
  const paramsNode = fnNode.childForFieldName?.('parameters');
  const returnType = cleanPyType(fnNode.childForFieldName?.('return_type'));
  const body = fnNode.childForFieldName?.('body');
  const doc = firstDocLine(leadingDocstring(body));

  return {
    name: className ? `${className}.${name}` : name,
    kind: kindOverride ?? (className ? 'method' : 'function'),
    className,
    params: parsePyParams(paramsNode, dropFirstParam),
    returnType,
    isAsync,
    isGenerator: false,
    isExported,
    doc,
  };
}

function basesText(classNode: any): string {
  const superclasses = classNode.childForFieldName?.('superclasses');
  if (!superclasses) return '';
  return (superclasses.namedChildren ?? []).map((c: any) => c.text).join(', ');
}

const TYPE_LIKE_BASES = [
  'NamedTuple',
  'TypedDict',
  'Enum',
  'IntEnum',
  'StrEnum',
  'Flag',
  'IntFlag',
];

function classTypeInfo(
  classNode: any,
  isExported: boolean,
  doc?: string,
  decorators: string[] = []
): TypeInfo {
  const name = classNode.childForFieldName?.('name')?.text ?? '';
  const bases = basesText(classNode);
  const body = classNode.childForFieldName?.('body');
  const isTypeLike =
    TYPE_LIKE_BASES.some((b) => bases.includes(b)) ||
    decorators.includes('dataclass');

  const fields: string[] = [];
  if (isTypeLike && body) {
    for (const member of body.namedChildren ?? []) {
      if (member.type === 'expression_statement') {
        const assign = member.namedChildren?.[0];
        if (assign?.type === 'assignment') {
          const left = assign.childForFieldName?.('left');
          const typeNode = assign.childForFieldName?.('type');
          const valueNode =
            assign.childForFieldName?.('right') ??
            assign.childForFieldName?.('value');
          if (left?.type === 'identifier') {
            const t = cleanPyType(typeNode);
            const v = valueNode?.text;
            fields.push(
              t ? `${left.text}: ${t}` : v ? `${left.text} = ${v}` : left.text
            );
          }
        }
      }
    }
  }

  return {
    name,
    kind: isTypeLike && bases.includes('Enum') ? 'enum' : 'class',
    definition: fields.length
      ? `{ ${fields.join(', ')} }`
      : bases
        ? `(${bases})`
        : '()',
    isExported,
    doc,
  };
}

function resolvePythonModule(
  projectRoot: string,
  baseAbs: string
): string | null {
  const candidates = [`${baseAbs}.py`, path.join(baseAbs, '__init__.py')];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function resolveFromImport(params: {
  projectRoot: string;
  absPath: string;
  module: string; // dotted path text, may be ''
  level: number; // 0 = absolute
  importedName: string;
}): string | null {
  const { projectRoot, absPath, module, level, importedName } = params;
  let packageDirAbs: string;

  if (level === 0) {
    if (!module) return null;
    packageDirAbs = path.join(projectRoot, ...module.split('.'));
  } else {
    let dir = path.dirname(absPath);
    for (let i = 1; i < level; i++) dir = path.dirname(dir);
    packageDirAbs = module ? path.join(dir, ...module.split('.')) : dir;
  }

  // Prefer resolving `importedName` as a submodule/subpackage.
  const asSubmodule = resolvePythonModule(
    projectRoot,
    path.join(packageDirAbs, importedName)
  );
  if (asSubmodule)
    return normalizeProjectRelativePath(projectRoot, asSubmodule);

  // Fall back: `importedName` is an attribute defined inside the target module/package.
  const asModuleItself = resolvePythonModule(projectRoot, packageDirAbs);
  if (asModuleItself)
    return normalizeProjectRelativePath(projectRoot, asModuleItself);

  return null;
}

function resolveAbsoluteImport(
  projectRoot: string,
  module: string
): string | null {
  if (!module) return null;
  const baseAbs = path.join(projectRoot, ...module.split('.'));
  const found = resolvePythonModule(projectRoot, baseAbs);
  return found ? normalizeProjectRelativePath(projectRoot, found) : null;
}

export function analyzePython(params: {
  rootNode: any;
  absPath: string;
  relPath: string;
  projectRoot: string;
  sourceText: string;
}): PythonAnalysisResult {
  const { rootNode, absPath, projectRoot, relPath } = params;
  const nodes = moduleChildren(rootNode);

  const imports: ImportInfo[] = [];
  const signatures: SignatureInfo[] = [];
  const types: TypeInfo[] = [];
  const topLevelSymbols = new Map<string, ExportInfo['kind']>();
  let explicitAll: string[] | null = null;

  const moduleDoc = firstDocLine(leadingDocstring(rootNode));

  for (const node of nodes) {
    if (node.type === 'import_statement') {
      for (const child of node.namedChildren ?? []) {
        if (child.type === 'dotted_name') {
          const mod = child.text;
          const binding = mod.split('.')[0];
          imports.push({
            source: mod,
            resolvedPath: resolveAbsoluteImport(projectRoot, mod),
            names: [binding],
            isTypeOnly: false,
          });
        } else if (child.type === 'aliased_import') {
          const modNode = child.childForFieldName?.('name');
          const aliasNode = child.childForFieldName?.('alias');
          const mod = modNode?.text ?? '';
          imports.push({
            source: mod,
            resolvedPath: resolveAbsoluteImport(projectRoot, mod),
            names: aliasNode ? [aliasNode.text] : [],
            isTypeOnly: false,
          });
        }
      }
      continue;
    }

    if (node.type === 'import_from_statement') {
      const moduleNameNode = node.childForFieldName?.('module_name');
      let module = '';
      let level = 0;
      if (moduleNameNode?.type === 'relative_import') {
        const prefix = moduleNameNode.namedChildren?.find(
          (c: any) => c.type === 'import_prefix'
        );
        level = prefix?.text?.length ?? 1;
        const dotted = moduleNameNode.namedChildren?.find(
          (c: any) => c.type === 'dotted_name'
        );
        module = dotted?.text ?? '';
      } else if (moduleNameNode?.type === 'dotted_name') {
        module = moduleNameNode.text;
        level = 0;
      }

      // `module_name` is always the first named child of import_from_statement;
      // comparing node references doesn't work reliably across web-tree-sitter
      // accessors, so skip it positionally instead.
      const nameNodes = (node.namedChildren ?? []).slice(
        moduleNameNode ? 1 : 0
      );
      for (const nameNode of nameNodes) {
        if (nameNode.type === 'wildcard_import') {
          imports.push({
            source: `${'.'.repeat(level)}${module}`,
            resolvedPath:
              level === 0
                ? resolveAbsoluteImport(projectRoot, module)
                : resolveFromImport({
                    projectRoot,
                    absPath,
                    module,
                    level,
                    importedName: '',
                  }),
            names: ['*'],
            isTypeOnly: false,
          });
        } else if (
          nameNode.type === 'dotted_name' ||
          nameNode.type === 'aliased_import'
        ) {
          const isAliased = nameNode.type === 'aliased_import';
          const importedNode = isAliased
            ? nameNode.childForFieldName?.('name')
            : nameNode;
          const aliasNode = isAliased
            ? nameNode.childForFieldName?.('alias')
            : undefined;
          const importedName = importedNode?.text ?? '';
          const localName = aliasNode?.text ?? importedName;

          const resolvedPath =
            level === 0
              ? (resolveAbsoluteImport(
                  projectRoot,
                  module ? `${module}.${importedName}` : importedName
                ) ?? resolveAbsoluteImport(projectRoot, module))
              : resolveFromImport({
                  projectRoot,
                  absPath,
                  module,
                  level,
                  importedName,
                });

          imports.push({
            source: `${'.'.repeat(level)}${module}`,
            resolvedPath,
            names: localName ? [localName] : [],
            isTypeOnly: false,
          });
        }
      }
      continue;
    }

    if (node.type === 'expression_statement') {
      const assign = node.namedChildren?.[0];
      if (assign?.type === 'assignment') {
        const left = assign.childForFieldName?.('left');
        const right = assign.childForFieldName?.('right');
        if (
          left?.type === 'identifier' &&
          left.text === '__all__' &&
          right?.type === 'list'
        ) {
          explicitAll = (right.namedChildren ?? [])
            .filter((c: any) => c.type === 'string')
            .map((c: any) => stringNodeContent(c));
        } else if (
          left?.type === 'identifier' &&
          /^[A-Z][A-Z0-9_]*$/.test(left.text)
        ) {
          topLevelSymbols.set(left.text, 'const');
        } else if (
          left?.type === 'identifier' &&
          assign.childForFieldName?.('type')?.text === 'TypeAlias'
        ) {
          types.push({
            name: left.text,
            kind: 'type',
            definition: right?.text?.trim() ?? 'unknown',
            isExported: true,
          });
          topLevelSymbols.set(left.text, 'type');
        }
      }
      continue;
    }

    const { inner, decorators } = unwrapDecorated(node);
    if (!inner) continue;

    if (inner.type === 'function_definition') {
      const name = inner.childForFieldName?.('name')?.text ?? '';
      if (!name) continue;
      topLevelSymbols.set(name, 'function');
      const sig = functionSignature(inner, true);
      sig.isGenerator = containsYield(inner.childForFieldName?.('body'));
      signatures.push(sig);
    } else if (inner.type === 'class_definition') {
      const name = inner.childForFieldName?.('name')?.text ?? '';
      if (!name) continue;
      topLevelSymbols.set(name, 'class');
      const classDoc = firstDocLine(
        leadingDocstring(inner.childForFieldName?.('body'))
      );
      types.push(classTypeInfo(inner, true, classDoc, decorators));

      const body = inner.childForFieldName?.('body');
      for (const member of body?.namedChildren ?? []) {
        const { inner: methodNode, decorators: methodDecorators } =
          unwrapDecorated(member);
        if (!methodNode || methodNode.type !== 'function_definition') continue;

        const methodName = methodNode.childForFieldName?.('name')?.text ?? '';
        if (!methodName) continue;

        const isDunder =
          methodName.startsWith('__') && methodName.endsWith('__');
        if (isDunder && methodName !== '__init__') continue;
        if (!isDunder && methodName.startsWith('_')) continue;

        const isStatic = methodDecorators.includes('staticmethod');
        const isClassMethod = methodDecorators.includes('classmethod');
        const isProperty = methodDecorators.includes('property');
        const isSetter = methodDecorators.some((d) => d.endsWith('.setter'));

        let kind: SignatureInfo['kind'] = 'method';
        if (methodName === '__init__') kind = 'constructor';
        else if (isProperty) kind = 'getter';
        else if (isSetter) kind = 'setter';

        const dropFirst = !isStatic; // classmethod drops 'cls', instance methods drop 'self'
        const sig = functionSignature(methodNode, true, name, kind, dropFirst);
        sig.isGenerator = containsYield(methodNode.childForFieldName?.('body'));
        void isClassMethod;
        signatures.push(sig);
      }
    }
  }

  const exports: ExportInfo[] = [];
  if (explicitAll) {
    for (const name of explicitAll) {
      exports.push({
        name,
        kind: topLevelSymbols.get(name) ?? 'const',
        isDefault: false,
      });
    }
  } else {
    for (const [name, kind] of topLevelSymbols) {
      if (name.startsWith('_')) continue;
      exports.push({ name, kind, isDefault: false });
    }
  }

  const exportedNames = new Set(exports.map((e) => e.name));
  for (const sig of signatures) {
    sig.isExported = exportedNames.has(sig.className ?? sig.name);
  }
  for (const t of types) {
    t.isExported = exportedNames.has(t.name);
  }

  const fileType = detectPythonFileType({ absPath, relPath, exports });
  const summary = pythonSummary({
    relPath,
    fileType,
    moduleDoc,
    exports,
    signatures,
    types,
  });

  return { exports, imports, signatures, types, summary, fileType };
}

function containsYield(node: any): boolean {
  if (!node) return false;
  if (node.type === 'yield') return true;
  if (
    node.type === 'function_definition' ||
    node.type === 'class_definition' ||
    node.type === 'lambda'
  ) {
    return false;
  }
  for (const c of node.children ?? []) {
    if (containsYield(c)) return true;
  }
  return false;
}

export function detectPythonFileType(params: {
  absPath: string;
  relPath: string;
  exports: ExportInfo[];
}): FileType {
  const lower = params.relPath.toLowerCase();
  const base = path.basename(lower);

  if (
    /^test_.*\.py$/.test(base) ||
    /_test\.py$/.test(base) ||
    lower.includes('/tests/')
  )
    return 'test';
  if (base === 'models.py' || lower.includes('/models/')) return 'model';
  if (
    base === 'settings.py' ||
    base === 'config.py' ||
    lower.includes('/config/')
  )
    return 'config';
  if (
    base === 'views.py' ||
    base === 'routes.py' ||
    base === 'urls.py' ||
    lower.includes('/api/') ||
    lower.includes('/routes/')
  )
    return 'route';
  if (base === '__init__.py') return 'module';
  return 'module';
}

function pythonSummary(params: {
  relPath: string;
  fileType: FileType;
  moduleDoc?: string;
  exports: ExportInfo[];
  signatures: SignatureInfo[];
  types: TypeInfo[];
}): string {
  const { fileType, moduleDoc, exports, signatures } = params;
  if (moduleDoc) return moduleDoc;

  const names = exports.map((e) => e.name).filter(Boolean);
  switch (fileType) {
    case 'test':
      return `Test module exercising ${names.join(', ') || 'nothing'}.`;
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
