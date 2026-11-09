import { useRef, useState, type PointerEvent } from 'react';
import { chipLabel, ctaGrade, doneEntry, sessionWeekday, sortedSlots } from '../store/homeInfo';
import { useHistoryStore } from '../store/historyStore';
import { useSessionStore } from '../store/sessionStore';
import { lastWeekStats } from '../store/lastWeekStats';
import { effectiveSlot, nextSlot, timestampAt, useSlotsStore, type Slot } from '../store/slots';
import { prefillFor, type AttendancePrefill } from '../sync/attendance/prefill';
import { localDate } from '../sync/attendance/links';
import { useAttendanceStore } from '../sync/attendance/store';
import { useAuthStore } from '../sync/auth';
import { AttendanceCard } from './AttendanceCard';
import { HomeAttendance } from './HomeAttendance';
import { VenueSheet } from './VenueSheet';
import { EditSlotSheet, type SlotPatch, type SlotScope } from './EditSlotSheet';
import { DoneCard, ViewSummaryRow, useSharePicture } from './HomeDone';
import { OneOffHero, SlotHero } from './HomeHero';
import { LiveHero } from './HomeLive';
import { Sheet } from './Sheet';
import { WEEKDAY_NAMES } from './weekdays';

/** What Setup needs to start a session from a slot. */
export interface SessionPlan {
  slotId: string;
  weekday: number;
  venue?: string;
  plannedEndAt?: number;
  courts?: number;
  /** What the attendance link says, when it is safe to use it. */
  attendance?: AttendancePrefill;
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
  const status = useAuthStore((s) => s.status);
  const authStatus = status;
  const userId = useAuthStore((s) => s.userId);
  const ownerId = useAttendanceStore((s) => s.ownerId);
  const summaries = useAttendanceStore((s) => s.summaries);
  // A tapped chip wins over the default until the screen goes away.
  const [picked, setPicked] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [venueId, setVenueId] = useState<string | null>(null);
  // Which way the last swipe went, so the next card slides in from that side.
  const [dir, setDir] = useState<1 | -1>(1);
  const swipe = useRef<{ x: number; y: number; dx: number; on: boolean } | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const swallowClick = useRef(false);

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
  // Sessions in chip order, then the one-off. A swipe moves along this list, and the chips and dots follow.
  const order = [...ordered.map((s) => s.id), ONE_OFF];
  const index = Math.max(0, order.indexOf(selected?.id ?? ONE_OFF));

  function go(delta: 1 | -1) {
    const next = order[index + delta];
    if (next === undefined) return;
    setDir(delta);
    setPicked(next);
  }

  function pick(id: string) {
    setDir(order.indexOf(id) < index ? -1 : 1);
    setPicked(id);
  }

  const SWIPE_MIN = 56;
  function down(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    swipe.current = { x: e.clientX, y: e.clientY, dx: 0, on: false };
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const st = swipe.current;
    if (!st) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    // A mostly vertical move is a scroll, so the card stays put.
    if (!st.on && (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.5)) return;
    if (!st.on) e.currentTarget.setPointerCapture?.(e.pointerId);
    st.on = true;
    st.dx = dx;
    // Held back at the ends, where there is no next card.
    const blocked = (dx < 0 && !order[index + 1]) || (dx > 0 && !order[index - 1]);
    if (track.current) {
      track.current.style.transition = 'none';
      track.current.style.transform = `translateX(${blocked ? dx * 0.2 : dx * 0.7}px)`;
    }
  }
  function up() {
    const st = swipe.current;
    swipe.current = null;
    if (!st?.on) return;
    swallowClick.current = true;
    setTimeout(() => (swallowClick.current = false), 0);
    if (track.current) {
      track.current.style.transition = 'transform 160ms ease-out';
      track.current.style.transform = '';
    }
    if (Math.abs(st.dx) >= SWIPE_MIN) go(st.dx < 0 ? 1 : -1);
  }
  const editing = slots.find((s) => s.id === editingId);
  const venueSlot = slots.find((s) => s.id === venueId);

