import type { User } from '../types/user';
import { useAuth } from '../hooks/useAuth';
import { formatDate } from '../utils/format';

export interface UserCardProps {
  user: User;
  onEdit: (id: string) => void;
  compact?: boolean;
}

export function UserCard(props: UserCardProps): JSX.Element {
  const { user, logout } = useAuth();
  return (
    <div>
      <h3>{user?.name}</h3>
      <button onClick={() => logout()}>
        {formatDate(new Date().toISOString())}
      </button>
    </div>
  );
}
