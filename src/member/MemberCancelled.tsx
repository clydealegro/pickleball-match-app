import type { AttendanceViewData } from '../sync/attendance/types';
import { dateLabel, nextWeek } from './format';

/** The weekday name of a play date ("Tuesday"), read as a calendar day so no time zone moves it. */
function weekdayName(playDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(playDate);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

/** Screen 6: no play this week. Nothing to answer. */
export function MemberCancelled({ view }: { view: AttendanceViewData }) {
  const day = weekdayName(view.play_date);
  const reason = view.cancelled?.reason?.trim();
  return (
    <section className="member-section">
      <h2 className="member-heading">{day ? `No play this ${day}` : 'No play this week'}</h2>
      <p className="member-when">{dateLabel(view.play_date)}</p>
      {reason && <p className="member-notice">{reason}</p>}
      <p className="member-next">Next session: {dateLabel(nextWeek(view.play_date))}</p>
    </section>
  );
}
