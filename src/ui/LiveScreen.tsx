import { useCallback, useMemo, useState } from 'react';
import * as engine from '../engine';
import type { Session } from '../engine';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore, type SessionAction } from '../store/sessionStore';
import { AccountButton } from './AccountButton';
import { AddPlayerSheet } from './AddPlayerSheet';
import { CourtCard } from './CourtCard';
import { CourtTabs } from './CourtTabs';
import { finishMessage } from './finishMessage';
import { LiveMenu } from './LiveMenu';
import { PlayerSheet } from './PlayerSheet';
import { getBoolPref, VIBRATE_KEY } from './prefs';
import { Toast } from './Toast';
import { useSwipe } from './useSwipe';
import { WaitingSheet } from './WaitingSheet';

export function LiveScreen({ session, onSettings }: { session: Session; onSettings: () => void }) {
  const apply = useSessionStore((s) => s.apply);
  const undo = useSessionStore((s) => s.undo);
  const undoCount = useSessionStore((s) => s.undoStack.length);
  const markPlayed = useRosterStore((s) => s.markPlayed);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [courtId, setCourtId] = useState<string | null>(null);
  /** Which way the court on show last moved, so the next one slides in from that side. */
  const [slide, setSlide] = useState<'from-right' | 'from-left' | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

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

  /** Finishes a game and says what the court is doing now, with a way back. */
  function finishCourt(courtId: string, courtNumber: number) {
    if (!run((s, ctx) => engine.finishGame(s, courtId, ctx))) return;
    const after = useSessionStore.getState().session;
    if (after) setToast({ id: Date.now(), text: finishMessage(after, courtNumber) });
    // A short buzz where the device can, so a glance away from the screen still knows it registered.
    if (getBoolPref(VIBRATE_KEY, true)) {
      try {
        navigator.vibrate?.(25);
      } catch {
        // Not allowed here: the toast is enough.
      }
    }
  }

  function startCourt(courtId: string) {
    run((s, ctx) => engine.startCourt(s, courtId, ctx));
  }

  function undoLast() {
    undo();
    setToast(null);
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
          <button type="button" className="btn btn-ghost icon-btn" aria-label="Undo" disabled={undoCount === 0} onClick={undoLast}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
            </svg>
          </button>
          <LiveMenu
            items={[
              { label: 'Add player', onSelect: openAdd },
              ...(readyCount >= 2 ? [{ label: 'Start all ready courts', onSelect: () => run((s, ctx) => engine.startAllReady(s, ctx)) }] : []),
              { label: 'Add court', onSelect: () => run((s, ctx) => engine.addCourt(s, ctx)) },
              ...(selected
                ? [
                    {
                      label: selected.closing ? `Keep court ${selected.number} open` : `Remove court ${selected.number}`,
                      onSelect: () => run((s, ctx) => engine.removeCourt(s, selected.id, ctx)),
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
                  onStart={() => startCourt(selected.id)}
                  onSelectPlayer={selectPlayer}
                />
              </div>
              {toast && <Toast id={toast.id} text={toast.text} onUndo={undoLast} onDismiss={dismissToast} />}
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
