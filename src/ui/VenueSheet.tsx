import { useId, useState } from 'react';
import { MAX_VENUE_LENGTH, MAX_VENUES, useSlotsStore, type Slot } from '../store/slots';
import type { SlotPatch, SlotScope } from './EditSlotSheet';
import { Sheet } from './Sheet';
import { WEEKDAY_NAMES } from './weekdays';

/** Past this many saved places a search box shows. */
const SEARCH_FROM = 6;

interface Props {
  slot: Slot;
  /** The slot with this-time-only edits laid over it. */
  effective: Slot;
  venues: string[];
  onSave: (patch: SlotPatch, scope: SlotScope) => void;
  onClose: () => void;
}

/** A short drawer for just the venue: pick a saved place, or save a new one and use it. */
export function VenueSheet({ slot, effective, venues, onSave, onClose }: Props) {
  const day = WEEKDAY_NAMES[slot.weekday];
  const addVenue = useSlotsStore((s) => s.addVenue);
  const [venue, setVenue] = useState<string | undefined>(effective.venue);
  const [newVenue, setNewVenue] = useState('');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SlotScope>('always');
  const [error, setError] = useState<string | null>(null);
  const scopeId = useId();

  // Newest first, and a chosen place always shows even if the list does not have it.
  const all = [...venues].reverse();
  if (venue !== undefined && !all.includes(venue)) all.unshift(venue);
  const shown = query.trim() ? all.filter((v) => v.toLowerCase().includes(query.trim().toLowerCase())) : all;
  const full = venues.length >= MAX_VENUES;
  const changed = newVenue.trim() !== '' || venue !== effective.venue;

  function save() {
    let chosen = venue;
    if (newVenue.trim()) {
      const name = addVenue(newVenue);
      if (!name) {
        setError(full ? `You can save up to ${MAX_VENUES} places. Pick one from the list.` : 'Type a name for the place.');
        return;
      }
      chosen = name;
    }
    onSave({ venue: chosen }, scope);
  }

  return (
    <Sheet title="Where do you play?" onClose={onClose}>
      {all.length > SEARCH_FROM && (
        <input className="field" type="search" aria-label="Search places" placeholder={`Search ${all.length} places`} value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
      {shown.length > 0 && (
        <ul className="venue-list" role="radiogroup" aria-label="Saved places">
          {shown.map((v) => (
            <li key={v}>
              <button
                type="button"
                role="radio"
                aria-checked={venue === v}
                className={`venue-row${venue === v ? ' is-on' : ''}`}
                // Tapping the chosen place again clears it.
                onClick={() => setVenue(venue === v ? undefined : v)}
              >
                <span className="venue-radio" aria-hidden="true" />
                <span className="venue-name">{v}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {all.length > 0 && shown.length === 0 && <p className="muted">No saved place matches.</p>}
      <input
        className="field"
        type="text"
        aria-label="New location"
        placeholder="+ New location"
        maxLength={MAX_VENUE_LENGTH}
        autoComplete="off"
        value={newVenue}
        onChange={(e) => {
          setNewVenue(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            save();
          }
        }}
      />
      <div id={scopeId} className="seg-two" role="radiogroup" aria-label="Applies to">
        <button type="button" role="radio" aria-checked={scope === 'always'} className={scope === 'always' ? 'is-on' : ''} onClick={() => setScope('always')}>
          Every {day}
        </button>
        <button type="button" role="radio" aria-checked={scope === 'this-time'} className={scope === 'this-time' ? 'is-on' : ''} onClick={() => setScope('this-time')}>
          Just this time
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn btn-primary" disabled={!changed} onClick={save}>
        {newVenue.trim() ? 'Save and use' : 'Save'}
      </button>
    </Sheet>
  );
}
