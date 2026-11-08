import { useEffect, useState } from 'react';
import { availablePlayers, plural, type Session } from '../engine';
import { elapsedLabel } from '../store/homeInfo';
import { formatClock } from '../store/slots';
import { WEEKDAY_NAMES } from './weekdays';

const MINUTE = 60_000;

/** The hero while a session runs. The elapsed time is refreshed each minute. */
export function LiveHero({ session }: { session: Session }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(id);
  }, []);

  const day = WEEKDAY_NAMES[new Date(session.createdAt).getDay()];
  const end = session.plannedEndAt === undefined ? undefined : new Date(session.plannedEndAt);
  const line = [session.venue, end && `Ends ${formatClock(end.getHours() * 60 + end.getMinutes())}`].filter(Boolean).join(' · ');
  const players = session.players.filter((p) => p.status !== 'left').length;

  return (
    <section className="home-hero home-hero-in">
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
    </section>
  );
}
