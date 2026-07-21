export type Language =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'c'
  | 'cpp'
  | 'csharp';

export interface ToonConfig {
  include: string[];
  exclude: string[];
  output: string;
  defaultDepth: number;
  ai?: {
    provider:
      'google' | 'gemini' | 'anthropic' | 'openai' | 'ollama' | 'mistral';
    model?: string;
    apiKey?: string; // env: GEMINI_API_KEY / GOOGLE_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY / MISTRAL_API_KEY / TOONSCOPE_API_KEY
    ollamaUrl?: string; // default: http://localhost:11434
    concurrency?: number; // default: 8
  };
  languages: Language[];
  splitThreshold?: number;
  gitignoreToon?: boolean;
  precommitHook?: boolean;
  integrations?: {
    agents?: boolean;
    claude_code?: boolean;
    cursor?: boolean;
    copilot?: boolean;
    gemini?: boolean;
    windsurf?: boolean;
    agentAutoUpdate?: boolean;
  };
}

export type FileType =
  | 'component'
  | 'hook'
  | 'module'
  | 'route'
  | 'model'
  | 'config'
  | 'test'
  | 'types'
  | 'unknown';

export interface ExportInfo {
  name: string;
  kind:
    | 'function'
    | 'class'
    | 'const'
    | 'type'
    | 'interface'
    | 'enum'
    | 'default'
    | 'reexport';
  isDefault: boolean;
  reexport?: { from: string; star?: boolean };
}

export interface ImportInfo {
  source: string;
  resolvedPath: string | null;
  names: string[];
  isTypeOnly: boolean;
}

export interface ParamInfo {
  name: string;
  type?: string;
  optional?: boolean;
  default?: string;
  rest?: boolean;
}

export interface SignatureInfo {
  name: string;
  kind: 'function' | 'arrow' | 'method' | 'getter' | 'setter' | 'constructor';
  params: ParamInfo[];
  returnType?: string;
  isAsync: boolean;
  isGenerator: boolean;
  isExported: boolean;
  className?: string;
  doc?: string;
}

export interface TypeInfo {
  name: string;
  kind: 'interface' | 'type' | 'enum' | 'class';
  definition: string;
  isExported: boolean;
  doc?: string;
}

export interface FileAnalysis {
  path: string;
  language: Language;
  type: FileType;
  exports: ExportInfo[];
  imports: ImportInfo[];
  signatures: SignatureInfo[];
  types: TypeInfo[];
  summary: string;
  contentHash: string;
  lastAnalyzed: string;
}

export interface DependencyGraph {
  nodes: Map<string, FileAnalysis>;
  edges: {
    imports: Map<string, Set<string>>;
    importedBy: Map<string, Set<string>>;
  };
}

export interface yamlFileEntry {
  type: FileType;
  exports: string[];
  props?: Record<string, string>;
  signatures?: Record<string, string>;
  returns?: Record<string, string>;
  uses: string[];
  used_by: string[];
  summary: string;
}

export interface ToonContext {
  meta: {
    project: string;
    framework?: string;
    generated: string;
    files: number;
    totalTokens: number;
    aiSummary?: {
      succeeded: number;
      failed: number;
      cached: number;
      skipped: number;
    };
    errors?: { count: number; files: string[] };
  };
  graph: Record<string, yamlFileEntry>;
  types: Record<string, string>;
}
