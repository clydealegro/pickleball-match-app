import { useMemo, useRef, useState } from 'react';
import { attendanceByRoster, attendanceLine } from '../store/attendance';
import { useHistoryStore } from '../store/historyStore';
import { useRosterStore } from '../store/rosterStore';
import { PhotoSheet } from './PhotoSheet';
import { PlayerAvatar } from './PlayerAvatar';
import { SyncStatusLine } from './SyncStatusLine';

interface Props {
  onBack: () => void;
}

export function SavedPlayersScreen({ onBack }: Props) {
  const roster = useRosterStore((s) => s.players);
  const history = useHistoryStore((s) => s.entries);
  const attendance = useMemo(() => attendanceByRoster(history), [history]);
  const rename = useRosterStore((s) => s.rename);
  const remove = useRosterStore((s) => s.remove);
  const add = useRosterStore((s) => s.add);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [photoFor, setPhotoFor] = useState<{ id: string; name: string } | null>(null);
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

  async function addPlayer() {
    const name = newName.trim();
    if (!name) return;
    const existing = roster.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      setError(`${existing.name} is already saved.`);
      return;
    }
    try {
      await add(name);
      setNewName('');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that player.');
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
    <div className="stack screen-enter">
      <div className="row-flex spread">
        <h1 className="screen-title">Saved players</h1>
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
      </div>

      <SyncStatusLine />

      <form
        className="add-saved"
        onSubmit={(e) => {
          e.preventDefault();
          void addPlayer();
        }}
      >
        <input
          className="field"
          type="text"
          aria-label="New player name"
          placeholder="Add a player"
          autoComplete="off"
          enterKeyHint="done"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={!newName.trim()}>
          Add
        </button>
      </form>

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
            <li key={p.id} className="saved-row">
              {editingId === p.id ? (
                <form
                  className="edit-form"
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
                  <span className="saved-who">
                    <button
                      type="button"
                      className="avatar-btn"
                      aria-label={`${p.photoVersion > 0 ? 'Change' : 'Add'} photo for ${p.name}`}
                      onClick={() => setPhotoFor({ id: p.id, name: p.name })}
                    >
                      <PlayerAvatar name={p.name} rosterId={p.id} size="md" />
                      {p.photoVersion === 0 && (
                        <span className="cam-badge" aria-hidden="true">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 8h4l2-3h6l2 3h4v12H3z" />
                            <circle cx="12" cy="13" r="3.5" />
                          </svg>
                        </span>
                      )}
                    </button>
                    <span className="saved-name">
                      <span className="row-name">{p.name}</span>
                      <span className="muted saved-att">{attendanceLine(attendance.get(p.id))}</span>
                    </span>
                  </span>
                  <span className="saved-actions">
                    <button
                      type="button"
                      className="icon-action"
                      aria-label={`Rename ${p.name}`}
                      title="Rename"
                      onClick={() => startEdit(p.id, p.name)}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 20h4L19 9l-4-4L4 16z" />
                        <path d="m13.5 6.5 4 4" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="icon-action danger"
                      aria-label={`Remove ${p.name}`}
                      title="Remove"
                      onClick={() => void confirmRemove(p.id, p.name)}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 7h16" />
                        <path d="M9 7V4h6v3" />
                        <path d="M6 7l1 13h10l1-13" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {photoFor && <PhotoSheet rosterId={photoFor.id} name={photoFor.name} onClose={() => setPhotoFor(null)} />}
    </div>
  );
}
