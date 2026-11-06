import type { Court, Player } from '../engine';
import { PlayerChip } from './PlayerChip';
import { Timer } from './Timer';

interface Props {
  court: Court;
  playersById: Map<string, Player>;
  onFinish: () => void;
  onToggleClosing: () => void;
  onSelectPlayer: (id: string) => void;
}

export function CourtCard({ court, playersById, onFinish, onToggleClosing, onSelectPlayer }: Props) {
  const game = court.game;

  function team(ids: [string, string]) {
    return (
      <div className="team">
        {ids.map((id) => {
          const p = playersById.get(id);
          return p ? <PlayerChip key={id} player={p} onClick={() => onSelectPlayer(id)} /> : null;
        })}
      </div>
    );
  }

  return (
    <section
      className={`card court ${game ? 'court-live' : ''}`}
      aria-label={`Court ${court.number}`}
    >
      <div className="row-flex spread">
        <h2 className="court-title">Court {court.number}</h2>
        {game && <Timer startedAt={game.startedAt} />}
      </div>

      {game ? (
        <div className="teams">
          {team(game.team1)}
          <span className="vs">vs</span>
          {team(game.team2)}
        </div>
      ) : (
        <p className="muted">Waiting for players</p>
      )}

      {court.closing && <span className="tag">Closing after this game</span>}

      <div className="row-flex spread">
        {game ? (
          <button type="button" className="btn btn-live" onClick={onFinish}>
            Game finished
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="btn btn-ghost btn-small" onClick={onToggleClosing}>
          {court.closing ? 'Keep court open' : 'Remove court'}
        </button>
      </div>
    </section>
  );
}
