import { useEffect, useRef, useState } from 'react';
import { lastSessionIds } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { getDefaultMode, useDefaultMode } from './matchmaking';
import { COURTS_KEY, getNumPref, setNumPref } from './prefs';
import { PlayerAvatar } from './PlayerAvatar';

const MIN_PLAYERS = 4;
const MAX_COURTS = 12;

interface Props {
  onManage: () => void;
}

const norm = (name: string) => name.trim().toLowerCase();

/** "Saturday open play": enough to tell sessions apart without asking for a name. */
function defaultSessionName(now = new Date()): string {
  return `${now.toLocaleDateString('en', { weekday: 'long' })} open play`;
}

export function SetupScreen({ onManage }: Props) {
  const roster = useRosterStore((s) => s.players);
  const addToRoster = useRosterStore((s) => s.add);
  const start = useSessionStore((s) => s.start);
  const [mode] = useDefaultMode();

  const [courtCount, setCourtCount] = useState(() => getNumPref(COURTS_KEY, 2, 1, MAX_COURTS));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  // Adds run one after another, so typing on while a name is being saved cannot create doubles.
  const adding = useRef<Promise<void>>(Promise.resolve());

  // A start error belongs to the selection it was raised for.
  useEffect(() => {
    setStartError(null);
  }, [selected]);

  const lastIds = lastSessionIds(roster);
  const chosen = roster.filter((p) => selected.has(p.id));
  const canStart = chosen.length >= MIN_PLAYERS;
  const typed = query.trim();
  const exact = roster.find((p) => norm(p.name) === norm(typed));
  const shown = typed ? roster.filter((p) => norm(p.name).includes(norm(typed))) : roster;
  const canAdd = typed !== '' && !exact;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Saves each name and picks it. Names that already exist are just picked. */
  function addNames(names: string[]) {
    const lines = names.map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
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

  function submitQuery() {
    if (!typed) return;
    // Enter picks the player the typing points at, or adds a new one.
    if (exact) setSelected((prev) => new Set(prev).add(exact.id));
    else addNames([typed]);
    setQuery('');
  }

  function startSession() {
    const res = start({
      name: defaultSessionName(),
      mode: getDefaultMode(),
      courtCount,
      players: chosen.map((p) => ({ name: p.name, rosterId: p.id })),
    });
    if (res.ok) setNumPref(COURTS_KEY, courtCount);
    else setStartError(res.error);
  }

  return (
    <div className="stack setup">
      <div className="setup-head">
        <h1 className="screen-title">Who’s playing?</h1>
        <span className="setup-count" aria-live="polite">
          {chosen.length} selected
        </span>
      </div>

      <input
        className="field"
        type="text"
        aria-label="Search or add players"
        placeholder={roster.length > 0 ? 'Search or add a name' : 'Add a name, then press Enter'}
        autoComplete="off"
        enterKeyHint="done"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitQuery();
          }
        }}
        onPaste={(e) => {
          // A pasted list becomes one player per line.
          const text = e.clipboardData.getData('text');
          if (!text.includes('\n')) return;
          e.preventDefault();
          addNames(text.split('\n'));
          setQuery('');
        }}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {roster.length === 0 && <p className="muted setup-note">Add the people who play regularly. They are saved for next time.</p>}
      {mode === 'queue' && <p className="muted setup-note">Simple queue matchmaking. Change it in Settings.</p>}

      {roster.length > 0 && (
        <div className="quick">
          {lastIds.length > 0 && (
            <button type="button" className="btn btn-small" onClick={() => setSelected(new Set(lastIds))}>
              Same as last time ({lastIds.length})
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setSelected(new Set(roster.map((p) => p.id)))}>
            Select all
          </button>
          {selected.size > 0 && (
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          )}
        </div>
      )}

      {(shown.length > 0 || canAdd) && (
        <ul className="pick-grid" aria-label="Saved players">
          {canAdd && (
            <li>
              <button type="button" className="pick pick-add" onClick={submitQuery}>
                + Add “{typed}”
              </button>
            </li>
          )}
          {shown.map((p) => (
            <li key={p.id}>
              <label className="pick">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                <PlayerAvatar name={p.name} rosterId={p.id} size="sm" />
                <span className="row-name">{p.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {typed !== '' && shown.length === 0 && !canAdd && <p className="muted">No one matches.</p>}

      {roster.length > 0 && (
        <button type="button" className="btn btn-ghost btn-small edit-players" onClick={onManage}>
          Edit players
        </button>
      )}

      <div className="sticky-bar start-bar">
        <div className="start-row">
          <div className="stepper stepper-sm" role="group" aria-label="Courts">
            <button
              type="button"
              className="btn"
              aria-label="Fewer courts"
              disabled={courtCount <= 1}
              onClick={() => setCourtCount((c) => c - 1)}
            >
              −
            </button>
            <output aria-live="polite" aria-label="Courts">
              <span className="stepper-value">{courtCount}</span>
              <span className="stepper-caption">{courtCount === 1 ? 'court' : 'courts'}</span>
            </output>
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
          <button
            type="button"
            className={`btn btn-block start-btn${canStart ? ' btn-live' : ''}`}
            disabled={!canStart}
            onClick={startSession}
          >
            {canStart ? `Start ${chosen.length} players` : `Pick at least ${MIN_PLAYERS}`}
          </button>
        </div>
        {startError && (
          <p className="error" role="alert">
            {startError}
          </p>
        )}
      </div>
    </div>
  );
}
