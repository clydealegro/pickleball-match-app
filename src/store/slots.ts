import { create } from 'zustand';

/** The club's recurring sessions. They live on this device only. */
export interface Slot {
  id: string;
  /** 0 is Sunday, 6 is Saturday. */
  weekday: number;
  /** Minutes after midnight. */
  startMin?: number;
  endMin?: number;
  venue?: string;
  /** How many courts this session uses, a whole number from 1 to 12. */
  courts?: number;
}

export interface SlotsData {
  slots: Slot[];
  venues: string[];
}

type SlotEdit = Partial<Pick<Slot, 'startMin' | 'endMin' | 'venue' | 'courts'>>;

export const SLOTS_KEY = 'pickleball.slots';
export const MAX_VENUES = 12;
export const MAX_VENUE_LENGTH = 40;
export const MAX_COURTS = 12;

export const DEFAULT_SLOTS: SlotsData = {
  slots: [
    { id: 'tue', weekday: 2 },
    { id: 'thu', weekday: 4 },
    { id: 'sat', weekday: 6 },
  ],
  venues: [],
};

const defaults = (): SlotsData => ({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [] });

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isOptNum = (x: unknown) => x === undefined || (typeof x === 'number' && Number.isFinite(x));

const isCourts = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= MAX_COURTS;

function isSlot(x: unknown): x is Slot {
  return (
    isObject(x) &&
    typeof x.id === 'string' &&
    x.id !== '' &&
    typeof x.weekday === 'number' &&
    Number.isInteger(x.weekday) &&
    x.weekday >= 0 &&
    x.weekday <= 6 &&
    isOptNum(x.startMin) &&
    isOptNum(x.endMin) &&
    (x.venue === undefined || typeof x.venue === 'string')
  );
}

/** Defaults for anything missing or malformed. Drops invalid slots and non-string venues. */
export function parseSlots(raw: string | null): SlotsData {
  if (raw === null) return defaults();
  try {
    const data: unknown = JSON.parse(raw);
    if (!isObject(data) || !Array.isArray(data.slots) || !Array.isArray(data.venues)) return defaults();
    return {
      // A courts value that is not a whole number from 1 to 12 is dropped, and the slot stays.
      slots: data.slots.filter(isSlot).map(({ courts, ...rest }) => (isCourts(courts) ? { ...rest, courts } : rest)),
      venues: data.venues.filter((v): v is string => typeof v === 'string'),
    };
  } catch {
    return defaults();
  }
}

/** Earliest start first, slots with no start last. Stable. */
const byStart = (a: Slot, b: Slot) => (a.startMin ?? Infinity) - (b.startMin ?? Infinity) || 0;

function firstOn(slots: Slot[], weekday: number): Slot | undefined {
  return slots.filter((s) => s.weekday === weekday).sort(byStart)[0];
}

/** The slot that is today, else the first slot on the next weekday that has one. */
export function nextSlot(slots: Slot[], today: Date): Slot | undefined {
  for (let d = 0; d < 7; d++) {
    const found = firstOn(slots, (today.getDay() + d) % 7);
    if (found) return found;
  }
  return undefined;
}

const part = (min: number) => {
  const h = Math.floor(min / 60);
  const m = String(min % 60).padStart(2, '0');
  return { text: `${h % 12 || 12}:${m}`, suffix: h % 24 < 12 ? 'am' : 'pm' };
};

export function formatClock(min: number): string {
  const p = part(min);
  return `${p.text} ${p.suffix}`;
}

export function formatRange(startMin?: number, endMin?: number): string {
  if (startMin !== undefined && endMin !== undefined) {
    const a = part(startMin);
    const b = part(endMin);
    return a.suffix === b.suffix ? `${a.text} to ${b.text} ${b.suffix}` : `${formatClock(startMin)} to ${formatClock(endMin)}`;
  }
  if (startMin !== undefined) return `From ${formatClock(startMin)}`;
  if (endMin !== undefined) return `Until ${formatClock(endMin)}`;
  return 'Add a time';
}

/** The local time `min` minutes after midnight, on the day of `now`. */
export function timestampAt(min: number, now: number): number {
  const d = new Date(now);
  d.setHours(0, min, 0, 0);
  return d.getTime();
}

/** The slot with this-time-only edits laid over it. */
export function effectiveSlot(slot: Slot, tonight: Record<string, SlotEdit>): Slot {
  return { ...slot, ...tonight[slot.id] };
}

function load(): SlotsData {
  try {
    return parseSlots(localStorage.getItem(SLOTS_KEY));
  } catch {
    return defaults();
  }
}

