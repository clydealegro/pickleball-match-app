import type { AttendanceViewData } from '../sync/attendance/types';

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** The slug a title gives: lower case letters and digits joined by single dashes. */
const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'open-play';

const stamp = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const clock = (d: Date) => `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;

const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

const encoder = new TextEncoder();

/** Folds a line so no physical line is over 75 octets. Continuation lines start with one space. Never splits a character. */
function fold(line: string): string {
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (size + n > 75) {
      out.push(current);
      current = ' ';
      size = 1;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join('\r\n');
}

/**
 * The play date as a calendar file. Times are floating (no time zone), because the view has none: the event
 * lands on the same clock time wherever the phone is. `now` is only the time stamp the format asks for.
 */
export function calendarFile(view: AttendanceViewData, now: number = Date.now()): { name: string; text: string } {
  const [y, m, d] = view.play_date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  const props: string[] = [];
  if (view.start_min === null) {
    const next = new Date(day.getTime());
    next.setUTCDate(next.getUTCDate() + 1);
    props.push(`DTSTART;VALUE=DATE:${stamp(day)}`, `DTEND;VALUE=DATE:${stamp(next)}`);
  } else {
    const start = new Date(day.getTime() + view.start_min * 60_000);
    // Two hours when there is no end. An end that is not after the start means the next day.
    const endMin = view.end_min === null ? view.start_min + 120 : view.end_min > view.start_min ? view.end_min : view.end_min + 1440;
    const end = new Date(day.getTime() + endMin * 60_000);
    props.push(`DTSTART:${stamp(start)}T${clock(start)}`, `DTEND:${stamp(end)}T${clock(end)}`);
  }
  const venue = view.venue?.trim();
  const base = slug(view.title);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PIKLMatch//Attendance//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${view.play_date}-${base}@piklmatch`,
    `DTSTAMP:${stamp(new Date(now))}T${clock(new Date(now))}Z`,
    ...props,
    `SUMMARY:${escapeText(view.title)}`,
    ...(venue ? [`LOCATION:${escapeText(venue)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return { name: `${base}-${view.play_date}.ics`, text: lines.map(fold).join('\r\n') + '\r\n' };
}
