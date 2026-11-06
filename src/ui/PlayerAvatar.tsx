import { Avatar } from './Avatar';
import { usePhotoUrl } from './usePhotoUrl';

interface Props {
  name: string;
  /** The saved player this avatar belongs to; without one, initials are shown. */
  rosterId?: string;
  size?: 'sm' | 'md' | 'lg';
}

/** An avatar that shows the saved player's photo when there is one, otherwise their initials. */
export function PlayerAvatar({ name, rosterId, size }: Props) {
  return <Avatar name={name} size={size} photoUrl={usePhotoUrl(rosterId)} />;
}
