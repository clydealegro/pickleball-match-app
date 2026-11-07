import type { KeyboardEvent } from 'react';
import type { Court } from '../engine';
import { Timer } from './Timer';

export const courtTabId = (courtId: string) => `court-tab-${courtId}`;
export const courtPanelId = (courtId: string) => `court-panel-${courtId}`;

interface Props {
  courts: Court[];
  selectedId: string;
  onSelect: (id: string) => void;
}

/** One tab per court. Each shows its own game clock, so a game finishing on another court is not out of sight. */
export function CourtTabs({ courts, selectedId, onSelect }: Props) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = courts.findIndex((c) => c.id === selectedId);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % courts.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + courts.length) % courts.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = courts.length - 1;
    else return;
    event.preventDefault();
    onSelect(courts[next].id);
    document.getElementById(courtTabId(courts[next].id))?.focus();
  }

  return (
    <div role="tablist" aria-label="Courts" className="court-tabs" onKeyDown={onKeyDown}>
      {courts.map((court) => {
        const selected = court.id === selectedId;
        return (
          <button
            key={court.id}
            type="button"
            role="tab"
            id={courtTabId(court.id)}
            aria-selected={selected}
            aria-controls={courtPanelId(court.id)}
            tabIndex={selected ? 0 : -1}
            className={`court-tab${selected ? ' is-selected' : ''}${court.game ? ' is-live' : ''}${court.status === 'ready' ? ' is-ready' : ''}`}
            onClick={() => onSelect(court.id)}
          >
            <span className="court-tab-name">Court {court.number}</span>
            {court.game ? (
              <Timer startedAt={court.game.startedAt} labelled={false} />
            ) : (
              <span className="court-tab-state">{court.status === 'ready' ? 'Ready' : 'Open'}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
