import { useState } from 'react';
import type { AttendanceViewData } from '../sync/attendance/types';
import { displayNames } from '../sync/attendance/links';
import { MemberTile } from './MemberTile';
import { JoinSheet } from './MemberSheets';
import type { ActionResult } from './useMemberPage';

interface MemberPickerProps {
  players: AttendanceViewData['players'];
  onPick: (playerId: string) => void;
  onAskToJoin: (name: string) => Promise<ActionResult>;
}

/** Screen 1: tap your own name. */
export function MemberPicker({ players, onPick, onAskToJoin }: MemberPickerProps) {
  const [query, setQuery] = useState('');
  const [asking, setAsking] = useState(false);
  const names = displayNames(players);
  const needle = query.trim().toLowerCase();
  const shown = players.filter((p) => names[p.id].toLowerCase().includes(needle));

  return (
    <section className="member-section" aria-labelledby="member-who">
      <h2 id="member-who" className="member-heading">
        Who are you?
      </h2>
      {players.length === 0 ? (
        <p className="member-note">No names yet. Ask your organizer.</p>
      ) : (
        <>
          <input
            type="search"
            className="member-search"
            aria-label="Search your name"
            placeholder="Search your name"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {shown.length === 0 ? (
            <p className="member-note">No match.</p>
          ) : (
            <ul className="member-grid">
              {shown.map((p) => (
                <li key={p.id}>
                  <button type="button" className="member-pick" onClick={() => onPick(p.id)}>
                    <MemberTile name={names[p.id]} />
                    <span className="member-pick-name">{names[p.id]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <button type="button" className="member-link" onClick={() => setAsking(true)}>
        Not on the list? Ask to join.
      </button>
      <p className="member-note">First names only. No account.</p>
      {asking && <JoinSheet onSubmit={onAskToJoin} onClose={() => setAsking(false)} />}
    </section>
  );
}
