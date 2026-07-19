import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnthropicProvider } from '../../src/ai/anthropic';
import { baseRequest, mockOkResponse, mockErrorResponse } from './helpers';

describe('AnthropicProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the expected URL, headers, and body, and defaults to claude-haiku-4-5', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockOkResponse({
        content: [{ type: 'text', text: '{"summary":"Handles login requests."}' }],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AnthropicProvider({ provider: 'anthropic', apiKey: 'test-key' });
    const result = await provider.summarizeFile(baseRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('test-key');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');

    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-haiku-4-5');
    expect(body.system).toMatch(/precise code summarization/i);
    expect(body.messages[0].content).toContain('src/api/auth.ts');
    expect(result.summary).toBe('Handles login requests.');
  });

  it('throws when no api key is configured', async () => {
    const provider = new AnthropicProvider({ provider: 'anthropic' });
    await expect(provider.summarizeFile(baseRequest())).rejects.toThrow(
      /Missing Anthropic API key/
    );
  });

  it('surfaces non-ok responses as retryable ProviderRequestErrors for 5xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockErrorResponse(503, 'overloaded'));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AnthropicProvider({ provider: 'anthropic', apiKey: 'k' });
    await expect(provider.summarizeFile(baseRequest())).rejects.toMatchObject({
      status: 503,
    });
  });
});
