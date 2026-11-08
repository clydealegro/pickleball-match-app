import { describe, expect, it } from 'vitest';
import { mkEntry } from '../test/historyFixtures';
import { chipLabel, ctaGrade, doneEntry, elapsedLabel, homeLabel, nextOccurrence, sortedSlots, usualTurnout, weeksPlayed } from './homeInfo';
import type { Slot } from './slots';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (d: number, h = 0, m = 0) => new Date(2026, 5, d, h, m); // June 2026: the 16th is a Tuesday
const tue = (over: Partial<Slot> = {}): Slot => ({ id: 'tue', weekday: 2, ...over });
const clock = (h: number, m = 0) => h * 60 + m;

describe('nextOccurrence', () => {
  it("is today for today's weekday, even when its time has passed", () => {
    expect(nextOccurrence(tue({ startMin: clock(6) }), at(16, 22)).dayOffset).toBe(0);
    expect(nextOccurrence(tue(), at(16, 9)).date.getDate()).toBe(16);
  });
  it('finds the next date within 7 days', () => {
    const thu = nextOccurrence({ id: 'thu', weekday: 4 }, at(16, 9));
    expect(thu.dayOffset).toBe(2);
    expect(thu.date.getDate()).toBe(18);
    const mon = nextOccurrence({ id: 'mon', weekday: 1 }, at(16, 9));
    expect(mon.dayOffset).toBe(6);
    expect(mon.date.getDate()).toBe(22);
  });
  it('crosses a month end', () => {
    const o = nextOccurrence({ id: 'x', weekday: 5 }, new Date(2026, 5, 30, 9)); // Tue 30 June, next Friday
    expect(o.dayOffset).toBe(3);
    expect([o.date.getMonth(), o.date.getDate()]).toEqual([6, 3]);
  });
});

describe('homeLabel', () => {
  it('says Today when it is today and there is no start time', () => {
    expect(homeLabel(tue(), at(16, 9))).toBe('Today');
    expect(homeLabel(tue({ endMin: clock(20) }), at(16, 23))).toBe('Today');
  });
  it('says Today before 17:00 and Tonight from 17:00, when the start is over an hour away', () => {
    expect(homeLabel(tue({ startMin: clock(16, 59) }), at(16, 8))).toBe('Today');
    expect(homeLabel(tue({ startMin: clock(17) }), at(16, 8))).toBe('Tonight');
    expect(homeLabel(tue({ startMin: clock(19) }), at(16, 8))).toBe('Tonight');
  });
  it('counts down in the last hour', () => {
    expect(homeLabel(tue({ startMin: clock(19) }), at(16, 18, 0))).toBe('Starts in 60 min');
    expect(homeLabel(tue({ startMin: clock(19) }), at(16, 17, 59))).toBe('Tonight');
    expect(homeLabel(tue({ startMin: clock(19) }), at(16, 18, 59))).toBe('Starts in 1 min');
    expect(homeLabel(tue({ startMin: clock(19) }), at(16, 18, 30))).toBe('Starts in 30 min');
  });
  it('says how long ago it started, under an hour', () => {
    expect(homeLabel(tue({ startMin: clock(19) }), at(16, 19, 20))).toBe('Started 20 min ago');
    expect(homeLabel(tue({ startMin: clock(19) }), at(16, 19, 59))).toBe('Started 59 min ago');
    expect(homeLabel(tue({ startMin: clock(19) }), at(16, 19, 0))).toBe('Started 0 min ago');
  });
  it('shows the start clock from an hour in', () => {
    expect(homeLabel(tue({ startMin: clock(19) }), at(16, 20, 0))).toBe('Started 7:00 pm');
    expect(homeLabel(tue({ startMin: clock(19) }), at(16, 20, 1))).toBe('Started 7:00 pm');
    expect(homeLabel(tue({ startMin: clock(19), endMin: clock(21) }), at(16, 21, 0))).toBe('Started 7:00 pm');
  });
  it('says Earlier today once past the end', () => {
    expect(homeLabel(tue({ startMin: clock(19), endMin: clock(21) }), at(16, 21, 1))).toBe('Earlier today');
  });
  it('keeps saying Started when there is no end time', () => {
    expect(homeLabel(tue({ startMin: clock(19) }), at(16, 23, 30))).toBe('Started 7:00 pm');
  });
  it('handles a slot that is today whose time has passed', () => {
    expect(homeLabel(tue({ startMin: clock(6), endMin: clock(8) }), at(16, 22))).toBe('Earlier today');
    expect(homeLabel(tue({ startMin: clock(6) }), at(16, 22))).toBe('Started 6:00 am');
  });
  it('says Tomorrow and In n days', () => {
    const wed = { id: 'wed', weekday: 3, startMin: clock(10) };
    expect(homeLabel(wed, at(16, 23))).toBe('Tomorrow');
    expect(homeLabel({ id: 'sat', weekday: 6 }, at(16, 9))).toBe('In 4 days');
    expect(homeLabel({ id: 'sun', weekday: 0 }, at(16, 9))).toBe('In 5 days');
    expect(homeLabel({ id: 'mon', weekday: 1 }, at(16, 9))).toBe('In 6 days');
    expect(homeLabel({ id: 'thu', weekday: 4 }, at(16, 9))).toBe('In 2 days');
  });
});

