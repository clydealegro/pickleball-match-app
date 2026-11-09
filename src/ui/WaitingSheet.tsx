import { useId, useRef, useState, type KeyboardEvent } from 'react';
import * as engine from '../engine';
import type { Session } from '../engine';
import { PlayerAvatar } from './PlayerAvatar';
import { useFlip } from './useFlip';
import { useIsWide } from './useIsWide';
import { useSheetSwipe } from './useSheetSwipe';

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
  const bodyRef = useRef<HTMLDivElement>(null);

  const waiting = engine.orderedWaiting(session);
  const onBreak = session.players.filter((p) => p.status === 'break');
  // When the order changes, the players who moved travel to their new place.
  // The sheet opening also counts, so the list has a starting place to move from.
  useFlip(bodyRef, `${open}|${waiting.map((p) => p.id).join(',')}|${onBreak.map((p) => p.id).join(',')}`);
  const next = engine.previewNext(session);
  const byId = new Map(session.players.map((p) => [p.id, p]));
  const peek = next ? next.playerIds.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])) : waiting.slice(0, 4);
  const more = Math.max(0, waiting.length - peek.length);
  const nextLabel = waiting.length >= 4 ? 'Next in line' : `Need ${4 - waiting.length} more waiting to fill the next game`;
  // Swiping up on the top of the sheet opens it, swiping down closes it.
  const swipe = useSheetSwipe((direction) => setOpen(direction === 'up'));

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && open) setOpen(false);
  }

  const title = <span id={titleId}>Waiting ({waiting.length})</span>;
  const addButton = (
    <button
      type="button"
      className="btn btn-small sheet-add"
      onClick={(e) => {
        // The top of the sheet toggles it; adding a player must not.
        e.stopPropagation();
        onAdd();
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
      Add player
    </button>
  );

  return (
    <section
      className={`card waiting-sheet${open ? ' is-open' : ''}`}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
    >
      {wide ? (
        <div className="sheet-bar">
          <h2 className="section-title">{title}</h2>
          {addButton}
        </div>
      ) : (
        // The whole top of the sheet opens and closes it. The real button inside is what keyboards and screen readers
        // use; a tap anywhere on the grip, the title, the label or the faces reaches it through this handler.
        <div className="sheet-top" onClick={() => setOpen(!open)} {...swipe}>
          {/* The grip belongs to the whole sheet, so it sits in the middle of it, not of the title button. */}
          <span className="sheet-grip" aria-hidden="true" />
          <div className="sheet-bar">
            <h2 className="sheet-head">
              <button type="button" className="sheet-handle" aria-expanded={open} aria-controls={bodyId}>
                <span className="sheet-handle-title">{title}</span>
              </button>
            </h2>
            {addButton}
          </div>
          <p className="next-label">{nextLabel}</p>
          <div className="peek-row">
            <ul className="peek" aria-label="Next game players">
              {peek.map((p) => (
                <li key={p.id}>
                  <PlayerAvatar name={p.name} rosterId={p.rosterId} size="md" />
                  <span className="peek-name">{firstName(p.name)}</span>
                </li>
              ))}
            </ul>
            {more > 0 && <span className="peek-more">+{more} more</span>}
          </div>
        </div>
      )}

      <div ref={bodyRef} id={bodyId} className="waiting-body">
        {waiting.length === 0 ? (
          <p className="muted">Nobody is waiting.</p>
        ) : (
          <ul className="list" aria-label="Waiting">
            {waiting.map((p, i) => (
              <li key={p.id} data-flip={p.id}>
                <button type="button" className="row-btn" onClick={() => onSelect(p.id)}>
                  <span className="row-index muted" aria-hidden="true">
                    {i + 1}
                  </span>
                  <PlayerAvatar name={p.name} rosterId={p.rosterId} size="sm" />
                  <span className="row-name">{p.name}</span>
                  {session.pinned?.includes(p.id) && <span className="tag">Next</span>}
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
                <li key={p.id} data-flip={p.id}>
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
      </div>
    </section>
  );
}
