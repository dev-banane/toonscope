import type { User } from '../types/user';
import { useAuth } from '../hooks/useAuth';
import { formatDate } from '../lib/utils/format';

export interface UserCardProps {
  user: User;
}

export function UserCard(props: UserCardProps): JSX.Element {
  const { user } = props;
  const { logout } = useAuth() as any;
  return (
    <section>
      <h2>{user.name}</h2>
      <p>{formatDate(new Date().toISOString())}</p>
    </section>
  );
}