describe('ctaGrade', () => {
  const s = tue({ startMin: clock(19), endMin: clock(21) });
  it('is primary from 3 hours before the start', () => {
    expect(ctaGrade(s, at(16, 16, 0))).toBe('primary');
    expect(ctaGrade(s, at(16, 15, 59))).toBe('quiet');
    expect(ctaGrade(s, at(16, 17))).toBe('primary');
  });
  it('is primary up to 3 hours after the end', () => {
    expect(ctaGrade(s, at(16, 23, 59))).toBe('primary');
    expect(ctaGrade(tue({ startMin: clock(8), endMin: clock(10) }), at(16, 13, 0))).toBe('primary');
    expect(ctaGrade(tue({ startMin: clock(8), endMin: clock(10) }), at(16, 13, 1))).toBe('quiet');
  });
  it('is quiet when the next occurrence is not today', () => {
    expect(ctaGrade({ id: 'wed', weekday: 3, startMin: clock(9) }, at(16, 23))).toBe('quiet');
    expect(ctaGrade({ id: 'wed', weekday: 3 }, at(16, 9))).toBe('quiet');
  });
  it('ignores a missing start or end', () => {
    expect(ctaGrade(tue(), at(16, 3))).toBe('primary');
    expect(ctaGrade(tue({ endMin: clock(10) }), at(16, 1))).toBe('primary');
    expect(ctaGrade(tue({ endMin: clock(10) }), at(16, 13, 1))).toBe('quiet');
    expect(ctaGrade(tue({ startMin: clock(19) }), at(16, 15, 59))).toBe('quiet');
    expect(ctaGrade(tue({ startMin: clock(19) }), at(16, 23, 59))).toBe('primary');
  });
});

describe('sortedSlots and chipLabel', () => {
  const sat: Slot = { id: 'sat', weekday: 6 };
  const thu: Slot = { id: 'thu', weekday: 4 };
  const ids = (xs: Slot[]) => xs.map((s) => s.id);
  it("puts today's slot first, then the following days", () => {
    expect(ids(sortedSlots([sat, thu, tue()], at(16, 9)))).toEqual(['tue', 'thu', 'sat']);
    expect(ids(sortedSlots([tue(), thu, sat], at(18, 9)))).toEqual(['thu', 'sat', 'tue']);
  });
  it('wraps past Saturday', () => {
    const sun: Slot = { id: 'sun', weekday: 0 };
    expect(ids(sortedSlots([tue(), sat, sun], at(13, 9)))).toEqual(['sat', 'sun', 'tue']);
    expect(ids(sortedSlots([tue(), sat, sun], at(14, 9)))).toEqual(['sun', 'tue', 'sat']);
  });
  it('orders the same day by start, with unset last', () => {
    const a = tue({ id: 'a', startMin: clock(19) });
    const b = tue({ id: 'b', startMin: clock(8) });
    const c = tue({ id: 'c' });
    const d = tue({ id: 'd', startMin: clock(8) });
    expect(ids(sortedSlots([c, a, b, d], at(16, 9)))).toEqual(['b', 'd', 'a', 'c']);
  });
  it('does not change the list it was given', () => {
    const list = [sat, thu, tue()];
    sortedSlots(list, at(16, 9));
    expect(ids(list)).toEqual(['sat', 'thu', 'tue']);
  });
  it('labels a chip with the weekday and date of the next occurrence', () => {
    expect(chipLabel(tue(), at(16, 9))).toBe('Tue 16');
    expect(chipLabel(thu, at(16, 9))).toBe('Thu 18');
    expect(chipLabel(tue(), at(17, 9))).toBe('Tue 23');
    expect(chipLabel({ id: 'sun', weekday: 0 }, at(16, 9))).toBe('Sun 21');
  });
});

