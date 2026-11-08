import { useEffect, useState } from 'react';
import { availablePlayers, plural, type Court, type Session } from '../engine';
import { elapsedLabel, sessionWeekday } from '../store/homeInfo';
import { formatClock } from '../store/slots';
import { WEEKDAY_NAMES } from './weekdays';

const MINUTE = 60_000;
const MAX_COURT_ROWS = 4;

/** What a court is doing. Closing wins over the state. */
function courtState(court: Court, now: number): string {
  if (court.closing) return 'Closing';
  if (court.status === 'playing' && court.game) return `Playing, ${Math.max(1, Math.floor((now - court.game.startedAt) / MINUTE))} min`;
  return court.status === 'ready' ? 'Ready' : 'Open';
}

/** A compact list of the courts, four at most. */
function CourtList({ courts, now }: { courts: Court[]; now: number }) {
  const sorted = [...courts].sort((a, b) => a.number - b.number);
  const extra = sorted.length - MAX_COURT_ROWS;
  return (
    <ul className="home-courts" aria-label="Courts">
      {sorted.slice(0, MAX_COURT_ROWS).map((c) => (
        <li key={c.id} className="home-court-row">
          <span className="home-court-name">Court {c.number}</span>
          <span className="home-court-state">{courtState(c, now)}</span>
        </li>
      ))}
      {extra > 0 && (
        <li className="home-court-row">
          <span className="home-court-name">+{extra} more {extra === 1 ? 'court' : 'courts'}</span>
        </li>
      )}
    </ul>
  );
}

/** The hero while a session runs. The elapsed time is refreshed each minute. */
export function LiveHero({ session }: { session: Session }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(id);
  }, []);

  const day = WEEKDAY_NAMES[sessionWeekday(session)];
  const end = session.plannedEndAt === undefined ? undefined : new Date(session.plannedEndAt);
  const line = [session.venue, end && `Ends ${formatClock(end.getHours() * 60 + end.getMinutes())}`].filter(Boolean).join(' · ');
  const players = session.players.filter((p) => p.status !== 'left').length;

  return (
    <section className="home-hero home-hero-split home-hero-in">
      <div className="home-hero-head">
        <div className="home-hero-top">
          <span className="home-pill">
            <span className="home-live-dot" aria-hidden="true" />
            Live · {elapsedLabel(session.createdAt, now)}
          </span>
        </div>
        <h1 className="home-day">{day}</h1>
        {line && <p className="home-line">{line}</p>}
        <div className="home-counts">
          <span className="home-count">{plural(session.history.length, 'game')}</span>
          <span className="home-count">{plural(players, 'player')}</span>
          <span className="home-count">{availablePlayers(session).length} waiting</span>
        </div>
      </div>
      {session.courts.length > 0 && (
        <div className="home-hero-body">
          <CourtList courts={session.courts} now={now} />
        </div>
      )}
    </section>
  );
}
