import type { ToonConfig } from '../types';
import type { AIProvider, SummarizeFileRequest, FileSummary } from './index';
import { buildSummarizationPrompt, parseAIResponse } from './prompts';
import { ProviderRequestError, parseRetryAfterHeader } from './errors';

export class OllamaProvider implements AIProvider {
  constructor(private config: NonNullable<ToonConfig['ai']>) {}

  async summarizeFile(
    req: SummarizeFileRequest,
    signal?: AbortSignal
  ): Promise<FileSummary> {
    const model = this.config.model ?? 'llama3.2';
    const ollamaUrl = this.config.ollamaUrl ?? 'http://localhost:11434';

    const { system, user } = buildSummarizationPrompt({
      path: req.path,
      type: req.type,
      language: req.language,
      exports: req.exports,
      signatures: req.signatures,
      types: req.types,
      imports: req.imports,
      sourceText: req.sourceText,
      undocumentedFunctions: req.undocumentedFunctions,
    });

    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        options: { temperature: 0.1 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderRequestError(
        `Ollama request failed: ${res.status} ${text}`,
        {
          status: res.status,
          retryAfterMs: parseRetryAfterHeader(res.headers.get('retry-after')),
        }
      );
    }

    const data = (await res.json()) as any;
    const text = data?.message?.content ?? data?.response ?? '';
    return parseAIResponse(String(text), req.undocumentedFunctions);
  }
}
