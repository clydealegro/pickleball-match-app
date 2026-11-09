import { useState } from 'react';
import { shortDate } from '../store/attendance';
import { chipLabel, ctaGrade, doneEntry, sessionWeekday, sortedSlots, weeksPlayed } from '../store/homeInfo';
import { useHistoryStore } from '../store/historyStore';
import { useSessionStore } from '../store/sessionStore';
import { effectiveSlot, nextSlot, timestampAt, useSlotsStore, type Slot } from '../store/slots';
import { AttendanceCard } from './AttendanceCard';
import { EditSlotSheet, type SlotPatch, type SlotScope } from './EditSlotSheet';
import { DoneCard, ViewSummaryRow, useSharePicture } from './HomeDone';
import { OneOffHero, SlotHero } from './HomeHero';
import { LiveHero } from './HomeLive';
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
  /** Goes back to the session that is running. */
  onResume: () => void;
  onHistory: () => void;
  /** Opens the summary of a finished session by its history id. */
  onViewSummary: (entryId: string) => void;
  /** Opens the place where the organizer signs in, for the attendance card. */
  onSignIn?: () => void;
}

const ONE_OFF = 'one-off';
const noop = () => {};

/** The slim row under the hero: the last session and how often the group played. */
function LastRow({ onHistory }: { onHistory: () => void }) {
  const entries = useHistoryStore((s) => s.entries);
  const loaded = useHistoryStore((s) => s.loaded);
  const now = new Date();
  // The row keeps its height while history loads, so nothing jumps when it arrives.
  if (!loaded) return <div className="home-last home-last-ph" data-testid="home-last-placeholder" aria-hidden="true" />;
  const last = entries[0];
  if (!last) return null;
  const weeks = weeksPlayed(entries, now);
  return (
    <button type="button" className="home-last" onClick={onHistory}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      <span className="home-last-text">
        <span>
          Last: {shortDate(last.endedAt)}, {last.games} {last.games === 1 ? 'game' : 'games'}
        </span>
        {weeks && <span className="muted home-last-sub">{`Played ${weeks.played} of the last ${weeks.of} weeks`}</span>}
      </span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
}

export function HomeScreen({ onStart, onResume, onHistory, onViewSummary, onSignIn }: Props) {
  const slots = useSlotsStore((s) => s.slots);
  const venues = useSlotsStore((s) => s.venues);
  const tonight = useSlotsStore((s) => s.tonight);
  const persistent = useSlotsStore((s) => s.persistent);
  const saveSlot = useSlotsStore((s) => s.saveSlot);
  const setTonight = useSlotsStore((s) => s.setTonight);
  const clearTonight = useSlotsStore((s) => s.clearTonight);
  const session = useSessionStore((s) => s.session);
  const entries = useHistoryStore((s) => s.entries);
  // A tapped chip wins over the default until the screen goes away.
  const [picked, setPicked] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const now = new Date();
  const live = session && !session.endedAt ? session : undefined;
  // A session that ended in the last 24 hours shows its done card on the slot it was played on.
  const done = doneEntry(entries, now, !!live);
  const doneSlot = done && sortedSlots(slots.filter((s) => s.weekday === sessionWeekday(done.session)), now)[0];
  const ordered = sortedSlots(slots, now);
  const defaultId = doneSlot?.id ?? nextSlot(slots, now)?.id ?? ONE_OFF;
  const wanted = picked ?? defaultId;
  const selected = wanted === ONE_OFF ? undefined : slots.find((s) => s.id === wanted);
  const oneOff = selected === undefined;
  const showDone = !!done && !!selected && selected.id === doneSlot?.id;
  const sharing = useSharePicture(done?.session);
  const eff = selected && effectiveSlot(selected, tonight);
  const editing = slots.find((s) => s.id === editingId);

  function start(slot: Slot) {
    const e = effectiveSlot(slot, tonight);
    const plan: SessionPlan = { slotId: slot.id, weekday: slot.weekday };
    if (e.venue !== undefined) plan.venue = e.venue;
    if (e.courts !== undefined) plan.courts = e.courts;
    if (e.endMin !== undefined) plan.plannedEndAt = timestampAt(e.endMin, Date.now());
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

  const day = selected ? WEEKDAY_NAMES[selected.weekday] : '';
  const grade = eff ? ctaGrade(eff, now) : 'primary';

  let hero;
  if (live) hero = <LiveHero key="live" session={live} />;
  else if (showDone) hero = <DoneCard key="done" entry={done} now={now} />;
  // The key makes a fresh hero for each choice, so the slide-in plays again.
  else if (selected && eff) hero = <SlotHero key={selected.id} effective={eff} now={now} thisTimeOnly={Object.keys(tonight[selected.id] ?? {}).length > 0} onEdit={() => setEditingId(selected.id)} />;
  else hero = <OneOffHero key={ONE_OFF} />;

  let action;
  if (live) {
    action = (
      <button type="button" className="btn btn-block home-start" data-grade="primary" onClick={onResume}>
        Back to session
      </button>
    );
  } else if (showDone) {
    action = (
      <button type="button" className="btn btn-block home-start" data-grade="primary" disabled={sharing.making} onClick={() => void sharing.share()}>
        {sharing.making ? 'Making picture…' : 'Share as picture'}
      </button>
    );
  } else if (selected) {
    action = (
      <button type="button" className="btn btn-block home-start" data-grade={grade} aria-label={`Start session, ${day}`} onClick={() => start(selected)}>
        Start {day} session
      </button>
    );
  } else {
    action = (
      <button type="button" className="btn btn-block home-start" data-grade="primary" onClick={() => onStart(undefined)}>
        Start a one-off session
      </button>
    );
  }

  return (
    <div className="home">
      {!live && (
        <div className="home-chips" role="radiogroup" aria-label="Sessions">
          {ordered.map((slot) => (
            <button
              key={slot.id}
              type="button"
              role="radio"
              aria-checked={slot.id === selected?.id}
              className="btn home-chip"
              onClick={() => setPicked(slot.id)}
            >
              {chipLabel(slot, now)}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={oneOff} aria-label="One-off session" className="btn dashed home-chip home-chip-plus" onClick={() => setPicked(ONE_OFF)}>
            +
          </button>
        </div>
      )}

      {hero}

      {/* The saved slot, not the one with this-time-only edits: the link is about the weekly slot. */}
      {selected && !live && !showDone && <AttendanceCard slot={selected} onSignIn={onSignIn ?? noop} />}

      {showDone ? <ViewSummaryRow onClick={() => onViewSummary(done.id)} /> : <LastRow onHistory={onHistory} />}

      {showDone && sharing.message && (
        <p className="muted home-note" role="status">
          {sharing.message}
        </p>
      )}

      {!persistent && (
        <p className="muted home-note" role="status">
          Times and venues cannot be saved in this browser, so they will be forgotten when the app closes.
        </p>
      )}

      <div className="sticky-bar">{action}</div>

      {editing && (
        <EditSlotSheet slot={editing} effective={effectiveSlot(editing, tonight)} venues={venues} onSave={save} onClose={() => setEditingId(null)} />
      )}
    </div>
  );
}
