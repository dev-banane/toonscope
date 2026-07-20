import type {
  ToonConfig,
  FileType,
  Language,
  ExportInfo,
  ImportInfo,
  SignatureInfo,
  TypeInfo,
} from '../types';
import { normalizeProviderId } from './keys';
import { GoogleProvider } from './google';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import { OllamaProvider } from './ollama';
import { MistralProvider } from './mistral';

export interface SummarizeFileRequest {
  path: string;
  type: FileType;
  language: Language;
  exports: ExportInfo[];
  signatures: SignatureInfo[];
  types: TypeInfo[];
  imports: ImportInfo[];
  sourceText: string;
  undocumentedFunctions: string[];
}

export interface FileSummary {
  summary: string;
  functionDocs?: Record<string, string>;
}

export interface AIProvider {
  summarizeFile(
    req: SummarizeFileRequest,
    signal?: AbortSignal
  ): Promise<FileSummary>;
}

const DEFAULT_MODELS: Record<string, string> = {
  google: 'gemini-2.5-flash',
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-4.1-mini',
  ollama: 'llama3.2',
  mistral: 'mistral-small-latest',
};

export function effectiveModel(config: NonNullable<ToonConfig['ai']>): string {
  const id = normalizeProviderId(config.provider);
  return config.model ?? DEFAULT_MODELS[id] ?? 'unknown';
}

export function createProvider(
  config: NonNullable<ToonConfig['ai']>
): AIProvider {
  const id = normalizeProviderId(config.provider);
  switch (id) {
    case 'google':
      return new GoogleProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    case 'mistral':
      return new MistralProvider(config);
    default:
      throw new Error(`Unsupported AI provider: ${(config as any).provider}`);
  }
}

export { normalizeProviderId };
