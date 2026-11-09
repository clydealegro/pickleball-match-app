import { useId, useState } from 'react';
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
  /** Opens the places drawer in edit mode, where places are renamed and removed. */
  onEditPlaces?: () => void;
}

const toInput = (min?: number) => (min === undefined ? '' : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`);

function fromInput(value: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

/** Edits a slot's time and venue, for this time only or for every week. */
export function EditSlotSheet({ slot, effective, venues, onSave, onClose, onEditPlaces }: Props) {
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

  const whenId = useId();
  const whereId = useId();

  return (
    <Sheet title={`${day}: when and where`} onClose={onClose}>
      <div className="slot-card" role="group" aria-labelledby={whenId}>
        <p id={whenId} className="slot-label">
          When
        </p>
        <div className="slot-times">
          <label className="slot-time">
            <span className="slot-time-label">Starts</span>
            <input className="field" type="time" aria-label="Start time" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <span className="slot-arrow" aria-hidden="true">
            →
          </span>
          <label className="slot-time">
            <span className="slot-time-label">Ends</span>
            <input className="field" type="time" aria-label="End time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="slot-card" role="group" aria-labelledby={whereId}>
        <div className="slot-where-head">
          <p id={whereId} className="slot-label">
            Where
          </p>
          {onEditPlaces && venues.length > 0 && (
            <button type="button" className="venue-edit-link" onClick={onEditPlaces}>
              Edit places
            </button>
          )}
        </div>
        {chips.length > 0 && (
          <div className="slot-chips">
            {chips.map((v) => (
              <button
                key={v}
                type="button"
                className={`slot-chip${venue === v ? ' is-on' : ''}`}
                aria-pressed={venue === v}
                onClick={() => setVenue(venue === v ? undefined : v)}
              >
                {v}
              </button>
            ))}
          </div>
        )}
        <div className="slot-add">
          <input
            className="field"
            type="text"
            aria-label="New venue"
            placeholder="Add a venue"
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
          <button type="button" className="slot-add-btn" aria-label="Add venue" onClick={add}>
            <span aria-hidden="true">+</span>
          </button>
        </div>
      </div>

      <div className="slot-card slot-courts">
        <div className="slot-courts-row">
          <p className="slot-label">Courts</p>
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
            <output aria-live="polite" className={courts === undefined ? 'is-unset' : undefined}>
              {courts === undefined ? 'Not set' : `${courts} ${courts === 1 ? 'court' : 'courts'}`}
            </output>
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
        {courts === undefined && <p className="muted slot-hint">You choose when you start.</p>}
      </div>

      {/* Stays at the bottom edge while the sheet scrolls, so Save and Just this time or Always are never hidden below the courts. */}
      <div className="sheet-actions">
        <div className="slot-seg" role="radiogroup" aria-label="Apply to">
          <label>
            <input type="radio" name="slot-scope" checked={scope === 'this-time'} onChange={() => setScope('this-time')} />
            <span>Just this time</span>
          </label>
          <label>
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
      </div>
    </Sheet>
  );
}
