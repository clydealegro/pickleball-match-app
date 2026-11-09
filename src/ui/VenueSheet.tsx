import { useEffect, useId, useRef, useState } from 'react';
import { MAX_VENUE_LENGTH, MAX_VENUES, useSlotsStore, type Slot } from '../store/slots';
import type { SlotPatch, SlotScope } from './EditSlotSheet';
import { Sheet } from './Sheet';
import { WEEKDAY_NAMES } from './weekdays';

/** Past this many saved places a search box shows. */
const SEARCH_FROM = 6;
/** How long Undo stays on screen after a place is removed. */
const UNDO_MS = 6000;

interface Props {
  slot: Slot;
  /** The slot with this-time-only edits laid over it. */
  effective: Slot;
  venues: string[];
  onSave: (patch: SlotPatch, scope: SlotScope) => void;
  onClose: () => void;
  /** Opens in edit mode, for the Edit link in the full sheet. */
  initialEdit?: boolean;
}

/** "Tuesday", "Tuesday and Thursday", "Tuesday, Thursday and Saturday". */
function dayList(days: string[]): string {
  return days.length <= 1 ? days.join('') : `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`;
}

const Icon = ({ d }: { d: string[] }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d.map((p) => (
      <path key={p} d={p} />
    ))}
  </svg>
);
const PENCIL = ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'];
const BIN = ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'];
const TICK = ['M5 12l5 5L20 7'];
const CROSS = ['M6 6l12 12', 'M18 6L6 18'];

/**
 * A short drawer for just the venue. Pick a saved place, or save a new one and use it. Edit mode renames and removes
 * saved places: a rename also updates the days that use it, and a removed place stays on the days that use it.
 */
