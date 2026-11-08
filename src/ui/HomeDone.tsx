import { useState } from 'react';
import { formatDuration } from '../engine';
import type { Session } from '../engine';
import type { HistoryEntry } from '../store/historyDb';
import { formatRange } from '../store/slots';
import { sharePictureFor } from './sharePicture';
import { WEEKDAY_NAMES } from './weekdays';

const minuteOfDay = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

/** The calm card for a session that ended in the last 24 hours. */
export function DoneCard({ entry, now }: { entry: HistoryEntry; now: Date }) {
  const { session } = entry;
  const day = WEEKDAY_NAMES[new Date(session.createdAt).getDay()];
  const when = formatRange(minuteOfDay(entry.createdAt), minuteOfDay(entry.endedAt));
  const stats: [string, string][] = [
    ['Games', String(entry.games)],
    ['Players', String(session.players.length)],
    ['Duration', formatDuration(entry.endedAt - entry.createdAt)],
  ];
  return (
    <section className="home-hero home-hero-done home-hero-in">
      <div className="home-hero-top">
        <span className="home-check" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <span className="home-pill">{sameDay(entry.endedAt, now.getTime()) ? 'Done tonight' : 'Done yesterday'}</span>
      </div>
      <h1 className="home-day home-day-done">Good session, {day}</h1>
      <p className="home-line">{[session.venue, when].filter(Boolean).join(' · ')}</p>
      <dl className="home-stats">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The slim row on the done card: it opens that session's summary. */
export function ViewSummaryRow({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="home-last" onClick={onClick}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M9 12h7M9 16h7" />
      </svg>
      <span className="home-last-text">View summary</span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
}

/** Makes the session's picture and hands it to the share sheet, the same way the summary does. Results stay off. */
export function useSharePicture(session: Session | undefined) {
  const [making, setMaking] = useState(false);
  const [message, setMessage] = useState('');

  async function share() {
    if (!session) return;
    setMaking(true);
    setMessage('');
    try {
      const outcome = await sharePictureFor(session, { results: false, theme: document.documentElement.dataset.theme });
      if (outcome === 'saved') setMessage('Picture saved to this device.');
    } catch {
      setMessage('Could not make the picture.');
    } finally {
      setMaking(false);
    }
  }

  return { making, message, share };
}

