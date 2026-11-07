import type { Court, Player } from '../engine';
import { courtPanelId } from './CourtTabs';
import { PlayerTile } from './PlayerTile';

interface Props {
  court: Court;
  playersById: Map<string, Player>;
  onFinish: () => void;
  onStart: () => void;
  onSelectPlayer: (id: string) => void;
}

/** The court in focus: who is playing, or who is up next and waiting for Start, and the one thing to do next. */
export function CourtCard({ court, playersById, onFinish, onStart, onSelectPlayer }: Props) {
  const game = court.game;
  const lineup = court.lineup;

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
      aria-label={`Court ${court.number}`}
      className="card court"
    >
      {game ? (
        <div className="match">
          {team(game.team1, 1)}
          <span className="vs">vs</span>
          {team(game.team2, 2)}
        </div>
      ) : lineup ? (
        <>
          <p className="ready-label">Next up</p>
          <div className="match">
            {team(lineup.team1, 1)}
            <span className="vs">vs</span>
            {team(lineup.team2, 2)}
          </div>
        </>
      ) : (
        <p className="muted court-empty">Waiting for players</p>
      )}

      {court.closing && <span className="tag">Closing after this game</span>}

      {game && (
        <button type="button" className="btn btn-live btn-block btn-finish" onClick={onFinish}>
          Game finished<span className="sr-only"> on court {court.number}</span>
        </button>
      )}

      {lineup && (
        <button type="button" className="btn btn-live btn-block btn-finish" onClick={onStart}>
          Start game<span className="sr-only"> on court {court.number}</span>
        </button>
      )}
    </section>
  );
}
