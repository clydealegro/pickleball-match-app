import type { Slot } from '../../store/slots';
import type { AttendanceStatus, AttendanceViewData, ChangeNote, LinkRow, Summary, WaitingName } from './types';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The zone every link uses unless the device has a usable one. */
export const DEFAULT_TIMEZONE = 'Asia/Manila';
// The same rule the database applies to a link's time zone.
const TIMEZONE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/;

export const weekdayName = (weekday: number): string => WEEKDAYS[weekday] ?? '';

/** "Tuesday open play", the same way sessions are named. */
export const titleFor = (slot: Slot): string => `${weekdayName(slot.weekday)} open play`;

export function safeTimezone(raw: string | null | undefined): string {
  return typeof raw === 'string' && TIMEZONE.test(raw) ? raw : DEFAULT_TIMEZONE;
}

/** The columns a slot writes on its link. Missing times, venue and courts are written as null so they clear. */
export function linkRow(slot: Slot, timezone: string): LinkRow {
  return {
    slot_id: slot.id,
    title: titleFor(slot),
    weekday: slot.weekday,
    start_min: slot.startMin ?? null,
    end_min: slot.endMin ?? null,
    venue: slot.venue?.trim() || null,
    courts: slot.courts ?? null,
    timezone: safeTimezone(timezone),
  };
}

type ViewPlayer = AttendanceViewData['players'][number];

/** First names by player id. Two players with the same first name get their last initial: "Ben C.". */
export function displayNames(players: ViewPlayer[]): Record<string, string> {
  const taken = new Map<string, number>();
  for (const p of players) {
    const key = p.first_name.toLowerCase();
    taken.set(key, (taken.get(key) ?? 0) + 1);
  }
  const names: Record<string, string> = {};
  for (const p of players) {
    const shared = (taken.get(p.first_name.toLowerCase()) ?? 0) > 1;
    names[p.id] = shared && p.last_initial ? `${p.first_name} ${p.last_initial}.` : p.first_name;
  }
  return names;
}

export function summarize(
  slotId: string,
  code: string,
  view: AttendanceViewData,
  waiting: WaitingName[],
  tonight: WaitingName[],
  now: number,
): Summary {
  const names = displayNames(view.players);
  const counts = { in: 0, maybe: 0, out: 0, late: 0 };
  const answers: Record<string, AttendanceStatus> = {};
  const lateIds: string[] = [];
  for (const a of view.answers) {
    // An answer from someone removed from the roster is not counted.
    if (!(a.player_id in names)) continue;
    answers[a.player_id] = a.status;
    counts[a.status] += 1;
    if (a.status === 'in' && a.late) {
      counts.late += 1;
      lateIds.push(a.player_id);
    }
  }
  return {
    slotId,
    code,
    playDate: view.play_date,
    cancelled: view.cancelled,
    counts,
    friends: view.friends,
    waiting,
    tonight,
    lateIds,
    answers,
    names,
    fetchedAt: now,
  };
}

/**
 * The latest answer that changed to a different status between two lists. A first answer is not a change, and
 * neither is an answer that went away. Several changes at once: the last in the new list wins.
 */
export function diffChange(
  prev: Record<string, AttendanceStatus> | undefined,
  next: Record<string, AttendanceStatus>,
  names: Record<string, string>,
  now: number,
): ChangeNote | null {
  if (!prev) return null;
  let found: ChangeNote | null = null;
  for (const [id, to] of Object.entries(next)) {
    const from = prev[id];
    if (from === undefined || from === to || names[id] === undefined) continue;
    found = { player: names[id], from, to, at: now };
  }
  return found;
}

/** The calendar date of a moment in a time zone, as YYYY-MM-DD. */
export function localDate(ms: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(ms),
  );
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export const shareUrl = (origin: string, code: string): string => `${origin.replace(/\/+$/, '')}/#/j/${code}`;
