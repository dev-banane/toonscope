import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIProvider } from '../../src/ai/openai';
import { baseRequest, mockOkResponse, mockErrorResponse } from './helpers';

describe('OpenAIProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the expected URL, headers, and body, and defaults to gpt-4.1-mini', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockOkResponse({
        choices: [{ message: { content: '{"summary":"Handles login requests."}' } }],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAIProvider({ provider: 'openai', apiKey: 'test-key' });
    const result = await provider.summarizeFile(baseRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers['Authorization']).toBe('Bearer test-key');

    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-4.1-mini');
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toMatch(/precise code summarization/i);
    expect(body.messages[1].content).toContain('src/api/auth.ts');
    expect(result.summary).toBe('Handles login requests.');
  });

  it('throws when no api key is configured', async () => {
    const provider = new OpenAIProvider({ provider: 'openai' });
    await expect(provider.summarizeFile(baseRequest())).rejects.toThrow(
      /Missing OpenAI API key/
    );
  });

  it('does not retry-flag plain 401s (non-retryable) but still surfaces status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockErrorResponse(401, 'unauthorized'));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAIProvider({ provider: 'openai', apiKey: 'bad-key' });
    await expect(provider.summarizeFile(baseRequest())).rejects.toMatchObject({
      status: 401,
    });
  });
});
