import { useState } from 'react';
import * as engine from '../engine';
import type { Session } from '../engine';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { Avatar } from './Avatar';
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

  const inSession = new Set(
    session.players.filter((p) => p.status !== 'left').map((p) => p.name.trim().toLowerCase()),
  );
  const candidates = roster.filter((r) => !inSession.has(r.name.trim().toLowerCase()));

  function addToSession(playerName: string, rosterId: string) {
    const res = apply((s, ctx) => engine.addPlayer(s, { name: playerName, rosterId }, ctx));
    if (res.ok) onClose();
    else setError(res.error);
  }

  async function addNew() {
    try {
      const saved = await addToRoster(name);
      addToSession(saved.name, saved.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that player.');
    }
  }

  return (
    <Sheet title="Add player" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void addNew();
        }}
      >
        <label className="label" htmlFor="new-player-name">
          New player name
        </label>
        <input
          id="new-player-name"
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          Add to session
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
                  <Avatar name={r.name} size="sm" />
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
