import type { ToonConfig } from '../types';
import type { AIProvider, SummarizeFileRequest, FileSummary } from './index';
import { buildSummarizationPrompt, parseAIResponse } from './prompts';
import { ProviderRequestError, parseRetryAfterHeader } from './errors';

export class OpenAIProvider implements AIProvider {
  constructor(private config: NonNullable<ToonConfig['ai']>) {}

  async summarizeFile(
    req: SummarizeFileRequest,
    signal?: AbortSignal
  ): Promise<FileSummary> {
    const model = this.config.model ?? 'gpt-4.1-mini';
    const apiKey = this.config.apiKey;
    if (!apiKey) {
      throw new Error(
        'Missing OpenAI API key (OPENAI_API_KEY or config.ai.apiKey).'
      );
    }

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

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 512,
        response_format: { type: 'json_object' },
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
        `OpenAI request failed: ${res.status} ${text}`,
        {
          status: res.status,
          retryAfterMs: parseRetryAfterHeader(res.headers.get('retry-after')),
        }
      );
    }

    const data = (await res.json()) as any;
    const text = data?.choices?.[0]?.message?.content ?? '';
    return parseAIResponse(String(text), req.undocumentedFunctions);
  }
}
