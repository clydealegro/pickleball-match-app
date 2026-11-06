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
  onClose: () => void;
}

export function AddPlayerSheet({ session, onClose }: Props) {
  const apply = useSessionStore((s) => s.apply);
  const roster = useRosterStore((s) => s.players);
  const addToRoster = useRosterStore((s) => s.add);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** A newcomer who is saved but not yet in the session while we take their photo. */
  const [photoFor, setPhotoFor] = useState<{ id: string; name: string } | null>(null);

  const present = session.players.filter((p) => p.status !== 'left');
  const presentRosterIds = new Set(present.flatMap((p) => (p.rosterId ? [p.rosterId] : [])));
  const presentNames = new Set(present.map((p) => p.name.trim().toLowerCase()));
  const candidates = roster.filter(
    (r) => !presentRosterIds.has(r.id) && !presentNames.has(r.name.trim().toLowerCase()),
  );

  function addToSession(playerName: string, rosterId: string) {
    setError(null);
    const res = apply((s, ctx) => engine.addPlayer(s, { name: playerName, rosterId }, ctx));
    if (res.ok) onClose();
    else setError(res.error);
  }

  async function addNew(withPhoto: boolean) {
    setError(null);
    // Checked before anything is saved: a photo taken for someone already in the session would replace theirs.
    if (withPhoto && presentNames.has(name.trim().toLowerCase())) {
      setError(`${name.trim()} is already in this session.`);
      return;
    }
    try {
      const saved = await addToRoster(name);
      if (withPhoto) setPhotoFor({ id: saved.id, name: saved.name });
      else addToSession(saved.name, saved.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that player.');
    }
  }

  if (photoFor) {
    return (
      <Sheet title={`Photo for ${photoFor.name}`} onClose={onClose}>
        <p className="muted">
          {photoFor.name} is saved. If you close this without choosing, add them to the session later from Saved players.
        </p>
        <PhotoPanel
          rosterId={photoFor.id}
          name={photoFor.name}
          doneLabel="Add without a photo"
          onDone={() => addToSession(photoFor.name, photoFor.id)}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </Sheet>
    );
  }

  return (
    <Sheet title="Add player" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void addNew(false);
        }}
      >
        <label className="label" htmlFor="new-player-name">
          New player name
        </label>
        <input
          id="new-player-name"
          className="field"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          Add to session
        </button>
        <button type="button" className="btn" disabled={!name.trim()} onClick={() => void addNew(true)}>
          Add with photo
        </button>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {candidates.length > 0 && (
        <>
          <h3 className="section-title muted">Saved players</h3>
          <ul className="list" aria-label="Saved players not in this session">
            {candidates.map((r) => (
              <li key={r.id}>
                <button type="button" className="row-btn" onClick={() => addToSession(r.name, r.id)}>
                  <PlayerAvatar name={r.name} rosterId={r.id} size="sm" />
                  <span className="row-name">{r.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}
