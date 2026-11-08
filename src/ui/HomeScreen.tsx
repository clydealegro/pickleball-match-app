import { useState } from 'react';
import { shortDate } from '../store/attendance';
import { useHistoryStore } from '../store/historyStore';
import { effectiveSlot, formatRange, nextSlot, timestampAt, useSlotsStore, type Slot } from '../store/slots';
import { EditSlotSheet, type SlotPatch, type SlotScope } from './EditSlotSheet';
import { WEEKDAY_NAMES } from './weekdays';

/** What Setup needs to start a session from a slot. */
export interface SessionPlan {
  slotId: string;
  weekday: number;
  venue?: string;
  plannedEndAt?: number;
  courts?: number;
}

interface Props {
  onStart: (plan: SessionPlan | undefined) => void;
  onHistory: () => void;
}

export function HomeScreen({ onStart, onHistory }: Props) {
  const slots = useSlotsStore((s) => s.slots);
  const venues = useSlotsStore((s) => s.venues);
  const tonight = useSlotsStore((s) => s.tonight);
  const saveSlot = useSlotsStore((s) => s.saveSlot);
  const setTonight = useSlotsStore((s) => s.setTonight);
  const clearTonight = useSlotsStore((s) => s.clearTonight);
  const last = useHistoryStore((s) => s.entries[0]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const now = new Date();
  const big = nextSlot(slots, now);
  const others = slots.filter((s) => s.id !== big?.id);
  const editing = slots.find((s) => s.id === editingId);

  function start(slot: Slot) {
    const eff = effectiveSlot(slot, tonight);
    const plan: SessionPlan = { slotId: slot.id, weekday: slot.weekday };
    if (eff.venue !== undefined) plan.venue = eff.venue;
    if (eff.courts !== undefined) plan.courts = eff.courts;
    if (eff.endMin !== undefined) plan.plannedEndAt = timestampAt(eff.endMin, Date.now());
    onStart(plan);
  }

  function save(patch: SlotPatch, scope: SlotScope) {
    if (!editing) return;
    if (scope === 'always') {
      saveSlot(editing.id, patch);
      // The saved values now hold for good, so a this-time-only copy would only hide them.
      clearTonight(editing.id);
    } else {
      setTonight(editing.id, patch);
    }
    setEditingId(null);
  }

  function renderCard(slot: Slot, isBig: boolean) {
    const eff = effectiveSlot(slot, tonight);
    const day = WEEKDAY_NAMES[slot.weekday];
    const label = slot.weekday === now.getDay() ? 'Today' : day;
    return (
      <section key={slot.id} className={`card stack slot-card${isBig ? ' slot-big' : ''}`}>
        <div className="row-flex spread">
          {isBig ? <span className="slot-label muted">{label}</span> : <h3 className="section-title">{day}</h3>}
          {tonight[slot.id] && <span className="tag">This time only</span>}
        </div>
        {isBig && <h2 className="slot-title">{day} open play</h2>}
        <p className={eff.startMin === undefined && eff.endMin === undefined ? 'muted' : undefined}>{formatRange(eff.startMin, eff.endMin)}</p>
        <p className={eff.venue === undefined ? 'muted' : undefined}>{eff.venue ?? 'Add a venue'}</p>
        <div className="row-flex">
          <button type="button" className="btn" aria-label={`Edit ${day}`} onClick={() => setEditingId(slot.id)}>
            Edit
          </button>
          <button
            type="button"
            className={`btn btn-start${isBig ? ' btn-primary' : ''}`}
            aria-label={isBig ? undefined : `Start ${day} session`}
            onClick={() => start(slot)}
          >
            {isBig ? `Start ${day} session` : 'Start'}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="stack">
      {big && renderCard(big, true)}
      {others.map((s) => renderCard(s, false))}

      <button type="button" className="btn btn-ghost" onClick={() => onStart(undefined)}>
        Start a one-off session
      </button>

      {last && (
        <div className="row-flex spread">
          <p className="muted">
            Last: {shortDate(last.endedAt)}, {last.games} {last.games === 1 ? 'game' : 'games'}
          </p>
          <button type="button" className="btn" onClick={onHistory}>
            Past sessions
          </button>
        </div>
      )}

      {editing && (
        <EditSlotSheet slot={editing} effective={effectiveSlot(editing, tonight)} venues={venues} onSave={save} onClose={() => setEditingId(null)} />
      )}
    </div>
  );
}
