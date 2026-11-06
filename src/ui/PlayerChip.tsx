import type { Player } from '../engine';
import { Avatar } from './Avatar';

interface PlayerChipProps {
  player: Player;
  onClick?: () => void;
}

export function PlayerChip({ player, onClick }: PlayerChipProps) {
  const body = (
    <>
      <Avatar name={player.name} size="sm" />
      <span className="chip-name">{player.name}</span>
      {player.pendingStatus && (
        <span className="tag">{player.pendingStatus === 'break' ? 'Break next' : 'Leaving next'}</span>
      )}
    </>
  );
  return onClick ? (
    <button type="button" className="chip" onClick={onClick}>
      {body}
    </button>
  ) : (
    <span className="chip">{body}</span>
  );
}
