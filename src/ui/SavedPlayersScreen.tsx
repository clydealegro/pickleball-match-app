import { useState } from 'react';
import { useRosterStore } from '../store/rosterStore';
import { Avatar } from './Avatar';

interface Props {
  onBack: () => void;
}

export function SavedPlayersScreen({ onBack }: Props) {
  const roster = useRosterStore((s) => s.players);
  const rename = useRosterStore((s) => s.rename);
  const remove = useRosterStore((s) => s.remove);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function startEdit(id: string, current: string) {
    setEditingId(id);
    setEditName(current);
    setError(null);
  }

  async function saveEdit(id: string) {
    try {
      await rename(id, editName);
      setEditingId(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rename that player.');
    }
  }

  async function confirmRemove(id: string, name: string) {
    if (window.confirm(`Remove ${name} from saved players?`)) await remove(id);
  }

  return (
    <div className="stack">
      <div className="row-flex spread">
        <h1 className="screen-title">Saved players</h1>
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {roster.length === 0 ? (
        <p className="muted">No saved players yet. Players you add to a session are saved here.</p>
      ) : (
        <ul className="list card" aria-label="Saved players">
          {roster.map((p) => (
            <li key={p.id} className="row-flex spread">
              {editingId === p.id ? (
                <>
                  <input
                    className="field"
                    aria-label={`New name for ${p.name}`}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                  <button type="button" className="btn btn-primary btn-small" onClick={() => void saveEdit(p.id)}>
                    Save
                  </button>
                  <button type="button" className="btn btn-small" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="row-flex">
                    <Avatar name={p.name} size="sm" />
                    <span className="row-name">{p.name}</span>
                  </span>
                  <span className="row-flex">
                    <button
                      type="button"
                      className="btn btn-small"
                      aria-label={`Rename ${p.name}`}
                      onClick={() => startEdit(p.id, p.name)}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-danger"
                      aria-label={`Remove ${p.name}`}
                      onClick={() => void confirmRemove(p.id, p.name)}
                    >
                      Remove
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
