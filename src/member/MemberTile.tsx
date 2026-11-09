import type { CSSProperties } from 'react';
import { nameHue } from '../store/boardInfo';
import { initials } from '../ui/Avatar';

interface MemberTileProps {
  name: string;
  size?: 'sm' | 'md';
}

/** Initials on a colour that comes from the name. The name itself is shown by whoever uses this. */
export function MemberTile({ name, size = 'md' }: MemberTileProps) {
  return (
    <span className={`member-tile member-tile-${size}`} style={{ '--h': nameHue(name) } as CSSProperties} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
