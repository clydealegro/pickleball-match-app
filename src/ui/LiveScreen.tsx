import { useMemo, useState } from 'react';
import * as engine from '../engine';
import type { Session } from '../engine';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore, type SessionAction } from '../store/sessionStore';
import { AccountButton } from './AccountButton';
import { AddPlayerSheet } from './AddPlayerSheet';
import { CourtCard } from './CourtCard';
import { CourtTabs } from './CourtTabs';
import { LiveMenu } from './LiveMenu';
import { PlayerSheet } from './PlayerSheet';
import { WaitingSheet } from './WaitingSheet';

export function LiveScreen({ session, onSettings }: { session: Session; onSettings: () => void }) {
  const apply = useSessionStore((s) => s.apply);
  const undo = useSessionStore((s) => s.undo);
  const undoCount = useSessionStore((s) => s.undoStack.length);
  const markPlayed = useRosterStore((s) => s.markPlayed);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [courtId, setCourtId] = useState<string | null>(null);
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
  // A court that is gone (removed once its game ended) falls back to the first one.
  const selected = sorted.find((c) => c.id === courtId) ?? sorted[0];

  return (
    <div className="live-screen">
      <div className="live-header">
        <AccountButton onClick={onSettings} />
        <div className="live-title">
          <h1 className="screen-title">{session.name}</h1>
          <span className="muted">
            {session.history.length} {session.history.length === 1 ? 'game' : 'games'} played
          </span>
        </div>
        <div className="live-actions">
          <button type="button" className="btn btn-small" disabled={undoCount === 0} onClick={undo}>
            Undo
          </button>
          <LiveMenu
            items={[
              { label: 'Add court', onSelect: () => run((s, ctx) => engine.addCourt(s, ctx)) },
              { label: 'Settings', onSelect: onSettings },
              { label: 'End session', onSelect: endSession, danger: true },
            ]}
          />
        </div>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="live-grid">
        <div className="stack">
          {selected && (
            <>
              <CourtTabs courts={sorted} selectedId={selected.id} onSelect={setCourtId} />
              <CourtCard
                key={selected.id}
                court={selected}
                playersById={playersById}
                onFinish={() => run((s, ctx) => engine.finishGame(s, selected.id, ctx))}
                onToggleClosing={() => run((s) => engine.removeCourt(s, selected.id))}
                onSelectPlayer={selectPlayer}
              />
            </>
          )}
        </div>

        <WaitingSheet session={session} onSelect={selectPlayer} onAdd={openAdd} />
      </div>

      {selectedId && (
        <PlayerSheet session={session} playerId={selectedId} onClose={() => setSelectedId(null)} />
      )}
      {adding && <AddPlayerSheet session={session} onClose={() => setAdding(false)} />}
    </div>
  );
}