  function start(slot: Slot) {
    const e = effectiveSlot(slot, tonight);
    const plan: SessionPlan = { slotId: slot.id, weekday: slot.weekday };
    if (e.venue !== undefined) plan.venue = e.venue;
    if (e.courts !== undefined) plan.courts = e.courts;
    if (e.endMin !== undefined) plan.plannedEndAt = timestampAt(e.endMin, Date.now());
    // Only the signed-in organizer who owns the saved copy, and only for today's date at this slot.
    if (status === 'signedIn' && userId !== null && ownerId === userId) {
      const today = localDate(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone);
      const attendance = prefillFor(summaries[slot.id], today, slot.id);
      if (attendance) plan.attendance = attendance;
    }
    onStart(plan);
  }

  function save(patch: SlotPatch, scope: SlotScope) {
    const target = editing ?? venueSlot;
    if (!target) return;
    if (scope === 'always') {
      saveSlot(target.id, patch);
      // The saved values now hold for good, so a this-time-only copy would only hide them. Only the keys that were
      // saved are cleared, so a this-time-only time stays when just the venue was saved.
      clearTonight(target.id, Object.keys(patch) as (keyof SlotPatch)[]);
    } else {
      setTonight(target.id, patch);
    }
    setEditingId(null);
    setVenueId(null);
  }

  const attendanceOn = authStatus !== 'unconfigured' && authStatus !== 'loading';
  const last = selected ? lastWeekStats(entries, selected.weekday, now) : undefined;
  const day = selected ? WEEKDAY_NAMES[selected.weekday] : '';
  const grade = eff ? ctaGrade(eff, now) : 'primary';

  let hero;
  if (live) hero = <LiveHero key="live" session={live} />;
  else if (showDone) hero = <DoneCard key="done" entry={done} now={now} />;
  // The key makes a fresh hero for each choice, so the slide-in plays again.
  else if (selected && eff) hero = <SlotHero key={selected.id} fromLeft={dir < 0} effective={eff} now={now} thisTimeOnly={Object.keys(tonight[selected.id] ?? {}).length > 0} onEdit={() => setEditingId(selected.id)} onVenue={() => setVenueId(selected.id)} last={last} attendance={attendanceOn ? <HomeAttendance slot={selected} onOpen={() => setAttendanceOpen(true)} onSignIn={onSignIn ?? noop} /> : undefined} />;
  else hero = <OneOffHero key={ONE_OFF} fromLeft={dir < 0} />;

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
              onClick={() => pick(slot.id)}
            >
              {chipLabel(slot, now)}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={oneOff} aria-label="One-off session" className="btn dashed home-chip home-chip-plus" onClick={() => pick(ONE_OFF)}>
            +
          </button>
        </div>
      )}

      {live || showDone ? (
        hero
      ) : (
        <div
          ref={track}
          className="home-swipe"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onClickCapture={(e) => {
            // A drag that ends over a button is not a tap.
            if (swallowClick.current) {
              e.stopPropagation();
              e.preventDefault();
            }
          }}
        >
          {hero}
        </div>
      )}

      {!live && !showDone && (
        <div className="home-dots" aria-hidden="true">
          {order.map((id, i) => (
            <i key={id} className={i === index ? 'on' : ''} />
          ))}
        </div>
      )}

      {showDone && <ViewSummaryRow onClick={() => onViewSummary(done.id)} />}

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

      {attendanceOpen && selected && (
        <Sheet title={`${day} attendance`} onClose={() => setAttendanceOpen(false)}>
          {/* The saved slot, not the one with this-time-only edits: the link is about the weekly slot. */}
          <AttendanceCard slot={selected} onSignIn={onSignIn ?? noop} />
        </Sheet>
      )}

      {venueSlot && (
        <VenueSheet slot={venueSlot} effective={effectiveSlot(venueSlot, tonight)} venues={venues} onSave={save} onClose={() => setVenueId(null)} />
      )}

      {editing && (
        <EditSlotSheet slot={editing} effective={effectiveSlot(editing, tonight)} venues={venues} onSave={save} onClose={() => setEditingId(null)} />
      )}
    </div>
  );
}
