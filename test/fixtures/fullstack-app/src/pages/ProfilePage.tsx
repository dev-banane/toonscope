import type { User } from '../types/user';
import { UserCard } from '../components/UserCard';

export interface ProfilePageProps {
  user: User;
}

export function ProfilePage(props: ProfilePageProps): JSX.Element {
  return <UserCard user={props.user} />;
}
