import { useId, useState, type ReactNode } from 'react';
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

/** One action: the name of what it does, with a line under it saying what will happen. The line is its description. */
function Action({
  label,
  hint,
  variant,
  onClick,
}: {
  label: string;
  hint?: string;
  variant?: 'primary' | 'danger';
  onClick: () => void;
}) {
  const id = useId();
  return (
    <button
      type="button"
      className={`psheet-action${variant ? ` psheet-${variant}` : ''}`}
      aria-labelledby={`${id}-label`}
      aria-describedby={hint ? `${id}-hint` : undefined}
      onClick={onClick}
    >
      <span id={`${id}-label`} className="psheet-action-label">
        {label}
      </span>
      {hint && (
        <span id={`${id}-hint`} className="psheet-action-hint">
          {hint}
        </span>
      )}
    </button>
  );
}

/** A labelled set of actions. */
function Group({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="psheet-group" role="group" aria-labelledby={id}>
      <p id={id} className="psheet-label">
        {label}
      </p>
      {children}
    </div>
  );
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

  const next = onCourt ? engine.orderedWaiting(session)[0] : undefined;
  const avatar = <PlayerAvatar name={player.name} rosterId={player.rosterId} size="lg" />;
  const where =
    place.kind === 'lineup' || place.kind === 'game'
      ? `Court ${place.courtNumber}, team ${place.team}, ${place.kind === 'lineup' ? 'ready to start' : 'playing now'}`
      : player.status === 'break'
        ? 'On a break'
        : null;

  return (
    <Sheet title={player.name} onClose={onClose}>
      <div className="psheet-head">
        {saved ? (
          <button
            type="button"
            className="avatar-btn psheet-avatar"
            aria-label={saved.photoVersion > 0 ? 'Change photo' : 'Add photo'}
            onClick={() => setPhotoOpen(true)}
          >
            {avatar}
            <span className="cam-badge" aria-hidden="true">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h4l2-3h6l2 3h4v12H3z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
            </span>
          </button>
        ) : (
          avatar
        )}
        <div className="psheet-who">
          {where && <p className="psheet-where">{where}</p>}
          {why && (
            <p className="why-waiting">
              {ordinal(why.position)} in line. {why.reason}
            </p>
          )}
          <p className="psheet-chip">
            {player.gamesPlayed} {player.gamesPlayed === 1 ? 'game' : 'games'}
          </p>
        </div>
      </div>

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
        <Group label="Right now">
          <Action
            variant="primary"
            label="Swap places…"
            hint="Trade with someone waiting or on another court."
            onClick={() => setSwapping(true)}
          />
          <Action
            label="Not here"
            hint={
              next
                ? `${next.name} steps in and ${player.name} goes on a break.`
                : 'Nobody is waiting to take their place.'
            }
            onClick={() =>
              control((s, ctx) => engine.notHere(s, playerId, ctx), `${player.name} not here, the next player steps in`)
            }
          />
        </Group>
      )}

      {place.kind === 'waiting' && (
        <Group label="Right now">
          {pinned ? (
            <p className="why-waiting">Playing next.</p>
          ) : (
            <Action
              variant="primary"
              label="Play next"
              hint="First in line for the next game."
              onClick={() => control((s) => engine.playNext(s, playerId), `${player.name} plays next`)}
            />
          )}
          <Action
            label="Skip this turn"
            hint="Moves to the back of the line."
            onClick={() => control((s) => engine.skipTurn(s, playerId), `${player.name} skipped a turn`)}
          />
          <Action label="Swap onto a court…" onClick={() => setSwapping(true)} />
        </Group>
      )}

      {player.status === 'break' && !player.pendingStatus && (
        <Group label="Right now">
          <Action variant="primary" label="Return to play" onClick={() => setStatus('active')} />
        </Group>
      )}

      <Group label={player.status === 'break' ? 'Leave' : 'Break or leave'}>
        {player.pendingStatus ? (
          <Action label={player.pendingStatus === 'break' ? 'Cancel break' : 'Cancel leaving'} onClick={() => setStatus('active')} />
        ) : player.status !== 'break' && place.kind === 'game' ? (
          <Action label="Break after this game" hint="They finish this game first." onClick={() => setStatus('break')} />
        ) : player.status !== 'break' && place.kind === 'lineup' && !next ? (
          <Action
            label="Take a break"
            hint="Takes them off the court. The court waits for another player."
            onClick={() => setStatus('break')}
          />
        ) : player.status !== 'break' && place.kind === 'waiting' ? (
          <Action label="Take a break" hint="Out until you bring them back." onClick={() => setStatus('break')} />
        ) : null}
        {!player.pendingStatus && (
          <Action variant="danger" label="Leave session" hint="For the rest of this session." onClick={() => setStatus('left')} />
        )}
      </Group>
    </Sheet>
  );
}
