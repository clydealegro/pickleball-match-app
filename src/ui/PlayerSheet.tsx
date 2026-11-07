import { useState } from 'react';
import * as engine from '../engine';
import type { Session } from '../engine';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { PhotoPanel } from './PhotoPanel';
import { PlayerAvatar } from './PlayerAvatar';
import { Sheet } from './Sheet';
import { SwapPicker } from './SwapPicker';
import { swapLabel } from './swapLabel';

/** 1st, 2nd, 3rd, 4th, 11th, 21st. */
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

interface Props {
  session: Session;
  playerId: string;
  onClose: () => void;
}

export function PlayerSheet({ session, playerId, onClose }: Props) {
  const apply = useSessionStore((s) => s.apply);
  const [error, setError] = useState<string | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const player = session.players.find((p) => p.id === playerId);
  const saved = useRosterStore((s) => s.players.find((p) => p.id === player?.rosterId));
  if (!player) return null;
  const why = engine.explainWaiting(session, playerId);
  const place = engine.locatePlayer(session, playerId);
  const onCourt = place.kind === 'lineup' || place.kind === 'game';
  const pinned = !!session.pinned?.includes(playerId);

  function setStatus(target: engine.StatusTarget) {
    const verb = target === 'break' ? 'on a break' : target === 'left' ? 'left the session' : 'back in';
    const res = apply((s, ctx) => engine.setPlayerStatus(s, playerId, target, ctx), `${player?.name ?? 'Player'} ${verb}`);
    if (res.ok) onClose();
    else setError(res.error);
  }

  /** Runs one of the control actions, closes the sheet when it worked and shows the engine's reason when it did not. */
  function control(action: (s: Session, ctx: Parameters<Parameters<typeof apply>[0]>[1]) => Session, label: string) {
    const res = apply(action, label);
    if (res.ok) onClose();
    else setError(res.error);
  }

  function swapWith(otherId: string) {
    control((s) => engine.swapPlayers(s, playerId, otherId), swapLabel(session, playerId, otherId));
  }

  if (swapping) {
    return (
      <SwapPicker
        session={session}
        playerId={playerId}
        onPick={swapWith}
        onBack={() => setSwapping(false)}
        onClose={onClose}
      />
    );
  }

  // Photos belong to the saved player, so a session player whose saved entry is gone has no photo to change.
  if (photoOpen && saved) {
    return (
      <Sheet title={player.name} onClose={onClose}>
        <PhotoPanel
          rosterId={saved.id}
          name={player.name}
          doneLabel="Back"
          onDone={() => setPhotoOpen(false)}
        />
      </Sheet>
    );
  }

  return (
    <Sheet title={player.name} onClose={onClose}>
      <div className="row-flex">
        <PlayerAvatar name={player.name} rosterId={player.rosterId} size="lg" />
        <p className="muted">
          {player.gamesPlayed} {player.gamesPlayed === 1 ? 'game' : 'games'} played
          {player.status === 'break' && ' · on break'}
        </p>
      </div>

      {why && (
        <p className="why-waiting">
          {ordinal(why.position)} in line. {why.reason}
        </p>
      )}

      {saved && (
        <button type="button" className="btn btn-block" onClick={() => setPhotoOpen(true)}>
          {saved.photoVersion > 0 ? 'Change photo' : 'Add photo'}
        </button>
      )}

      {player.pendingStatus && (
        <p>
          {player.pendingStatus === 'break' ? 'Will go on break' : 'Will leave'} when the current game ends.
        </p>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {onCourt && (
        <>
          <button type="button" className="btn btn-block" onClick={() => setSwapping(true)}>
            Swap with…
          </button>
          <button
            type="button"
            className="btn btn-block"
            onClick={() =>
              control((s, ctx) => engine.notHere(s, playerId, ctx), `${player.name} not here, the next player steps in`)
            }
          >
            Not here
          </button>
          <p className="muted control-hint">Swaps in the next waiting player and puts {player.name} on a break.</p>
        </>
      )}

      {place.kind === 'waiting' && (
        <>
          {pinned ? (
            <p className="why-waiting">Playing next.</p>
          ) : (
            <button
              type="button"
              className="btn btn-block"
              onClick={() => control((s) => engine.playNext(s, playerId), `${player.name} plays next`)}
            >
              Play next
            </button>
          )}
          <button
            type="button"
            className="btn btn-block"
            onClick={() => control((s) => engine.skipTurn(s, playerId), `${player.name} skipped a turn`)}
          >
            Skip this turn
          </button>
          <button type="button" className="btn btn-block" onClick={() => setSwapping(true)}>
            Swap onto a court…
          </button>
        </>
      )}

      {player.pendingStatus ? (
        <button type="button" className="btn btn-block" onClick={() => setStatus('active')}>
          {player.pendingStatus === 'break' ? 'Cancel break' : 'Cancel leaving'}
        </button>
      ) : player.status === 'break' ? (
        <button type="button" className="btn btn-primary btn-block" onClick={() => setStatus('active')}>
          Return to play
        </button>
      ) : (
        <button type="button" className="btn btn-block" onClick={() => setStatus('break')}>
          Take a break
        </button>
      )}

      {!player.pendingStatus && (
        <button type="button" className="btn btn-block btn-danger" onClick={() => setStatus('left')}>
          Leave session
        </button>
      )}
    </Sheet>
  );
}
