export class ProviderRequestError extends Error {
  status?: number;
  retryAfterMs?: number;

  constructor(
    message: string,
    opts?: { status?: number; retryAfterMs?: number }
  ) {
    super(message);
    this.name = 'ProviderRequestError';
    this.status = opts?.status;
    this.retryAfterMs = opts?.retryAfterMs;
  }
}

export function parseRetryAfterHeader(
  value: string | null | undefined
): number | undefined {
  if (!value) return undefined;
  const asSeconds = Number(value);
  if (!Number.isNaN(asSeconds)) return Math.max(0, asSeconds * 1000);
  const asDate = Date.parse(value);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return undefined;
}
