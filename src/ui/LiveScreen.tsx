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
import { getBoolPref, VIBRATE_KEY } from './prefs';
import { UndoBar } from './UndoBar';
import { useSwipe } from './useSwipe';
import { WaitingSheet } from './WaitingSheet';

export function LiveScreen({ session, onSettings }: { session: Session; onSettings: () => void }) {
  const apply = useSessionStore((s) => s.apply);
  const undo = useSessionStore((s) => s.undo);
  const undoCount = useSessionStore((s) => s.undoStack.length);
  const lastAction = useSessionStore((s) => s.lastAction);
  const markPlayed = useRosterStore((s) => s.markPlayed);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [courtId, setCourtId] = useState<string | null>(null);
  /** Which way the court on show last moved, so the next one slides in from that side. */
  const [slide, setSlide] = useState<'from-right' | 'from-left' | null>(null);
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

  function run(action: SessionAction, label?: string): boolean {
    const res = apply(action, label);
    setError(res.ok ? null : res.error);
    return res.ok;
  }

  /** Finishes a game, with a way back, and buzzes where the device allows. */
  function finishCourt(courtId: string, courtNumber: number) {
    if (!run((s, ctx) => engine.finishGame(s, courtId, ctx), `Game finished on Court ${courtNumber}`)) return;
    // A short buzz where the device can, so a glance away from the screen still knows it registered.
    if (getBoolPref(VIBRATE_KEY, true)) {
      try {
        navigator.vibrate?.(25);
      } catch {
        // Not allowed here: the bar under the court is enough.
      }
    }
  }

  function startCourt(courtId: string, courtNumber: number) {
    run((s, ctx) => engine.startCourt(s, courtId, ctx), `Started Court ${courtNumber}`);
  }

  function endSession() {
    if (!window.confirm('End this session? You can start a new one afterwards.')) return;
    const rosterIds = session.players.flatMap((p) => (p.rosterId ? [p.rosterId] : []));
    const ended = run((s, ctx) => engine.endSession(s, ctx));
    // Only record "last played" if the session really ended; roster bookkeeping must never block ending it.
    if (ended) markPlayed(rosterIds, Date.now()).catch(() => {});
  }

  const sorted = [...session.courts].sort((a, b) => a.number - b.number);
  const readyCount = sorted.filter((c) => c.status === 'ready').length;
  // A court that is gone (removed once its game ended) falls back to the first one.
  const selected = sorted.find((c) => c.id === courtId) ?? sorted[0];

  /** Shows another court, sliding it in from the side it sits on. */
  function showCourt(id: string) {
    const from = sorted.findIndex((c) => c.id === selected?.id);
    const to = sorted.findIndex((c) => c.id === id);
    if (to === from || to < 0) return;
    setSlide(to > from ? 'from-right' : 'from-left');
    setCourtId(id);
  }

  // Swiping left brings the next court in from the right, swiping right the one before. It stops at the first and last.
  const swipe = useSwipe((direction) => {
    const index = sorted.findIndex((c) => c.id === selected?.id);
    const target = sorted[index + (direction === 'left' ? 1 : -1)];
    if (target) showCourt(target.id);
  });

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
          <LiveMenu
            items={[
              ...(undoCount > 0 ? [{ label: lastAction ? `Undo: ${lastAction.label}` : 'Undo last action', onSelect: undo }] : []),
              { label: 'Add player', onSelect: openAdd },
              ...(readyCount >= 2 ? [{ label: 'Start all ready courts', onSelect: () => run((s, ctx) => engine.startAllReady(s, ctx), 'Started all ready courts') }] : []),
              { label: 'Add court', onSelect: () => run((s, ctx) => engine.addCourt(s, ctx), 'Court added') },
              ...(selected
                ? [
                    {
                      label: selected.closing ? `Keep court ${selected.number} open` : `Remove court ${selected.number}`,
                      onSelect: () =>
                        run(
                          (s, ctx) => engine.removeCourt(s, selected.id, ctx),
                          selected.closing
                            ? `Court ${selected.number} will stay open`
                            : selected.status === 'playing'
                              ? `Court ${selected.number} will close after its game`
                              : `Court ${selected.number} removed`,
                        ),
                    },
                  ]
                : []),
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
              <CourtTabs courts={sorted} selectedId={selected.id} onSelect={showCourt} />
              <div key={selected.id} className={`court-slot${slide ? ` slide-${slide}` : ''}`} {...swipe}>
                <CourtCard
                  court={selected}
                  playersById={playersById}
                  onFinish={() => finishCourt(selected.id, selected.number)}
                  onStart={() => startCourt(selected.id, selected.number)}
                  onSelectPlayer={selectPlayer}
                />
              </div>
              <UndoBar />
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
