import { useEffect, useMemo, useState } from 'react';
import { orderedWaiting, type Session } from '../engine';
import { courtViews, gridFor } from '../store/boardInfo';
import { formatClock } from '../store/slots';
import { BoardCourt } from './BoardCourt';
import { BoardWaiting } from './BoardWaiting';

const SECOND = 1000;
const MINUTE = 60_000;

/** The current time in ms, refreshed on its own interval. */
function useNow(every: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}

function timeOfDay(ms: number): string {
  const d = new Date(ms);
  return formatClock(d.getHours() * 60 + d.getMinutes());
}

interface HeaderProps {
  session: Session;
  hidden: number;
  onClose: () => void;
}

function BoardHeader({ session, hidden, onClose }: HeaderProps) {
  const now = useNow(MINUTE);
  return (
    <header className="board-head">
      <div className="board-head-l">
        <h1 className="board-name">{session.name}</h1>
        {session.venue && <span className="board-venue">{session.venue}</span>}
      </div>
      <div className="board-head-r">
        {hidden > 0 && <span className="board-more">+{hidden} more {hidden === 1 ? 'court' : 'courts'}</span>}
        {session.plannedEndAt !== undefined && <span className="board-end">Ends {timeOfDay(session.plannedEndAt)}</span>}
        <time className="board-clock" aria-live="off">
          {timeOfDay(now)}
        </time>
        <button type="button" className="board-close" aria-label="Close board" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </header>
  );
}

/** The courts. The one-second interval lives here so only the courts redraw each second. */
function BoardCourts({ session, everyone }: { session: Session; everyone: Session['players'] }) {
  const now = useNow(SECOND);
  const grid = gridFor(session.courts.length, true);
  const portrait = gridFor(session.courts.length, false);
  const views = useMemo(() => courtViews(session, now).slice(0, grid.shown), [session, now, grid.shown]);
  const vars = {
    '--cols-land': grid.columns,
    '--rows-land': grid.rows,
    '--cols-port': portrait.columns,
    '--rows-port': portrait.rows,
  } as React.CSSProperties;
  return (
    <ul
      className="board-courts"
      aria-label="Courts"
      style={vars}
      data-cols-land={grid.columns}
      data-rows-land={grid.rows}
      data-cols-port={portrait.columns}
      data-rows-port={portrait.rows}
      data-shown={grid.shown}
      data-hidden={grid.hidden}
    >
      {views.map((v) => (
        <BoardCourt key={v.id} court={v} everyone={everyone} />
      ))}
    </ul>
  );
}

/** A full-screen board for a TV or a phone on a stand: every court, both teams, and who is waiting. */
export function BoardScreen({ session, onClose }: { session: Session; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const grid = gridFor(session.courts.length, true);
  const waiting = orderedWaiting(session);
  // Everyone drawn on the board, so two players with the same first name get a last initial.
  const everyone = useMemo(() => {
    const onCourts = courtViews(session, 0)
      .slice(0, grid.shown)
      .flatMap((v) => [...v.teamA, ...v.teamB]);
    return [...onCourts, ...waiting];
  }, [session, grid.shown, waiting]);

  return (
    <main className="board" aria-label="Board">
      <BoardHeader session={session} hidden={grid.hidden} onClose={onClose} />
      <BoardCourts session={session} everyone={everyone} />
      <BoardWaiting waiting={waiting} everyone={everyone} />
    </main>
  );
}
