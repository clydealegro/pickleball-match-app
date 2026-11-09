import type { AttendanceStatus, AttendanceViewData } from '../sync/attendance/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// A copy of the slot clock wording, so this page imports no store. The hour alone when there are no minutes.
const part = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return { text: m === 0 ? `${h % 12 || 12}` : `${h % 12 || 12}:${String(m).padStart(2, '0')}`, suffix: h % 24 < 12 ? 'am' : 'pm' };
};

/** "7 pm", "7:30 pm". */
export function clock12(min: number): string {
  const p = part(min);
  return `${p.text} ${p.suffix}`;
}

/** A calendar date as a UTC day, so no time zone can move it. */
function utcDay(playDate: string): Date | null {
  const m = DATE.exec(playDate);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

/** "Tue 10 Nov" from "2026-11-10". Text that is not a date comes back as it is. */
export function dateLabel(playDate: string): string {
  const d = utcDay(playDate);
  return d ? `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : playDate;
}

/** The same weekday a week later, as "2026-11-17". */
export function nextWeek(playDate: string): string {
  const d = utcDay(playDate);
  if (!d) return playDate;
  d.setUTCDate(d.getUTCDate() + 7);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** "7 to 9 pm", "from 7 pm", "until 9 pm", or null with neither. */
export function timeText(start: number | null, end: number | null): string | null {
  if (start !== null && end !== null) {
    const a = part(start);
    const b = part(end);
    return a.suffix === b.suffix ? `${a.text} to ${b.text} ${b.suffix}` : `${clock12(start)} to ${clock12(end)}`;
  }
  if (start !== null) return `from ${clock12(start)}`;
  if (end !== null) return `until ${clock12(end)}`;
  return null;
}

/** "Tue 10 Nov, 7 to 9 pm, Sample Hall". Parts that are missing are left out. */
export function whenLine(view: AttendanceViewData): string {
  return [dateLabel(view.play_date), timeText(view.start_min, view.end_min), view.venue?.trim() || null].filter(Boolean).join(', ');
}

export function statusLine(status: AttendanceStatus, date: string): string {
  if (status === 'in') return `You're in for ${date}.`;
  if (status === 'maybe') return `You're a maybe for ${date}. You can change this any time.`;
  return `You're out for ${date}.`;
}

/** People who are in (on the roster) plus friends. */
function headcount(view: AttendanceViewData): number {
  const ids = new Set(view.players.map((p) => p.id));
  return view.answers.filter((a) => a.status === 'in' && ids.has(a.player_id)).length + view.friends;
}

/** More than 4 for each court. Never when the courts are not known. */
export function isBusy(view: AttendanceViewData): boolean {
  return view.courts !== null && view.courts > 0 && headcount(view) > 4 * view.courts;
}

export function busyLine(view: AttendanceViewData): string | null {
  if (!isBusy(view)) return null;
  const courts = view.courts as number;
  return `Busy night: ${headcount(view)} in for ${courts} ${courts === 1 ? 'court' : 'courts'}. Expect to sit out a game now and then.`;
}
