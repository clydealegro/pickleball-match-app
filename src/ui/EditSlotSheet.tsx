import { useState } from 'react';
import { MAX_COURTS, useSlotsStore, type Slot } from '../store/slots';
import { COURTS_KEY, getNumPref } from './prefs';
import { Sheet } from './Sheet';
import { WEEKDAY_NAMES } from './weekdays';

export type SlotScope = 'this-time' | 'always';
export type SlotPatch = Partial<Pick<Slot, 'startMin' | 'endMin' | 'venue' | 'courts'>>;

interface Props {
  slot: Slot;
  /** The slot with this-time-only edits laid over it. The form starts from these values. */
  effective: Slot;
  venues: string[];
  onSave: (patch: SlotPatch, scope: SlotScope) => void;
  onClose: () => void;
}

const toInput = (min?: number) => (min === undefined ? '' : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`);

function fromInput(value: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

/** Edits a slot's time and venue, for this time only or for every week. */
export function EditSlotSheet({ slot, effective, venues, onSave, onClose }: Props) {
  const day = WEEKDAY_NAMES[slot.weekday];
  const addVenue = useSlotsStore((s) => s.addVenue);
  const [start, setStart] = useState(toInput(effective.startMin));
  const [end, setEnd] = useState(toInput(effective.endMin));
  const [venue, setVenue] = useState<string | undefined>(effective.venue);
  const [courts, setCourts] = useState<number | undefined>(effective.courts);
  const [newVenue, setNewVenue] = useState('');
  const [scope, setScope] = useState<SlotScope>('this-time');
  const [error, setError] = useState<string | null>(null);

  // A venue that is chosen always shows, even if the list the sheet was given does not have it yet.
  const chips = venue !== undefined && !venues.includes(venue) ? [...venues, venue] : venues;

  function add() {
    const name = addVenue(newVenue);
    // An empty name means nothing was added (blank, or the list is full), so the choice stays as it was.
    if (!name) return;
    setVenue(name);
    setNewVenue('');
  }

  function save() {
    const startMin = fromInput(start);
    const endMin = fromInput(end);
    if (startMin !== undefined && endMin !== undefined && endMin <= startMin) {
      setError('End time must be after the start.');
      return;
    }
    setError(null);
    onSave({ startMin, endMin, venue, courts }, scope);
  }

  return (
    <Sheet title={`${day}: when and where`} onClose={onClose}>
      <div className="time-row">
        <label className="stack slot-field">
          <span className="muted">Start time</span>
          <input className="field" type="time" aria-label="Start time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="stack slot-field">
          <span className="muted">End time</span>
          <input className="field" type="time" aria-label="End time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>

      <div className="stack">
        <h3 className="section-title">Venue</h3>
        {chips.length > 0 && (
          <div className="options">
            {chips.map((v) => (
              <button
                key={v}
                type="button"
                className={`btn venue-chip${venue === v ? ' is-on' : ''}`}
                aria-pressed={venue === v}
                onClick={() => setVenue(venue === v ? undefined : v)}
              >
                {v}
              </button>
            ))}
          </div>
        )}
        <div className="row-flex">
          <input
            className="field"
            type="text"
            aria-label="New venue"
            placeholder="+ New venue"
            maxLength={40}
            autoComplete="off"
            value={newVenue}
            onChange={(e) => setNewVenue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className="btn" onClick={add}>
            Add venue
          </button>
        </div>
      </div>

      <div className="stack">
        <h3 className="section-title">Courts</h3>
        <div className="stepper" role="group" aria-label="Courts">
          <button
            type="button"
            className="btn"
            aria-label="Fewer courts"
            disabled={courts === undefined}
            // Minus at 1 goes back to not set.
            onClick={() => setCourts((c) => (c === undefined || c <= 1 ? undefined : c - 1))}
          >
            −
          </button>
          <output aria-live="polite">{courts === undefined ? 'Not set' : `${courts} ${courts === 1 ? 'court' : 'courts'}`}</output>
          <button
            type="button"
            className="btn"
            aria-label="More courts"
            disabled={courts !== undefined && courts >= MAX_COURTS}
            // The first plus starts from the courts the organizer used last.
            onClick={() => setCourts((c) => (c === undefined ? getNumPref(COURTS_KEY, 2, 1, MAX_COURTS) : c + 1))}
          >
            +
          </button>
        </div>
      </div>

      <div className="options" role="radiogroup" aria-label="Apply to">
        <label className="option">
          <input type="radio" name="slot-scope" checked={scope === 'this-time'} onChange={() => setScope('this-time')} />
          <span>Just this time</span>
        </label>
        <label className="option">
          <input type="radio" name="slot-scope" checked={scope === 'always'} onChange={() => setScope('always')} />
          <span>Always for {day}</span>
        </label>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn btn-primary btn-block" onClick={save}>
        Save
      </button>
    </Sheet>
  );
}
