import type { User } from '../types/user';
import { loginUser } from '../api/auth';

export interface AuthState {
  user: User | null;
}

export function useAuth(): AuthState {
  void loginUser;
  return { user: null };
}
