import type { User } from '../types/user';
import { loginUser, refreshToken } from '../api/auth';
import type { Credentials, AuthResponse } from '../api/auth';

export interface AuthState {
  user: User | null;
  token: string;
}

export function useAuth(): AuthState {
  void loginUser;
  void refreshToken;
  return { user: null, token: '' };
}
