import type { ToonConfig } from '../types';
import type { AIProvider, SummarizeFileRequest, FileSummary } from './index';
import { buildSummarizationPrompt, parseAIResponse } from './prompts';
import { ProviderRequestError, parseRetryAfterHeader } from './errors';

export class AnthropicProvider implements AIProvider {
  constructor(private config: NonNullable<ToonConfig['ai']>) {}

  async summarizeFile(
    req: SummarizeFileRequest,
    signal?: AbortSignal
  ): Promise<FileSummary> {
    const model = this.config.model ?? 'claude-haiku-4-5';
    const apiKey = this.config.apiKey;
    if (!apiKey) {
      throw new Error(
        'Missing Anthropic API key (ANTHROPIC_API_KEY or config.ai.apiKey).'
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

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature: 0.1,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderRequestError(
        `Anthropic request failed: ${res.status} ${text}`,
        {
          status: res.status,
          retryAfterMs: parseRetryAfterHeader(res.headers.get('retry-after')),
        }
      );
    }

    const data = (await res.json()) as any;
    const text = data?.content?.[0]?.text ?? '';
    return parseAIResponse(String(text), req.undocumentedFunctions);
  }
}