describe('usualTurnout', () => {
  // Sessions on Tuesdays (16 June, 9 June, 2 June, 26 May, ...) and one on a Thursday.
  const tueEntry = (day: number, month: number, players: number) =>
    mkEntry(new Date(2026, month, day, 18).getTime(), new Date(2026, month, day, 20).getTime(), players);
  it('is undefined with fewer than 2 matching entries', () => {
    expect(usualTurnout([], 2)).toBeUndefined();
    expect(usualTurnout([tueEntry(16, 5, 10)], 2)).toBeUndefined();
    expect(usualTurnout([tueEntry(16, 5, 10), tueEntry(18, 5, 12)], 2)).toBeUndefined();
  });
  it('gives the range from exactly 2 entries', () => {
    expect(usualTurnout([tueEntry(16, 5, 10), tueEntry(9, 5, 14)], 2)).toEqual({ min: 10, max: 14 });
  });
  it('can have min equal to max', () => {
    expect(usualTurnout([tueEntry(16, 5, 12), tueEntry(9, 5, 12)], 2)).toEqual({ min: 12, max: 12 });
  });
  it('uses only the latest 6, wherever they sit in the list', () => {
    const entries = [
      tueEntry(16, 5, 12),
      tueEntry(9, 5, 12),
      tueEntry(2, 5, 12),
      tueEntry(26, 4, 12),
      tueEntry(19, 4, 12),
      tueEntry(12, 4, 12),
      tueEntry(5, 4, 4), // the 7th most recent, left out
    ];
    expect(usualTurnout(entries, 2)).toEqual({ min: 12, max: 12 });
    expect(usualTurnout([...entries].reverse(), 2)).toEqual({ min: 12, max: 12 });
    // an older, larger one is also left out
    expect(usualTurnout([...entries, tueEntry(28, 3, 20)], 2)).toEqual({ min: 12, max: 12 });
  });
  it('counts only sessions that started on that weekday', () => {
    const entries = [tueEntry(16, 5, 10), tueEntry(18, 5, 30), tueEntry(9, 5, 14), tueEntry(11, 5, 2)];
    expect(usualTurnout(entries, 2)).toEqual({ min: 10, max: 14 });
    expect(usualTurnout(entries, 4)).toEqual({ min: 2, max: 30 });
    expect(usualTurnout(entries, 6)).toBeUndefined();
  });
  it('uses the day the session started, not the day it ended', () => {
    // Starts Tuesday 23:00, ends Wednesday 01:00.
    const late = mkEntry(new Date(2026, 5, 16, 23).getTime(), new Date(2026, 5, 17, 1).getTime(), 9);
    expect(usualTurnout([late, tueEntry(9, 5, 11)], 2)).toEqual({ min: 9, max: 11 });
    expect(usualTurnout([late, tueEntry(9, 5, 11)], 3)).toBeUndefined();
  });
});

