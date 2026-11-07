import type { HistoryEntry } from './historyDb';

export interface Attendance {
  /** Finished sessions this saved player was in. */
  sessions: number;
  /** When the latest of those sessions ended. */
  lastAt: number;
}

/** Who turned up, by saved-player id. A player counts once per session, however many games they played. */
export function attendanceByRoster(entries: HistoryEntry[]): Map<string, Attendance> {
  const out = new Map<string, Attendance>();
  for (const e of entries) {
    const seen = new Set<string>();
    for (const p of e.session.players) {
      if (!p.rosterId || seen.has(p.rosterId)) continue;
      seen.add(p.rosterId);
      const a = out.get(p.rosterId);
      out.set(p.rosterId, { sessions: (a?.sessions ?? 0) + 1, lastAt: Math.max(a?.lastAt ?? 0, e.endedAt) });
    }
  }
  return out;
}

/**
 * Saved players who came to at least `min` sessions that started on this weekday (0 is Sunday), most frequent first.
 * This is what "your Tuesday regulars" is made from.
 */
export function regularsForWeekday(entries: HistoryEntry[], weekday: number, min = 2): string[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (new Date(e.createdAt).getDay() !== weekday) continue;
    const seen = new Set<string>();
    for (const p of e.session.players) {
      if (!p.rosterId || seen.has(p.rosterId)) continue;
      seen.add(p.rosterId);
      counts.set(p.rosterId, (counts.get(p.rosterId) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Tue 4 Nov": the same short date everywhere history is shown. */
export function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "5 sessions, last Tue 4 Nov", or "No sessions yet". */
export function attendanceLine(a: Attendance | undefined): string {
  if (!a) return 'No sessions yet';
  const when = shortDate(a.lastAt);
  return `${a.sessions} ${a.sessions === 1 ? 'session' : 'sessions'}, last ${when}`;
}

/** Most sessions first, then most recent, then name. Players with no sessions go last, in the order given. */
export function sortByAttendance<T extends { id: string; name: string }>(players: T[], att: Map<string, Attendance>): T[] {
  return [...players].sort((a, b) => {
    const x = att.get(a.id);
    const y = att.get(b.id);
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return y.sessions - x.sessions || y.lastAt - x.lastAt || a.name.localeCompare(b.name);
  });
}
