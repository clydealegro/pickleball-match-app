import { useId, useState, type KeyboardEvent } from 'react';
import * as engine from '../engine';
import type { Session } from '../engine';
import { PlayerAvatar } from './PlayerAvatar';
import { useIsWide } from './useIsWide';

interface Props {
  session: Session;
  onSelect: (id: string) => void;
  onAdd: () => void;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * Who is waiting. On a phone it is a sheet at the bottom of the screen that peeks the next game's four players and
 * opens to the whole list; on a wide screen it is an ordinary panel beside the court.
 */
export function WaitingSheet({ session, onSelect, onAdd }: Props) {
  const wide = useIsWide();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const bodyId = useId();

  const waiting = engine.orderedWaiting(session);
  const onBreak = session.players.filter((p) => p.status === 'break');
  const next = engine.previewNext(session);
  const byId = new Map(session.players.map((p) => [p.id, p]));
  const peek = next ? next.playerIds.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])) : waiting.slice(0, 4);
  const nextLabel = next
    ? `Next game, court ${next.courtNumber}`
    : waiting.length >= 4
      ? 'No open court to play on'
      : `Need ${4 - waiting.length} more waiting to fill the next game`;

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && open) setOpen(false);
  }

  const title = <span id={titleId}>Waiting ({waiting.length})</span>;

  return (
    <section
      className={`card waiting-sheet${open ? ' is-open' : ''}`}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
    >
      {wide ? (
        <h2 className="section-title">{title}</h2>
      ) : (
        <h2 className="sheet-head">
          <button type="button" className="sheet-handle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
            <span className="sheet-grip" aria-hidden="true" />
            <span className="sheet-handle-title">{title}</span>
            <span className="sheet-chevron" aria-hidden="true">
              {open ? '⌄' : '⌃'}
            </span>
          </button>
          <button type="button" className="btn btn-ghost icon-btn sheet-add" aria-label="Add player" onClick={onAdd}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </h2>
      )}

      <p className="next-label">{nextLabel}</p>
      <ul className="peek" aria-label="Next game players">
        {peek.map((p) => (
          <li key={p.id}>
            <PlayerAvatar name={p.name} rosterId={p.rosterId} size="md" />
            <span className="peek-name">{firstName(p.name)}</span>
          </li>
        ))}
      </ul>

      <div id={bodyId} className="waiting-body">
        {waiting.length === 0 ? (
          <p className="muted">Nobody is waiting.</p>
        ) : (
          <ul className="list" aria-label="Waiting">
            {waiting.map((p, i) => (
              <li key={p.id}>
                <button type="button" className="row-btn" onClick={() => onSelect(p.id)}>
                  <span className="row-index muted" aria-hidden="true">
                    {i + 1}
                  </span>
                  <PlayerAvatar name={p.name} rosterId={p.rosterId} size="sm" />
                  <span className="row-name">{p.name}</span>
                  <span className="badge">
                    {p.gamesPlayed}
                    <span className="sr-only"> games played</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {onBreak.length > 0 && (
          <>
            <h3 className="section-title muted">On break</h3>
            <ul className="list" aria-label="On break">
              {onBreak.map((p) => (
                <li key={p.id}>
                  <button type="button" className="row-btn" onClick={() => onSelect(p.id)}>
                    <PlayerAvatar name={p.name} rosterId={p.rosterId} size="sm" />
                    <span className="row-name">{p.name}</span>
                    <span className="badge">
                      {p.gamesPlayed}
                      <span className="sr-only"> games played</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <button type="button" className="dashed" onClick={onAdd}>
          + Add player
        </button>
      </div>
    </section>
  );
}
