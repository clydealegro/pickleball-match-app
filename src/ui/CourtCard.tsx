import { useId } from 'react';
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
  const titleId = useId();

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
      aria-labelledby={titleId}
    >
      <div className="row-flex spread">
        <h2 id={titleId} className="court-title">
          Court {court.number}
        </h2>
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
            Game finished<span className="sr-only"> on court {court.number}</span>
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="btn btn-ghost btn-small" onClick={onToggleClosing}>
          {court.closing ? 'Keep court open' : 'Remove court'}
          <span className="sr-only"> {court.number}</span>
        </button>
      </div>
    </section>
  );
}
