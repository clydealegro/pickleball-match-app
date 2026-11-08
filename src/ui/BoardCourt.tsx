import type { Player } from '../engine';
import type { CourtView } from '../store/boardInfo';
import { BoardTeam } from './BoardTeam';

/** One court card: its number and state, then both teams with a VS between them. */
export function BoardCourt({ court, everyone }: { court: CourtView; everyone: Player[] }) {
  const cls = ['board-court', `board-court-${court.state}`, court.closing && 'is-closing'].filter(Boolean).join(' ');
  return (
    <li className={cls}>
      <div className="board-court-head">
        <span className="board-court-n">Court {court.number}</span>
        {court.state === 'playing' && (
          <span className="board-timer" role="timer" aria-live="off">
            {court.clock}
          </span>
        )}
        {court.state === 'ready' && <span className="board-tag">Up next</span>}
        {court.closing && <span className="board-closing">Closing</span>}
      </div>
      {court.state === 'open' ? (
        <p className="board-open">Open</p>
      ) : (
        <div className="board-teams">
          <BoardTeam side="a" players={court.teamA} everyone={everyone} />
          <span className="board-vs">VS</span>
          <BoardTeam side="b" players={court.teamB} everyone={everyone} />
        </div>
      )}
    </li>
  );
}
