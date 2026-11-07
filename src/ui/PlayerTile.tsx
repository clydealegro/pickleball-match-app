import type { Player } from '../engine';
import { PlayerAvatar } from './PlayerAvatar';

/** A player on a court: a large avatar with the name beneath, tappable to open their options. */
export function PlayerTile({ player, onClick }: { player: Player; onClick: () => void }) {
  return (
    <button type="button" className="tile" onClick={onClick}>
      <PlayerAvatar name={player.name} rosterId={player.rosterId} size="lg" />
      <span className="tile-name">{player.name}</span>
      {player.pendingStatus && <span className="tag">{player.pendingStatus === 'break' ? 'Break next' : 'Leaving next'}</span>}
    </button>
  );
}
