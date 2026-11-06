import type { Player } from '../engine';
import { PlayerAvatar } from './PlayerAvatar';

interface PlayerChipProps {
  player: Player;
  onClick?: () => void;
}

export function PlayerChip({ player, onClick }: PlayerChipProps) {
  const body = (
    <>
      <PlayerAvatar name={player.name} rosterId={player.rosterId} size="sm" />
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
