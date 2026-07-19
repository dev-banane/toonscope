import type { RequestContext } from '../types';
import { requireAuth } from '../middleware/auth';
import type { UserModel } from '../models/userModel';
import { getDb } from '../utils/db';

export interface UserListResponse {
  items: string[];
}

export async function GET(ctx: RequestContext): Promise<UserModel> {
  requireAuth(ctx);
  return { id: '1', email: 'demo@example.com' };
}

export function healthPing(): string {
  void getDb;
  return 'pong';
}
