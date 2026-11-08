import type { Session } from '../engine';
import type { HistoryEntry } from './historyDb';
import { formatClock, type Slot } from './slots';
import { WEEKDAY_NAMES } from '../ui/weekdays';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WINDOWS = 10;
const TURNOUT_SAMPLE = 6;

const minuteOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** The slot's next date. Today's weekday is offset 0, even when its time has passed. */
export function nextOccurrence(slot: Slot, now: Date): { dayOffset: number; date: Date } {
  const dayOffset = (slot.weekday - now.getDay() + 7) % 7;
  return { dayOffset, date: new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset) };
}

/** The relative-time pill on Home. */
export function homeLabel(slot: Slot, now: Date): string {
  const { dayOffset } = nextOccurrence(slot, now);
  if (dayOffset === 1) return 'Tomorrow';
  if (dayOffset > 1) return `In ${dayOffset} days`;
  if (slot.startMin === undefined) return 'Today';
  const nowMin = minuteOfDay(now);
  const ahead = slot.startMin - nowMin;
  if (ahead > 60) return slot.startMin >= 17 * 60 ? 'Tonight' : 'Today';
  if (ahead > 0) return `Starts in ${ahead} min`;
  if (slot.endMin !== undefined && nowMin > slot.endMin) return 'Earlier today';
  const since = nowMin - slot.startMin;
  return since < 60 ? `Started ${since} min ago` : `Started ${formatClock(slot.startMin)}`;
}

/** Lime Start only when the session is today and within 3 hours of its start or end. */
export function ctaGrade(slot: Slot, now: Date): 'primary' | 'quiet' {
  if (nextOccurrence(slot, now).dayOffset !== 0) return 'quiet';
  const nowMin = minuteOfDay(now);
  if (slot.startMin !== undefined && nowMin < slot.startMin - 180) return 'quiet';
  if (slot.endMin !== undefined && nowMin > slot.endMin + 180) return 'quiet';
  return 'primary';
}

/** Soonest first. Same day: earlier start first, unset last. */
export function sortedSlots(slots: Slot[], now: Date): Slot[] {
  return slots
    .map((slot) => ({ slot, offset: nextOccurrence(slot, now).dayOffset }))
    .sort((a, b) => a.offset - b.offset || (a.slot.startMin ?? Infinity) - (b.slot.startMin ?? Infinity) || 0)
    .map((x) => x.slot);
}

/** "Tue 10": the weekday and date of the next occurrence. */
export function chipLabel(slot: Slot, now: Date): string {
  const { date } = nextOccurrence(slot, now);
  return `${WEEKDAY_NAMES[slot.weekday].slice(0, 3)} ${date.getDate()}`;
}

/** The slot weekday a session was started for. Sessions saved before it was stored use the day they began. */
export function sessionWeekday(session: Session): number {
  return session.weekday ?? new Date(session.createdAt).getDay();
}

/** Player counts of the latest 6 sessions that started on this weekday. Undefined with fewer than 2. */
export function usualTurnout(entries: HistoryEntry[], weekday: number): { min: number; max: number } | undefined {
  const counts = entries
    .filter((e) => new Date(e.createdAt).getDay() === weekday)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, TURNOUT_SAMPLE)
    .map((e) => e.session.players.length);
  if (counts.length < 2) return undefined;
  return { min: Math.min(...counts), max: Math.max(...counts) };
}

/** Of the last 10 rolling weeks ending now, how many had a session end in them. Undefined with under 3 sessions. */
export function weeksPlayed(entries: HistoryEntry[], now: Date): { played: number; of: number } | undefined {
  if (entries.length < 3) return undefined;
  const end = now.getTime();
  let played = 0;
  for (let i = 0; i < WINDOWS; i++) {
    const hi = end - i * 7 * DAY;
    const lo = hi - 7 * DAY;
    if (entries.some((e) => e.endedAt > lo && e.endedAt <= hi)) played++;
  }
  return { played, of: WINDOWS };
}

/** The latest session that ended less than 24 hours ago. None while a session runs. */
export function doneEntry(entries: HistoryEntry[], now: Date, running: boolean): HistoryEntry | undefined {
  if (running) return undefined;
  const latest = entries.reduce<HistoryEntry | undefined>((best, e) => (!best || e.endedAt > best.endedAt ? e : best), undefined);
  return latest && now.getTime() - latest.endedAt < DAY ? latest : undefined;
}

/** "45m" or "1h 12m". */
export function elapsedLabel(startMs: number, nowMs: number): string {
  const total = Math.max(0, Math.floor((nowMs - startMs) / MIN));
  return total < 60 ? `${total}m` : `${Math.floor(total / 60)}h ${total % 60}m`;
}
