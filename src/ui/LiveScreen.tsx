import { useMemo, useState } from 'react';
import * as engine from '../engine';
import type { Session } from '../engine';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore, type SessionAction } from '../store/sessionStore';
import { AddPlayerSheet } from './AddPlayerSheet';
import { CourtCard } from './CourtCard';
import { PlayerSheet } from './PlayerSheet';
import { UpNextCard } from './UpNextCard';
import { WaitingList } from './WaitingList';

export function LiveScreen({ session }: { session: Session }) {
  const apply = useSessionStore((s) => s.apply);
  const undo = useSessionStore((s) => s.undo);
  const undoCount = useSessionStore((s) => s.undoStack.length);
  const markPlayed = useRosterStore((s) => s.markPlayed);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playersById = useMemo(
    () => new Map(session.players.map((p) => [p.id, p])),
    [session.players],
  );

  function selectPlayer(id: string) {
    setError(null);
    setSelectedId(id);
  }

  function openAdd() {
    setError(null);
    setAdding(true);
  }

  function run(action: SessionAction): boolean {
    const res = apply(action);
    setError(res.ok ? null : res.error);
    return res.ok;
  }

  function endSession() {
    if (!window.confirm('End this session? You can start a new one afterwards.')) return;
    const rosterIds = session.players.flatMap((p) => (p.rosterId ? [p.rosterId] : []));
    const ended = run((s, ctx) => engine.endSession(s, ctx));
    // Only record "last played" if the session really ended; roster bookkeeping must never block ending it.
    if (ended) markPlayed(rosterIds, Date.now()).catch(() => {});
  }

  const sorted = [...session.courts].sort((a, b) => a.number - b.number);

  return (
    <div>
      <div className="row-flex spread">
        <h1 className="screen-title">{session.name}</h1>
        <span className="muted">
          {session.history.length} {session.history.length === 1 ? 'game' : 'games'} played
        </span>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="live-grid">
        <div className="courts">
          {sorted.map((court) => (
            <CourtCard
              key={court.id}
              court={court}
              playersById={playersById}
              onFinish={() => run((s, ctx) => engine.finishGame(s, court.id, ctx))}
              onToggleClosing={() => run((s) => engine.removeCourt(s, court.id))}
              onSelectPlayer={selectPlayer}
            />
          ))}
        </div>

        <div className="stack">
          <UpNextCard session={session} />
          <WaitingList session={session} onSelect={selectPlayer} onAdd={openAdd} />
        </div>
      </div>

      <div className="controls">
        <button type="button" className="btn" disabled={undoCount === 0} onClick={undo}>
          Undo
        </button>
        <button type="button" className="btn" onClick={() => run((s, ctx) => engine.addCourt(s, ctx))}>
          Add court
        </button>
        <button type="button" className="btn btn-danger" onClick={endSession}>
          End session
        </button>
      </div>

      {selectedId && (
        <PlayerSheet session={session} playerId={selectedId} onClose={() => setSelectedId(null)} />
      )}
      {adding && <AddPlayerSheet session={session} onClose={() => setAdding(false)} />}
    </div>
  );
}
