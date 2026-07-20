import { describe, it, expect, vi, afterEach } from 'vitest';
import { OllamaProvider } from '../../src/ai/ollama';
import { baseRequest, mockOkResponse } from './helpers';

describe('OllamaProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to llama3.2 against http://localhost:11434 and needs no api key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockOkResponse({
        message: {
          role: 'assistant',
          content: '{"summary":"Handles login requests."}',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OllamaProvider({ provider: 'ollama' });
    const result = await provider.summarizeFile(baseRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('llama3.2');
    expect(result.summary).toBe('Handles login requests.');
  });

  it('honors a configurable base url', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockOkResponse({ message: { content: '{"summary":"X."}' } })
      );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OllamaProvider({
      provider: 'ollama',
      ollamaUrl: 'http://my-box:9999',
      model: 'qwen2.5-coder',
    });
    await provider.summarizeFile(baseRequest());

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://my-box:9999/api/chat');
  });
});
