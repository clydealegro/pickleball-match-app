import { useState } from 'react';
import type { Session } from '../engine';
import { shortDate } from '../store/attendance';
import { useHistoryStore } from '../store/historyStore';
import { SummaryScreen } from './SummaryScreen';

export function PastSessionsScreen({ onBack }: { onBack: () => void }) {
  const entries = useHistoryStore((s) => s.entries);
  const loaded = useHistoryStore((s) => s.loaded);
  const persistent = useHistoryStore((s) => s.persistent);
  const [open, setOpen] = useState<Session | null>(null);

  if (open) return <SummaryScreen session={open} onBack={() => setOpen(null)} />;

  return (
    <div className="stack">
      <div className="row-flex spread">
        <h1 className="screen-title">Past sessions</h1>
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
      </div>
      {!persistent && <p className="muted">This browser cannot keep history, so these are forgotten when the app closes.</p>}
      {loaded && entries.length === 0 ? (
        <p className="muted">Nothing here yet. A session shows up here once you end it.</p>
      ) : (
        <ul className="list card" aria-label="Past sessions">
          {entries.map((e) => (
            <li key={e.id}>
              <button type="button" className="past-row" onClick={() => setOpen(e.session)}>
                <span className="row-name">{e.name}</span>
                <span className="muted">
                  {shortDate(e.endedAt)} · {e.session.venue ? `${e.session.venue} · ` : ''}{e.games} {e.games === 1 ? 'game' : 'games'} · {e.session.players.length} players
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
