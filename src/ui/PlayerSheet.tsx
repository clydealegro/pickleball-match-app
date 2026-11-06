import * as engine from '../engine';
import type { Session } from '../engine';
import { useSessionStore } from '../store/sessionStore';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';

interface Props {
  session: Session;
  playerId: string;
  onClose: () => void;
}

export function PlayerSheet({ session, playerId, onClose }: Props) {
  const apply = useSessionStore((s) => s.apply);
  const player = session.players.find((p) => p.id === playerId);
  if (!player) return null;

  function setStatus(target: engine.StatusTarget) {
    apply((s, ctx) => engine.setPlayerStatus(s, playerId, target, ctx));
    onClose();
  }

  return (
    <Sheet title={player.name} onClose={onClose}>
      <div className="row-flex">
        <Avatar name={player.name} size="lg" />
        <p className="muted">
          {player.gamesPlayed} {player.gamesPlayed === 1 ? 'game' : 'games'} played
          {player.status === 'break' && ' · on break'}
        </p>
      </div>

      {player.pendingStatus && (
        <p>
          {player.pendingStatus === 'break' ? 'Will go on break' : 'Will leave'} when the current game ends.
        </p>
      )}

      {player.pendingStatus ? (
        <button type="button" className="btn btn-block" onClick={() => setStatus('active')}>
          Cancel
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
