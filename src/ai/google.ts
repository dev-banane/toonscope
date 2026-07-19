import type { ToonConfig } from '../types';
import type { AIProvider, SummarizeFileRequest, FileSummary } from './index';
import { buildSummarizationPrompt, parseAIResponse } from './prompts';
import { ProviderRequestError, parseRetryAfterHeader } from './errors';

export class GoogleProvider implements AIProvider {
  constructor(private config: NonNullable<ToonConfig['ai']>) {}

  async summarizeFile(
    req: SummarizeFileRequest,
    signal?: AbortSignal
  ): Promise<FileSummary> {
    const model = this.config.model ?? 'gemini-2.5-flash';
    const apiKey = this.config.apiKey;
    if (!apiKey) {
      throw new Error(
        'Missing Google API key (GEMINI_API_KEY, GOOGLE_API_KEY, or config.ai.apiKey).'
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: user }] }],
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
        },
      }),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderRequestError(
        `Google request failed: ${res.status} ${text}`,
        {
          status: res.status,
          retryAfterMs: parseRetryAfterHeader(res.headers.get('retry-after')),
        }
      );
    }

    const data = (await res.json()) as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return parseAIResponse(String(text), req.undocumentedFunctions);
  }
}
