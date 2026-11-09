import { describe, expect, it } from 'vitest';
import type { AttendanceViewData } from '../sync/attendance/types';
import { busyLine, clock12, dateLabel, isBusy, nextWeek, statusLine, whenLine } from './format';

const base: AttendanceViewData = {
  title: 'Tuesday open play',
  weekday: 2,
  venue: 'Sample Hall',
  start_min: 1140,
  end_min: 1260,
  courts: 3,
  play_date: '2026-11-10',
  cancelled: null,
  players: [],
  answers: [],
  friends: 0,
};
const view = (patch: Partial<AttendanceViewData>): AttendanceViewData => ({ ...base, ...patch });

/** A view with `n` players who answered In, and `friends` friends. */
function busy(n: number, friends: number, courts: number | null): AttendanceViewData {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, first_name: `P${i}`, last_initial: null, has_photo: false, photo_seq: 0 }));
  return view({ courts, friends, players, answers: players.map((p) => ({ player_id: p.id, status: 'in' as const, late: false })) });
}

describe('clock12', () => {
  it('drops the minutes on the hour', () => {
    expect(clock12(1140)).toBe('7 pm');
    expect(clock12(540)).toBe('9 am');
  });

  it('keeps the minutes when there are some', () => {
    expect(clock12(1170)).toBe('7:30 pm');
    expect(clock12(545)).toBe('9:05 am');
  });

  it('handles midnight and noon', () => {
    expect(clock12(0)).toBe('12 am');
    expect(clock12(30)).toBe('12:30 am');
    expect(clock12(720)).toBe('12 pm');
    expect(clock12(750)).toBe('12:30 pm');
  });

  it('handles the last minute of the day', () => {
    expect(clock12(1439)).toBe('11:59 pm');
  });

  it('switches from am to pm at noon', () => {
    expect(clock12(719)).toBe('11:59 am');
    expect(clock12(780)).toBe('1 pm');
  });
});

describe('dateLabel', () => {
  it('writes the weekday, the day and the month', () => {
    expect(dateLabel('2026-11-10')).toBe('Tue 10 Nov');
  });

  it('does not pad the day', () => {
    expect(dateLabel('2026-11-03')).toBe('Tue 3 Nov');
  });

  it('is right at the start and end of a month and a year', () => {
    expect(dateLabel('2026-12-31')).toBe('Thu 31 Dec');
    expect(dateLabel('2027-01-01')).toBe('Fri 1 Jan');
    expect(dateLabel('2026-01-31')).toBe('Sat 31 Jan');
    expect(dateLabel('2026-02-01')).toBe('Sun 1 Feb');
    expect(dateLabel('2026-03-01')).toBe('Sun 1 Mar');
  });

  it('knows a leap day', () => {
    expect(dateLabel('2028-02-29')).toBe('Tue 29 Feb');
  });

  it('names every month and every weekday', () => {
    const months = Array.from({ length: 12 }, (_, i) => dateLabel(`2026-${String(i + 1).padStart(2, '0')}-15`).split(' ')[2]);
    expect(months).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
    const days = Array.from({ length: 7 }, (_, i) => dateLabel(`2026-11-0${i + 1}`).split(' ')[0]);
    expect(days).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });

  it('gives the same answer in any time zone of the device', () => {
    // 2026-11-10 is read as a calendar date, never as midnight UTC.
    expect(dateLabel('2026-11-10')).toBe('Tue 10 Nov');
  });

  it('gives back text that is not a date', () => {
    expect(dateLabel('soon')).toBe('soon');
    expect(dateLabel('')).toBe('');
  });
});

describe('nextWeek', () => {
  it('adds seven days', () => {
    expect(nextWeek('2026-11-10')).toBe('2026-11-17');
  });

  it('crosses a month end', () => {
    expect(nextWeek('2026-11-24')).toBe('2026-12-01');
    expect(nextWeek('2026-01-28')).toBe('2026-02-04');
  });

  it('crosses a year end', () => {
    expect(nextWeek('2026-12-29')).toBe('2027-01-05');
  });

  it('knows a leap year', () => {
    expect(nextWeek('2028-02-25')).toBe('2028-03-03');
    expect(nextWeek('2027-02-25')).toBe('2027-03-04');
  });

  it('pads month and day', () => {
    expect(nextWeek('2026-01-01')).toBe('2026-01-08');
  });

  it('gives back text that is not a date', () => {
    expect(nextWeek('soon')).toBe('soon');
  });
});

