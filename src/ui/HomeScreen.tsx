import { useLayoutEffect, useRef, useState } from 'react';
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
import { motionOK } from './motion';
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
/** The space between slides in the track. The stylesheet uses the same number. */
const SLIDE_GAP = 12;
/** A tap on a chip scrolls the track. Scroll events are ignored until it has been this quiet, and for this long at least. */
const SETTLE_QUIET_MS = 120;
const SETTLE_MIN_MS = 450;

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
  // The places drawer opens in edit mode when it is reached from the Edit places link.
  const [venueEdit, setVenueEdit] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  // Set while a tap on a chip is scrolling the track, so the scroll does not pick the slides it passes.
  const settling = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

  const selectedId = selected?.id ?? ONE_OFF;
  const carousel = !live && !showDone;
  const slideStep = () => (track.current?.clientWidth ?? 0) + SLIDE_GAP;

  /** Ignores the track's scroll events for this long, so the slides it passes on the way are not picked. */
  function settle(ms: number) {
    clearTimeout(settling.current);
    settling.current = setTimeout(() => (settling.current = undefined), ms);
  }

  /** A tap on a chip picks that day and slides the track to it. */
  function pick(id: string) {
    setPicked(id);
    const el = track.current;
    const at = order.indexOf(id);
    if (!el || at < 0) return;
    settle(SETTLE_MIN_MS);
    const left = at * slideStep();
    if (typeof el.scrollTo === 'function') el.scrollTo({ left, behavior: motionOK() ? 'smooth' : 'auto' });
    else el.scrollLeft = left;
  }

  /** A drag moves the track itself, and whichever slide is nearest becomes the picked day, so the chips follow live. */
  function onTrackScroll() {
    const el = track.current;
    if (!el) return;
    // Still scrolling to a tapped chip's slide: stay quiet until it stops.
    if (settling.current) {
      settle(SETTLE_QUIET_MS);
      return;
    }
    const step = slideStep();
    if (step <= SLIDE_GAP) return;
    const at = Math.min(order.length - 1, Math.max(0, Math.round(el.scrollLeft / step)));
    if (order[at] !== selectedId) setPicked(order[at]);
  }

  // The track opens on the picked day, without sliding there.
  useLayoutEffect(() => {
    const el = track.current;
    if (!el || !carousel) return;
    el.scrollLeft = index * slideStep();
    // Only when the track appears: after that the scroll position is the user's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carousel]);

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
    setVenueEdit(false);
  }

  const attendanceOn = authStatus !== 'unconfigured' && authStatus !== 'loading';
  const day = selected ? WEEKDAY_NAMES[selected.weekday] : '';
  const grade = eff ? ctaGrade(eff, now) : 'primary';

  /** One day's card in the track. Only the picked one can be tapped or read out. */
  const slide = (slot: Slot) => {
    const active = slot.id === selectedId;
    return (
      <div key={slot.id} className="home-slide" data-active={active} aria-hidden={!active} {...(active ? {} : ({ inert: '' } as object))}>
        <SlotHero
          effective={effectiveSlot(slot, tonight)}
          now={now}
          thisTimeOnly={Object.keys(tonight[slot.id] ?? {}).length > 0}
          onEdit={() => setEditingId(slot.id)}
          onVenue={() => {
            setVenueEdit(false);
            setVenueId(slot.id);
          }}
          last={lastWeekStats(entries, slot.weekday, now)}
          attendance={attendanceOn ? <HomeAttendance slot={slot} onOpen={() => setAttendanceOpen(true)} onSignIn={onSignIn ?? noop} /> : undefined}
        />
      </div>
    );
  };

  let hero;
  if (live) hero = <LiveHero key="live" session={live} />;
  else if (showDone) hero = <DoneCard key="done" entry={done} now={now} />;
  else
    hero = (
      <div ref={track} className="home-track" onScroll={onTrackScroll}>
        {ordered.map(slide)}
        <div key={ONE_OFF} className="home-slide" data-active={oneOff} aria-hidden={!oneOff} {...(oneOff ? {} : ({ inert: '' } as object))}>
          <OneOffHero />
        </div>
      </div>
    );

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

      {hero}

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
        <VenueSheet slot={venueSlot} effective={effectiveSlot(venueSlot, tonight)} venues={venues} onSave={save} initialEdit={venueEdit} onClose={() => { setVenueId(null); setVenueEdit(false); }} />
      )}

      {editing && (
        <EditSlotSheet slot={editing} effective={effectiveSlot(editing, tonight)} venues={venues} onSave={save} onClose={() => setEditingId(null)} onEditPlaces={() => { setVenueEdit(true); setVenueId(editing.id); setEditingId(null); }} />
      )}
    </div>
  );
}
