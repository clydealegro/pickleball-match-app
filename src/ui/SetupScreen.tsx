import { useEffect, useState } from 'react';
import type { Mode } from '../engine';
import { lastSessionIds } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { PhotoSheet } from './PhotoSheet';
import { PlayerAvatar } from './PlayerAvatar';

const MIN_PLAYERS = 4;
const MAX_COURTS = 12;

interface Props {
  onManage: () => void;
}

export function SetupScreen({ onManage }: Props) {
  const roster = useRosterStore((s) => s.players);
  const addToRoster = useRosterStore((s) => s.add);
  const start = useSessionStore((s) => s.start);

  const [name, setName] = useState('');
  const [courtCount, setCourtCount] = useState(2);
  const [mode, setMode] = useState<Mode>('fairness');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [photoFor, setPhotoFor] = useState<{ id: string; name: string } | null>(null);

  // A start error belongs to the selection it was raised for.
  useEffect(() => {
    setStartError(null);
  }, [selected]);

  const lastIds = lastSessionIds(roster);
  const chosen = roster.filter((p) => selected.has(p.id));
  const canStart = chosen.length >= MIN_PLAYERS;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addPlayers() {
    const lines = draft
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    const ids: string[] = [];
    let failure: string | null = null;
    for (const line of lines) {
      try {
        ids.push((await addToRoster(line)).id);
      } catch (e) {
        failure = e instanceof Error ? e.message : 'Could not add that player.';
      }
    }
    setSelected((prev) => new Set([...prev, ...ids]));
    setDraft('');
    setError(failure);
  }

  function startSession() {
    const res = start({
      name,
      mode,
      courtCount,
      players: chosen.map((p) => ({ name: p.name, rosterId: p.id })),
    });
    if (!res.ok) setStartError(res.error);
  }

  return (
    <div className="stack">
      <h1 className="screen-title">New session</h1>

      <section className="card stack">
        <div>
          <label className="label" htmlFor="session-name">
            Session name
          </label>
          <input
            id="session-name"
            className="field"
            value={name}
            placeholder="Open play"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <span className="label" id="courts-label">
            Courts
          </span>
          <div className="stepper" role="group" aria-labelledby="courts-label">
            <button
              type="button"
              className="btn"
              aria-label="Fewer courts"
              disabled={courtCount <= 1}
              onClick={() => setCourtCount((c) => c - 1)}
            >
              −
            </button>
            <output aria-live="polite">{courtCount}</output>
            <button
              type="button"
              className="btn"
              aria-label="More courts"
              disabled={courtCount >= MAX_COURTS}
              onClick={() => setCourtCount((c) => c + 1)}
            >
              +
            </button>
          </div>
        </div>

        <fieldset>
          <legend className="label">Matchmaking</legend>
          <div className="options">
            <label className="option">
              <input
                type="radio"
                name="mode"
                checked={mode === 'fairness'}
                onChange={() => setMode('fairness')}
              />
              <span>Fairness (recommended)</span>
            </label>
            <label className="option">
              <input
                type="radio"
                name="mode"
                checked={mode === 'queue'}
                onChange={() => setMode('queue')}
              />
              <span>Simple queue</span>
            </label>
          </div>
        </fieldset>
      </section>

      <section className="card stack">
        <div className="row-flex spread">
          <h2 className="section-title">Players ({chosen.length} selected)</h2>
          <button type="button" className="btn btn-ghost btn-small" onClick={onManage}>
            Manage saved players
          </button>
        </div>

        <div className="stack">
          <label className="label" htmlFor="add-players">
            Add players
          </label>
          <textarea
            id="add-players"
            className="field"
            rows={3}
            placeholder={'One name per line\nAnn\nBen'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="button" className="btn" onClick={() => void addPlayers()}>
            Add
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>

        {roster.length > 0 && (
          <>
            <div className="controls">
              <button
                type="button"
                className="btn btn-small"
                onClick={() => setSelected(new Set(roster.map((p) => p.id)))}
              >
                Select all
              </button>
              <button
                type="button"
                className="btn btn-small"
                disabled={lastIds.length === 0}
                onClick={() => setSelected(new Set(lastIds))}
              >
                Same as last session
              </button>
              <button
                type="button"
                className="btn btn-small"
                disabled={selected.size === 0}
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            </div>
            <ul className="list" aria-label="Saved players">
              {roster.map((p) => (
                <li key={p.id} className="has-action">
                  <label className="check">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                    <span>
                      <PlayerAvatar name={p.name} rosterId={p.id} size="sm" />
                      <span className="row-name">{p.name}</span>
                    </span>
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    aria-label={`${p.photoVersion > 0 ? 'Change' : 'Add'} photo for ${p.name}`}
                    onClick={() => setPhotoFor({ id: p.id, name: p.name })}
                  >
                    {p.photoVersion > 0 ? 'Change photo' : 'Add photo'}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="sticky-bar">
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={!canStart}
          onClick={startSession}
        >
          {canStart ? `Start session (${chosen.length} players)` : 'Start session'}
        </button>
        {startError && (
          <p className="error" role="alert">
            {startError}
          </p>
        )}
        {!canStart && <p className="muted">Select at least {MIN_PLAYERS} players to start.</p>}
      </div>
      {photoFor && <PhotoSheet rosterId={photoFor.id} name={photoFor.name} onClose={() => setPhotoFor(null)} />}
    </div>
  );
}
