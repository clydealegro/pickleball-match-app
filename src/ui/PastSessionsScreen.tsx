import { useState } from 'react';
import type { Session } from '../engine';
import { shortDate } from '../store/attendance';
import { useHistoryStore } from '../store/historyStore';
import { SummaryScreen } from './SummaryScreen';

/** `openId` opens that session's summary straight away. Back from it returns to the list. */
export function PastSessionsScreen({ onBack, openId }: { onBack: () => void; openId?: string }) {
  const entries = useHistoryStore((s) => s.entries);
  const loaded = useHistoryStore((s) => s.loaded);
  const persistent = useHistoryStore((s) => s.persistent);
  const [open, setOpen] = useState<Session | null>(null);
  const [listed, setListed] = useState(false);
  // History may still be loading when the screen opens, so the id is looked up on every render.
  const fromId = openId && !listed ? entries.find((e) => e.id === openId)?.session : undefined;
  const shown = open ?? fromId;

  if (shown) {
    return (
      <SummaryScreen
        session={shown}
        onBack={() => {
          setOpen(null);
          setListed(true);
        }}
      />
    );
  }

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
