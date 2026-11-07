import { useEffect, useRef, useState } from 'react';
import { lastSessionIds } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { getDefaultMode, useDefaultMode } from './matchmaking';
import { PlayerAvatar } from './PlayerAvatar';

const MIN_PLAYERS = 4;
const MAX_COURTS = 12;
const MAX_ADD_ROWS = 5;

interface Props {
  onManage: () => void;
}

export function SetupScreen({ onManage }: Props) {
  const roster = useRosterStore((s) => s.players);
  const addToRoster = useRosterStore((s) => s.add);
  const start = useSessionStore((s) => s.start);

  const [name, setName] = useState('');
  const [courtCount, setCourtCount] = useState(2);
  const [mode] = useDefaultMode();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  // Adds run one after another, so typing on while names are being saved cannot create doubles.
  const adding = useRef<Promise<void>>(Promise.resolve());

  // A start error belongs to the selection it was raised for.
  useEffect(() => {
    setStartError(null);
  }, [selected]);

  const lastIds = lastSessionIds(roster);
  const chosen = roster.filter((p) => selected.has(p.id));
  const canStart = chosen.length >= MIN_PLAYERS;
  const addRows = Math.min(MAX_ADD_ROWS, Math.max(1, draft.split('\n').length));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addPlayers() {
    const lines = draft
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    // Clear the box at once so whatever is typed next starts a fresh entry.
    setDraft('');
    adding.current = adding.current.then(async () => {
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
      setError(failure);
    });
  }

  function startSession() {
    const res = start({
      name,
      mode: getDefaultMode(),
      courtCount,
      players: chosen.map((p) => ({ name: p.name, rosterId: p.id })),
    });
    if (!res.ok) setStartError(res.error);
  }

  return (
    <div className="stack">
      <h1 className="screen-title">New session</h1>

      <section className="card stack">
        <div className="setup-top">
          <div className="setup-name">
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
        </div>
        {mode === 'queue' && <p className="muted setup-note">Simple queue matchmaking. Change it in Settings.</p>}
      </section>

      <section className="card stack">
        <div className="row-flex spread">
          <h2 className="section-title">Players ({chosen.length} selected)</h2>
          <button type="button" className="btn btn-ghost btn-small" onClick={onManage}>
            Manage saved players
          </button>
        </div>

        <form
          className="add-row"
          onSubmit={(e) => {
            e.preventDefault();
            addPlayers();
          }}
        >
          <textarea
            className="field"
            aria-label="Add players"
            rows={addRows}
            placeholder="Add a name, then Enter"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter adds the name; paste a list to add several at once.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                addPlayers();
              }
            }}
          />
          <button type="submit" className="btn">
            Add
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {roster.length > 0 && (
          <>
            <div className="controls quick">
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
                onClick={() => setSelected(new Set(roster.map((p) => p.id)))}
              >
                Select all
              </button>
              {selected.size > 0 && (
                <button type="button" className="btn btn-ghost btn-small" onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              )}
            </div>
            <ul className="pick-grid" aria-label="Saved players">
              {roster.map((p) => (
                <li key={p.id}>
                  <label className="pick">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                    <PlayerAvatar name={p.name} rosterId={p.id} size="sm" />
                    <span className="row-name">{p.name}</span>
                  </label>
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
    </div>
  );
}
