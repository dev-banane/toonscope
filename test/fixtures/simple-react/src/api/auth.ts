import type { User } from '../types/user';

export interface Credentials {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  token: string;
  expiresAt: number;
}

export async function loginUser(creds: Credentials): Promise<AuthResponse> {
  return {
    user: {
      id: '1',
      name: 'Demo',
      email: creds.email,
      role: 'viewer',
    },
    token: 'token',
    expiresAt: Date.now() + 3600,
  };
}

export function refreshToken(token: string): AuthResponse {
  return {
    user: {
      id: '1',
      name: 'Demo',
      email: 'demo@example.com',
      role: 'viewer',
    },
    token,
    expiresAt: Date.now() + 3600,
  };
}