/** Writes to storage. False when it throws (blocked or full): the choice still holds until the app closes. */
function persist(data: SlotsData): boolean {
  try {
    localStorage.setItem(SLOTS_KEY, JSON.stringify({ slots: data.slots, venues: data.venues }));
    return true;
  } catch {
    return false;
  }
}

interface SlotsState extends SlotsData {
  /** This-time-only edits. Never written to storage. */
  tonight: Record<string, SlotEdit>;
  /** False once a write to storage has thrown, until a later write works. */
  persistent: boolean;
  saveSlot: (id: string, patch: SlotEdit) => void;
  setTonight: (id: string, patch: SlotEdit) => void;
  /** Drops this-time-only edits for a slot: all of them, or only the named fields. */
  clearTonight: (id: string, keys?: (keyof SlotEdit)[]) => void;
  /** Returns the name as stored, or an empty string when nothing was stored. */
  addVenue: (name: string) => string;
  /**
   * Renames a saved place, and every saved day and this-time-only edit that uses it. Returns the name as stored, or an
   * empty string when nothing changed: the new name is blank, or another place already has it.
   */
  renameVenue: (from: string, to: string) => string;
  /** Takes a place off the saved list. Days that use it keep its name. Returns where it was, or -1 when it was not there. */
  removeVenue: (name: string) => number;
  /** Puts a removed place back where it was, for Undo. */
  restoreVenue: (name: string, index: number) => void;
}

export const useSlotsStore = create<SlotsState>()((set, get) => ({
  ...load(),
  tonight: {},
  persistent: true,
  saveSlot(id, patch) {
    const { slots, venues } = get();
    if (!slots.some((s) => s.id === id)) return;
    const next = slots.map((s) => {
      if (s.id !== id) return s;
      const merged: Record<string, unknown> = { ...s, ...patch };
      for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
      return merged as unknown as Slot;
    });
    set({ slots: next, persistent: persist({ slots: next, venues }) });
  },
  setTonight(id, patch) {
    set((st) => ({ tonight: { ...st.tonight, [id]: { ...st.tonight[id], ...patch } } }));
  },
  clearTonight(id, keys) {
    set((st) => {
      const { [id]: gone, ...rest } = st.tonight;
      if (!keys || !gone) return { tonight: rest };
      const kept = { ...gone };
      for (const k of keys) delete kept[k];
      return { tonight: Object.keys(kept).length > 0 ? { ...rest, [id]: kept } : rest };
    });
  },
  addVenue(name) {
    const clean = name.trim().slice(0, MAX_VENUE_LENGTH).trim();
    if (!clean) return '';
    const { slots, venues } = get();
    const existing = venues.find((v) => v.toLowerCase() === clean.toLowerCase());
    if (existing) return existing;
    if (venues.length >= MAX_VENUES) return '';
    const next = [...venues, clean];
    set({ venues: next, persistent: persist({ slots, venues: next }) });
    return clean;
  },
  renameVenue(from, to) {
    const clean = to.trim().slice(0, MAX_VENUE_LENGTH).trim();
    const { slots, venues, tonight } = get();
    if (!clean || !venues.includes(from)) return '';
    if (clean === from) return from;
    // Another place with the same name, ignoring capitals, would make two chips that look alike.
    if (venues.some((v) => v !== from && v.toLowerCase() === clean.toLowerCase())) return '';
    const nextVenues = venues.map((v) => (v === from ? clean : v));
    const nextSlots = slots.map((sl) => (sl.venue === from ? { ...sl, venue: clean } : sl));
    const nextTonight = Object.fromEntries(Object.entries(tonight).map(([id, e]) => [id, e.venue === from ? { ...e, venue: clean } : e]));
    set({ venues: nextVenues, slots: nextSlots, tonight: nextTonight, persistent: persist({ slots: nextSlots, venues: nextVenues }) });
    return clean;
  },
  removeVenue(name) {
    const { slots, venues } = get();
    const at = venues.indexOf(name);
    if (at < 0) return -1;
    const next = venues.filter((v) => v !== name);
    set({ venues: next, persistent: persist({ slots, venues: next }) });
    return at;
  },
  restoreVenue(name, index) {
    const { slots, venues } = get();
    if (venues.includes(name) || venues.length >= MAX_VENUES) return;
    const next = [...venues];
    next.splice(Math.min(Math.max(index, 0), next.length), 0, name);
    set({ venues: next, persistent: persist({ slots, venues: next }) });
  },
}));
