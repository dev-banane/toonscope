import type { SummarizeFileRequest } from '../../src/ai';

export function baseRequest(
  overrides: Partial<SummarizeFileRequest> = {}
): SummarizeFileRequest {
  return {
    path: 'src/api/auth.ts',
    type: 'module',
    language: 'typescript',
    exports: [{ name: 'loginUser', kind: 'function', isDefault: false }],
    signatures: [
      {
        name: 'loginUser',
        kind: 'function',
        params: [{ name: 'creds', type: 'Credentials' }],
        returnType: 'Promise<AuthResponse>',
        isAsync: true,
        isGenerator: false,
        isExported: true,
      },
    ],
    types: [],
    imports: [],
    sourceText:
      'export async function loginUser(creds) { return fetch("/login", { body: creds }); }',
    undocumentedFunctions: [],
    ...overrides,
  };
}

export function mockOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

export function mockErrorResponse(
  status: number,
  text: string,
  headers: Record<string, string> = {}
): Response {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    ok: false,
    status,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    json: async () => ({}),
    text: async () => text,
  } as unknown as Response;
}
