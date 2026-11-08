import { useState } from 'react';
import type { Session } from '../engine';
import { shortDate } from '../store/attendance';
import { useHistoryStore } from '../store/historyStore';
import { SummaryScreen } from './SummaryScreen';

interface Props {
  onBack: () => void;
  /** Opens that session's summary straight away. Back from it returns to the list. */
  openId?: string;
  /** With these two the app owns which summary is open, so the browser history can follow it. */
  onOpen?: (id: string) => void;
  onCloseSummary?: () => void;
}

export function PastSessionsScreen({ onBack, openId, onOpen, onCloseSummary }: Props) {
  const entries = useHistoryStore((s) => s.entries);
  const loaded = useHistoryStore((s) => s.loaded);
  const persistent = useHistoryStore((s) => s.persistent);
  const [open, setOpen] = useState<Session | null>(null);
  const [listed, setListed] = useState(false);
  // History may still be loading when the screen opens, so the id is looked up on every render.
  const owned = onOpen !== undefined;
  const fromId = openId && (owned || !listed) ? entries.find((e) => e.id === openId)?.session : undefined;
  const shown = owned ? fromId : (open ?? fromId);

  if (shown) {
    return (
      <SummaryScreen
        session={shown}
        onBack={() => {
          if (onCloseSummary) return onCloseSummary();
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
              <button type="button" className="past-row" onClick={() => (onOpen ? onOpen(e.id) : setOpen(e.session))}>
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
