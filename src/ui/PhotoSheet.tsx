import { PhotoPanel } from './PhotoPanel';
import { Sheet } from './Sheet';

interface Props {
  rosterId: string;
  name: string;
  onClose: () => void;
}

/** A sheet for adding, changing or removing one saved player's photo. */
export function PhotoSheet({ rosterId, name, onClose }: Props) {
  return (
    <Sheet title={`Photo for ${name}`} onClose={onClose}>
      <PhotoPanel rosterId={rosterId} name={name} onDone={onClose} />
    </Sheet>
  );
}
