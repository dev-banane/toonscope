import type { User } from '../types/user';
import { UserCard } from './UserCard';

export interface UserListProps {
  users: User[];
}

export function UserList(props: UserListProps): JSX.Element {
  return (
    <div>
      <UserCard
        user={props.users[0] as User}
        onEdit={() => undefined}
        compact
      />
    </div>
  );
}
