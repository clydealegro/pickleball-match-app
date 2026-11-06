import { useState } from 'react';
import * as engine from '../engine';
import type { Session } from '../engine';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { PhotoPanel } from './PhotoPanel';
import { PlayerAvatar } from './PlayerAvatar';
import { Sheet } from './Sheet';

interface Props {
  session: Session;
  playerId: string;
  onClose: () => void;
}

export function PlayerSheet({ session, playerId, onClose }: Props) {
  const apply = useSessionStore((s) => s.apply);
  const [error, setError] = useState<string | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const player = session.players.find((p) => p.id === playerId);
  const saved = useRosterStore((s) => s.players.find((p) => p.id === player?.rosterId));
  if (!player) return null;

  function setStatus(target: engine.StatusTarget) {
    const res = apply((s, ctx) => engine.setPlayerStatus(s, playerId, target, ctx));
    if (res.ok) onClose();
    else setError(res.error);
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