export function VenueSheet({ slot, effective, venues, onSave, onClose, initialEdit = false }: Props) {
  const day = WEEKDAY_NAMES[slot.weekday];
  const addVenue = useSlotsStore((s) => s.addVenue);
  const renameVenue = useSlotsStore((s) => s.renameVenue);
  const removeVenue = useSlotsStore((s) => s.removeVenue);
  const restoreVenue = useSlotsStore((s) => s.restoreVenue);
  const slots = useSlotsStore((s) => s.slots);
  const tonight = useSlotsStore((s) => s.tonight);
  const [editing, setEditing] = useState(initialEdit && venues.length > 0);
  const [venue, setVenue] = useState<string | undefined>(effective.venue);
  const [newVenue, setNewVenue] = useState('');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SlotScope>('always');
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ from: string; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ name: string; index: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scopeId = useId();
  useEffect(() => () => clearTimeout(timer.current), []);

  // Newest first. A chosen place always shows when picking, even if the saved list does not have it.
  const saved = [...venues].reverse();
  const all = [...saved];
  if (venue !== undefined && !all.includes(venue)) all.unshift(venue);
  const shown = query.trim() ? all.filter((v) => v.toLowerCase().includes(query.trim().toLowerCase())) : all;
  const full = venues.length >= MAX_VENUES;
  const changed = newVenue.trim() !== '' || venue !== effective.venue;

  /** The days that use a place: saved days, and days with a this-time-only venue. */
  const daysUsing = (name: string) =>
    slots
      .filter((s) => (tonight[s.id]?.venue ?? s.venue) === name || s.venue === name)
      .sort((a, b) => a.weekday - b.weekday)
      .map((s) => WEEKDAY_NAMES[s.weekday]);

  function addNew(): string | undefined {
    const name = addVenue(newVenue);
    if (!name) {
      setError(full ? `You can save up to ${MAX_VENUES} places. Remove one first.` : 'Type a name for the place.');
      return undefined;
    }
    setNewVenue('');
    return name;
  }

  function save() {
    let chosen = venue;
    if (newVenue.trim()) {
      chosen = addNew();
      if (chosen === undefined) return;
    }
    onSave({ venue: chosen }, scope);
  }

  function finishRename() {
    if (!renaming) return;
    const text = renaming.text.trim();
    if (!text) {
      setError('Type a name for the place.');
      return;
    }
    const stored = renameVenue(renaming.from, text);
    if (!stored) {
      setError('Another place already has that name.');
      return;
    }
    if (venue === renaming.from) setVenue(stored);
    setRenaming(null);
    setError(null);
  }

  function remove(name: string) {
    const index = removeVenue(name);
    setConfirm(null);
    if (index < 0) return;
    setUndo({ name, index });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setUndo(null), UNDO_MS);
  }

  function undoRemove() {
    if (!undo) return;
    restoreVenue(undo.name, undo.index);
    setUndo(null);
    clearTimeout(timer.current);
  }

  const toggle = (
    <div className="venue-bar">
      <button
        type="button"
        className="venue-edit-link"
        onClick={() => {
          setEditing((e) => !e);
          setRenaming(null);
          setError(null);
        }}
      >
        {editing ? 'Done' : 'Edit'}
      </button>
    </div>
  );

  const newField = (
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
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (editing) addNew();
        else save();
      }}
    />
  );

  return (
    <Sheet title={editing ? 'Edit places' : 'Where do you play?'} onClose={onClose}>
      {venues.length > 0 && toggle}
      {editing ? (
        <>
          <ul className="venue-list venue-list-edit" aria-label="Saved places">
            {saved.map((v) => (
              <li key={v} className="venue-row venue-row-edit">
                {renaming?.from === v ? (
                  <>
                    <input
                      className="field venue-rename"
                      aria-label={`New name for ${v}`}
                      maxLength={MAX_VENUE_LENGTH}
                      autoComplete="off"
                      autoFocus
                      value={renaming.text}
                      onChange={(e) => {
                        setRenaming({ from: v, text: e.target.value });
                        setError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          finishRename();
                        }
                      }}
                    />
                    <button type="button" className="venue-icon" aria-label="Save name" onClick={finishRename}>
                      <Icon d={TICK} />
                    </button>
                    <button
                      type="button"
                      className="venue-icon"
                      aria-label="Cancel rename"
                      onClick={() => {
                        setRenaming(null);
                        setError(null);
                      }}
                    >
                      <Icon d={CROSS} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="venue-name">{v}</span>
                    <button type="button" className="venue-icon" aria-label={`Rename ${v}`} onClick={() => setRenaming({ from: v, text: v })}>
                      <Icon d={PENCIL} />
                    </button>
                    <button type="button" className="venue-icon venue-icon-danger" aria-label={`Remove ${v}`} onClick={() => (daysUsing(v).length > 0 ? setConfirm(v) : remove(v))}>
                      <Icon d={BIN} />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {newField}
          <p className="muted venue-note">Days that use a place keep its name until you change them. Renaming a place updates them.</p>
        </>
      ) : (
        <>
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
          {newField}
          <div id={scopeId} className="seg-two" role="radiogroup" aria-label="Applies to">
            <button type="button" role="radio" aria-checked={scope === 'always'} className={scope === 'always' ? 'is-on' : ''} onClick={() => setScope('always')}>
              Every {day}
            </button>
            <button type="button" role="radio" aria-checked={scope === 'this-time'} className={scope === 'this-time' ? 'is-on' : ''} onClick={() => setScope('this-time')}>
              Just this time
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {undo && (
        <div className="venue-toast" role="status">
          <span>Removed {undo.name}</span>
          <button type="button" onClick={undoRemove}>
            Undo
          </button>
        </div>
      )}
      {!editing && (
        <div className="sheet-actions">
          <button type="button" className="btn btn-primary btn-block" disabled={!changed} onClick={save}>
            {newVenue.trim() ? 'Save and use' : 'Save'}
          </button>
        </div>
      )}
      {confirm && (
        <Sheet title={`Remove ${confirm}?`} onClose={() => setConfirm(null)}>
          <p>
            {dayList(daysUsing(confirm))} {daysUsing(confirm).length === 1 ? 'uses' : 'use'} this place. {daysUsing(confirm).length === 1 ? 'It keeps' : 'They keep'} showing {confirm} until you pick another.
          </p>
          <button type="button" className="btn btn-danger" onClick={() => remove(confirm)}>
            Remove
          </button>
          <button type="button" className="btn" onClick={() => setConfirm(null)}>
            Keep
          </button>
        </Sheet>
      )}
    </Sheet>
  );
}