describe('whenLine', () => {
  it('joins the date, the time and the venue', () => {
    expect(whenLine(base)).toBe('Tue 10 Nov, 7 to 9 pm, Sample Hall');
  });

  it('writes both clocks when the range crosses noon', () => {
    expect(whenLine(view({ start_min: 660, end_min: 810 }))).toBe('Tue 10 Nov, 11 am to 1:30 pm, Sample Hall');
  });

  it('leaves out the venue when missing', () => {
    expect(whenLine(view({ venue: null }))).toBe('Tue 10 Nov, 7 to 9 pm');
    expect(whenLine(view({ venue: '  ' }))).toBe('Tue 10 Nov, 7 to 9 pm');
  });

  it('leaves out the time when there is none', () => {
    expect(whenLine(view({ start_min: null, end_min: null }))).toBe('Tue 10 Nov, Sample Hall');
  });

  it('says only the start when there is no end', () => {
    expect(whenLine(view({ end_min: null }))).toBe('Tue 10 Nov, from 7 pm, Sample Hall');
  });

  it('says only the end when there is no start', () => {
    expect(whenLine(view({ start_min: null }))).toBe('Tue 10 Nov, until 9 pm, Sample Hall');
  });

  it('is the date alone when nothing else is known', () => {
    expect(whenLine(view({ start_min: null, end_min: null, venue: null }))).toBe('Tue 10 Nov');
  });

  it('keeps a start at midnight', () => {
    expect(whenLine(view({ start_min: 0, end_min: 60, venue: null }))).toBe('Tue 10 Nov, 12 to 1 am');
  });
});

describe('statusLine', () => {
  it('says In with the date', () => {
    expect(statusLine('in', 'Tue 10 Nov')).toBe("You're in for Tue 10 Nov.");
  });

  it('says Maybe with the date and that it can change', () => {
    expect(statusLine('maybe', 'Tue 10 Nov')).toBe("You're a maybe for Tue 10 Nov. You can change this any time.");
  });

  it('says Out with the date', () => {
    expect(statusLine('out', 'Tue 10 Nov')).toBe("You're out for Tue 10 Nov.");
  });

  it('uses a straight apostrophe and no dash or exclamation mark', () => {
    for (const s of ['in', 'maybe', 'out'] as const) expect(statusLine(s, 'Tue 10 Nov')).not.toMatch(/[!\u2014\u2013\u2019]/);
  });
});

describe('isBusy', () => {
  it('is false at exactly 4 for each court', () => {
    expect(isBusy(busy(12, 0, 3))).toBe(false);
    expect(isBusy(busy(8, 4, 3))).toBe(false);
  });

  it('is true one past 4 for each court', () => {
    expect(isBusy(busy(13, 0, 3))).toBe(true);
    expect(isBusy(busy(9, 4, 3))).toBe(true);
  });

  it('counts friends with the people who are in', () => {
    expect(isBusy(busy(12, 1, 3))).toBe(true);
  });

  it('does not count Maybe or Out', () => {
    const v = busy(12, 0, 3);
    v.players.push({ id: 'm', first_name: 'M', last_initial: null, has_photo: false, photo_seq: 0 });
    v.answers.push({ player_id: 'm', status: 'maybe', late: false });
    v.players.push({ id: 'o', first_name: 'O', last_initial: null, has_photo: false, photo_seq: 0 });
    v.answers.push({ player_id: 'o', status: 'out', late: false });
    expect(isBusy(v)).toBe(false);
  });

  it('does not count an answer from someone no longer on the roster', () => {
    const v = busy(12, 0, 3);
    v.answers.push({ player_id: 'ghost', status: 'in', late: false });
    expect(isBusy(v)).toBe(false);
  });

  it('is false when the courts are not known', () => {
    expect(isBusy(busy(40, 10, null))).toBe(false);
  });

  it('scales with the courts', () => {
    expect(isBusy(busy(4, 0, 1))).toBe(false);
    expect(isBusy(busy(5, 0, 1))).toBe(true);
    expect(isBusy(busy(48, 0, 12))).toBe(false);
    expect(isBusy(busy(49, 0, 12))).toBe(true);
  });
});

describe('busyLine', () => {
  it('says the number in and the courts', () => {
    expect(busyLine(busy(13, 0, 3))).toBe('Busy night: 13 in for 3 courts. Expect to sit out a game now and then.');
  });

  it('counts friends in the number', () => {
    expect(busyLine(busy(10, 4, 3))).toBe('Busy night: 14 in for 3 courts. Expect to sit out a game now and then.');
  });

  it('says one court in the singular', () => {
    expect(busyLine(busy(5, 0, 1))).toBe('Busy night: 5 in for 1 court. Expect to sit out a game now and then.');
  });

  it('is null when not busy', () => {
    expect(busyLine(busy(12, 0, 3))).toBeNull();
    expect(busyLine(busy(40, 0, null))).toBeNull();
  });
});
