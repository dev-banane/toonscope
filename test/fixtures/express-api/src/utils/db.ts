import type { RequestContext } from '../types';

export function getDb(): string {
  return 'db';
}

export function withRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return fn();
}
