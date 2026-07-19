import { describe, it, expect, vi, afterEach } from 'vitest';
import { GoogleProvider } from '../../src/ai/google';
import { ProviderRequestError } from '../../src/ai/errors';
import { baseRequest, mockOkResponse, mockErrorResponse } from './helpers';

describe('GoogleProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the expected URL, headers, and body, and defaults to gemini-2.5-flash', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockOkResponse({
        candidates: [
          {
            content: {
              parts: [{ text: '{"summary":"Handles login requests.","functions":{}}' }],
            },
          },
        ],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GoogleProvider({ provider: 'google', apiKey: 'test-key' });
    const result = await provider.summarizeFile(baseRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
    );
    expect(init.method).toBe('POST');
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    expect(init.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body);
    expect(body.contents[0].parts[0].text).toContain('src/api/auth.ts');
    expect(body.systemInstruction.parts[0].text).toMatch(/precise code summarization/i);
    expect(result.summary).toBe('Handles login requests.');
  });

  it('honors an explicit model override', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockOkResponse({
        candidates: [{ content: { parts: [{ text: '{"summary":"X."}' }] } }],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GoogleProvider({
      provider: 'google',
      apiKey: 'k',
      model: 'gemini-2.5-flash-lite',
    });
    await provider.summarizeFile(baseRequest());

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('gemini-2.5-flash-lite');
  });

  it('throws when no api key is configured', async () => {
    const provider = new GoogleProvider({ provider: 'google' });
    await expect(provider.summarizeFile(baseRequest())).rejects.toThrow(
      /Missing Google API key/
    );
  });

  it('parses fenced JSON responses and filters functions to the allowed list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockOkResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  text:
                    '```json\n{"summary":"Does X.","functions":{"foo":"Does the thing.","bar":"Unlisted."}}\n```',
                },
              ],
            },
          },
        ],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GoogleProvider({ provider: 'google', apiKey: 'k' });
    const result = await provider.summarizeFile(
      baseRequest({ undocumentedFunctions: ['foo'] })
    );

    expect(result.summary).toBe('Does X.');
    expect(result.functionDocs).toEqual({ foo: 'Does the thing.' });
  });

  it('throws a ProviderRequestError carrying status and retry-after on non-ok responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockErrorResponse(429, 'rate limited', { 'retry-after': '2' }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GoogleProvider({ provider: 'google', apiKey: 'k' });
    await expect(provider.summarizeFile(baseRequest())).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 2000,
    });
    await expect(provider.summarizeFile(baseRequest())).rejects.toBeInstanceOf(
      ProviderRequestError
    );
  });
});
