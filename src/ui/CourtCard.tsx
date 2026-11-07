import { useId } from 'react';
import type { Court, Player } from '../engine';
import { courtPanelId } from './CourtTabs';
import { PlayerTile } from './PlayerTile';
import { Timer } from './Timer';

interface Props {
  court: Court;
  playersById: Map<string, Player>;
  onFinish: () => void;
  onSelectPlayer: (id: string) => void;
}

/** The court in focus: who is playing, the game clock, and the one thing you do every game, finish it. */
export function CourtCard({ court, playersById, onFinish, onSelectPlayer }: Props) {
  const game = court.game;
  const titleId = useId();

  function team(ids: [string, string], number: 1 | 2) {
    const players = ids.flatMap((id) => playersById.get(id) ?? []);
    return (
      <div className={`team team-${number}`} role="group" aria-label={`Team ${number}: ${players.map((p) => p.name).join(' and ')}`}>
        {players.map((p) => (
          <PlayerTile key={p.id} player={p} onClick={() => onSelectPlayer(p.id)} />
        ))}
      </div>
    );
  }

  return (
    <section
      role="tabpanel"
      id={courtPanelId(court.id)}
      aria-labelledby={titleId}
      className="card court"
    >
      <div className="row-flex spread">
        <h2 id={titleId} className="court-title">
          Court {court.number}
        </h2>
        {game && <Timer startedAt={game.startedAt} />}
      </div>

      {game ? (
        <div className="match">
          {team(game.team1, 1)}
          <span className="vs">vs</span>
          {team(game.team2, 2)}
        </div>
      ) : (
        <p className="muted court-empty">Waiting for players</p>
      )}

      {court.closing && <span className="tag">Closing after this game</span>}

      {game && (
        <button type="button" className="btn btn-live btn-block btn-finish" onClick={onFinish}>
          Game finished<span className="sr-only"> on court {court.number}</span>
        </button>
      )}
    </section>
  );
}