describe('weeksPlayed', () => {
  const now = at(16, 12).getTime();
  const ended = (ago: number) => mkEntry(now - ago - HOUR, now - ago);
  it('is undefined with fewer than 3 entries in total', () => {
    expect(weeksPlayed([], at(16, 12))).toBeUndefined();
    expect(weeksPlayed([ended(DAY), ended(2 * DAY)], at(16, 12))).toBeUndefined();
  });
  it('gives of 10 once there are 3 entries', () => {
    expect(weeksPlayed([ended(DAY), ended(2 * DAY), ended(3 * DAY)], at(16, 12))).toEqual({ played: 1, of: 10 });
  });
  it('counts all ten windows when each has a session', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ended(DAY + i * 7 * DAY));
    expect(weeksPlayed(entries, at(16, 12))).toEqual({ played: 10, of: 10 });
  });
  it('counts a window once however many sessions it holds', () => {
    expect(weeksPlayed([ended(HOUR), ended(2 * HOUR), ended(3 * HOUR), ended(4 * HOUR)], at(16, 12))).toEqual({ played: 1, of: 10 });
  });
  it('counts 9 when one window is empty', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ended(DAY + i * 7 * DAY)).filter((_, i) => i !== 4);
    expect(weeksPlayed(entries, at(16, 12))).toEqual({ played: 9, of: 10 });
  });
  it('counts none when every session is older than 10 weeks', () => {
    const entries = [ended(71 * DAY), ended(80 * DAY), ended(200 * DAY)];
    expect(weeksPlayed(entries, at(16, 12))).toEqual({ played: 0, of: 10 });
  });
  it('puts a session ended exactly 7 days ago in the second window, and exactly now in the first', () => {
    const entries = [mkEntry(0, now - HOUR), mkEntry(0, now - 7 * DAY), mkEntry(0, now - 30 * DAY)];
    expect(weeksPlayed(entries, at(16, 12))).toEqual({ played: 3, of: 10 });
    const atNow = [mkEntry(0, now), mkEntry(0, now - 7 * DAY - 1), mkEntry(0, now - 30 * DAY)];
    expect(weeksPlayed(atNow, at(16, 12))).toEqual({ played: 3, of: 10 });
    const same = [mkEntry(0, now), mkEntry(0, now - HOUR), mkEntry(0, now - 2 * HOUR)];
    expect(weeksPlayed(same, at(16, 12))).toEqual({ played: 1, of: 10 });
  });
  it('stops at 70 days back', () => {
    const edge = [mkEntry(0, now - 70 * DAY), mkEntry(0, now - 71 * DAY), mkEntry(0, now - 72 * DAY)];
    expect(weeksPlayed(edge, at(16, 12))).toEqual({ played: 0, of: 10 });
    const inside = [mkEntry(0, now - 70 * DAY + 1), mkEntry(0, now - 71 * DAY), mkEntry(0, now - 72 * DAY)];
    expect(weeksPlayed(inside, at(16, 12))).toEqual({ played: 1, of: 10 });
  });
  it('ignores a session that ended after now', () => {
    expect(weeksPlayed([mkEntry(0, now + DAY), mkEntry(0, now + 2 * DAY), mkEntry(0, now + 3 * DAY)], at(16, 12))).toEqual({ played: 0, of: 10 });
  });
});

describe('doneEntry', () => {
  const now = at(16, 12);
  const n = now.getTime();
  const e = (agoMs: number, id = 'x') => mkEntry(n - agoMs - HOUR, n - agoMs, 8, id);
  it('finds an entry that ended 23h59m ago', () => {
    expect(doneEntry([e(23 * HOUR + 59 * MIN)], now, false)?.id).toBe('x');
  });
  it('ignores one that ended 24h01m ago', () => {
    expect(doneEntry([e(24 * HOUR + MIN)], now, false)).toBeUndefined();
  });
  it('ignores one that ended exactly 24h ago', () => {
    expect(doneEntry([e(24 * HOUR)], now, false)).toBeUndefined();
  });
  it('is undefined while a session is running', () => {
    expect(doneEntry([e(HOUR)], now, true)).toBeUndefined();
  });
  it('is undefined with no entries', () => {
    expect(doneEntry([], now, false)).toBeUndefined();
  });
  it('picks the latest that ended, whatever the list order', () => {
    const old = e(10 * HOUR, 'old');
    const recent = e(2 * HOUR, 'recent');
    expect(doneEntry([old, recent], now, false)?.id).toBe('recent');
    expect(doneEntry([recent, old], now, false)?.id).toBe('recent');
  });
  it('does not fall back to an older entry when the latest is too old', () => {
    expect(doneEntry([e(30 * HOUR, 'a'), e(40 * HOUR, 'b')], now, false)).toBeUndefined();
  });
});

describe('elapsedLabel', () => {
  const s = at(16, 12).getTime();
  it('shows minutes under an hour', () => {
    expect(elapsedLabel(s, s)).toBe('0m');
    expect(elapsedLabel(s, s + 59 * MIN)).toBe('59m');
    expect(elapsedLabel(s, s + 59 * MIN + 59_000)).toBe('59m');
  });
  it('shows hours and minutes from an hour', () => {
    expect(elapsedLabel(s, s + 60 * MIN)).toBe('1h 0m');
    expect(elapsedLabel(s, s + 72 * MIN)).toBe('1h 12m');
    expect(elapsedLabel(s, s + 2 * HOUR + 5 * MIN)).toBe('2h 5m');
  });
  it('never goes below zero', () => {
    expect(elapsedLabel(s, s - 5 * MIN)).toBe('0m');
  });
});
