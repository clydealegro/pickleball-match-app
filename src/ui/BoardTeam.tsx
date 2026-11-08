import type { Player } from '../engine';
import { boardName } from '../store/boardInfo';
import { PlayerAvatar } from './PlayerAvatar';

interface Props {
  side: 'a' | 'b';
  players: Player[];
  /** Everyone on the board, to tell players with the same first name apart. */
  everyone: Player[];
}

/** One team's outlined panel: a circle and a first name for each player. */
export function BoardTeam({ side, players, everyone }: Props) {
  return (
    <div className={`board-team board-team-${side}`} role="group" aria-label={side === 'a' ? 'Team A' : 'Team B'}>
      {players.map((p) => (
        <div key={p.id} className="board-pf">
          <div className="board-circle">
            <PlayerAvatar name={p.name} rosterId={p.rosterId} size="fill" />
          </div>
          <span className="board-pname">{boardName(p, everyone)}</span>
        </div>
      ))}
    </div>
  );
}
