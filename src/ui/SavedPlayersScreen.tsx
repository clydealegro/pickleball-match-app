import { useRef, useState } from 'react';
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
  const listRef = useRef<HTMLUListElement>(null);

  function startEdit(id: string, current: string) {
    setEditingId(id);
    setEditName(current);
    setError(null);
  }

  /** Puts keyboard focus back on a row's Rename button once the edit form is gone. */
  function focusRename(name: string) {
    setTimeout(() => {
      const label = `Rename ${name}`;
      Array.from(listRef.current?.querySelectorAll<HTMLElement>('button[aria-label]') ?? [])
        .find((b) => b.getAttribute('aria-label') === label)
        ?.focus();
    }, 0);
  }

  function cancelEdit(name: string) {
    setEditingId(null);
    setError(null);
    focusRename(name);
  }

  async function saveEdit(id: string) {
    try {
      await rename(id, editName);
      setEditingId(null);
      setError(null);
      focusRename(editName.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rename that player.');
    }
  }

  async function confirmRemove(id: string, name: string) {
    if (!window.confirm(`Remove ${name} from saved players?`)) return;
    try {
      await remove(id);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that player.');
    }
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
        <ul ref={listRef} className="list card" aria-label="Saved players">
          {roster.map((p) => (
            <li key={p.id} className="row-flex spread">
              {editingId === p.id ? (
                <form
                  className="row-flex"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveEdit(p.id);
                  }}
                >
                  <input
                    className="field"
                    aria-label={`New name for ${p.name}`}
                    value={editName}
                    autoFocus
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') cancelEdit(p.name);
                    }}
                  />
                  <button type="submit" className="btn btn-primary btn-small">
                    Save
                  </button>
                  <button type="button" className="btn btn-small" onClick={() => cancelEdit(p.name)}>
                    Cancel
                  </button>
                </form>
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
