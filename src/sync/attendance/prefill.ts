import type { Summary } from './types';

/** What the link tells Setup, when a session starts from the slot the link is for. */
export interface AttendancePrefill {
  /** Players who answered In, late ones included. */
  inIds: string[];
  /** The part of `inIds` who said they are late. */
  lateIds: string[];
  maybeIds: string[];
  /** Friends marked to play tonight. The id is the guest id. */
  friends: { id: string; name: string }[];
}

const byName = (a: { name: string; id: string }, b: { name: string; id: string }) => {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/**
 * What to pre-fill Setup with, or null when it would not be safe: no summary, the summary is for another slot, the
 * date is not `today` (YYYY-MM-DD, the device's calendar date), or the day is cancelled.
 */
export function prefillFor(summary: Summary | undefined, today: string, slotId?: string): AttendancePrefill | null {
  if (!summary || summary.cancelled || summary.playDate !== today) return null;
  if (slotId !== undefined && summary.slotId !== slotId) return null;
  const named = (status: 'in' | 'maybe') =>
    Object.entries(summary.answers)
      .filter(([id, answer]) => answer === status && id in summary.names)
      .map(([id]) => ({ id, name: summary.names[id] }))
      .sort(byName)
      .map((p) => p.id);
  const inIds = named('in');
  const late = new Set(summary.lateIds);
  return {
    inIds,
    lateIds: inIds.filter((id) => late.has(id)),
    maybeIds: named('maybe'),
    friends: summary.tonight.map(({ id, name }) => ({ id, name })).sort(byName),
  };
}
