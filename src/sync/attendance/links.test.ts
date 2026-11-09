import { describe, expect, it } from 'vitest';
import type { Slot } from '../../store/slots';
import { diffChange, displayNames, linkRow, localDate, safeTimezone, shareUrl, summarize, titleFor, weekdayName } from './links';
import type { AttendanceStatus, AttendanceViewData } from './types';

const player = (id: string, first: string, initial: string | null = null) => ({
  id,
  first_name: first,
  last_initial: initial,
  has_photo: false,
  photo_seq: 0,
});

describe('weekdayName and titleFor', () => {
  it('names Sunday to Saturday', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(weekdayName)).toEqual([
      'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
    ]);
  });

  it('titles a slot "{Weekday} open play"', () => {
    expect(titleFor({ id: 'tue', weekday: 2 })).toBe('Tuesday open play');
    expect(titleFor({ id: 'sun', weekday: 0 })).toBe('Sunday open play');
  });
});

describe('safeTimezone', () => {
  it('keeps a plausible zone name', () => {
    expect(safeTimezone('Asia/Manila')).toBe('Asia/Manila');
    expect(safeTimezone('America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
    expect(safeTimezone('Etc/GMT+8')).toBe('Etc/GMT+8');
    expect(safeTimezone('UTC')).toBe('UTC');
  });

  it('falls back to Asia/Manila for anything else', () => {
    for (const raw of [undefined, null, '', 'Not a zone', 'Asia/Man ila', '/Asia', 'Asia//Manila', "Asia/Manila'; drop", 'GMT+8 ']) {
      expect(safeTimezone(raw)).toBe('Asia/Manila');
    }
  });
});

describe('linkRow', () => {
  it('copies the slot into the columns the client writes', () => {
    const slot: Slot = { id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: ' Sample Hall ', courts: 3 };
    expect(linkRow(slot, 'Asia/Manila')).toEqual({
      slot_id: 'tue',
      title: 'Tuesday open play',
      weekday: 2,
      start_min: 1140,
      end_min: 1260,
      venue: 'Sample Hall',
      courts: 3,
      timezone: 'Asia/Manila',
    });
  });

  it('writes nulls for what the slot lacks, so a removed time is cleared on the link', () => {
    const row = linkRow({ id: 'sat', weekday: 6, venue: '   ' }, 'Asia/Manila');
    expect(row).toMatchObject({ start_min: null, end_min: null, venue: null, courts: null });
  });

  it('never carries the code or closed_through', () => {
    const keys = Object.keys(linkRow({ id: 'tue', weekday: 2 }, 'Asia/Manila'));
    expect(keys).not.toContain('code');
    expect(keys).not.toContain('closed_through');
  });

  it('replaces an unsafe zone', () => {
    expect(linkRow({ id: 'tue', weekday: 2 }, 'nope nope').timezone).toBe('Asia/Manila');
    expect(linkRow({ id: 'tue', weekday: 2 }, 'Australia/Sydney').timezone).toBe('Australia/Sydney');
  });
});

describe('displayNames', () => {
  it('uses the first name alone when it is unique', () => {
    expect(displayNames([player('a', 'Ana', 'R'), player('b', 'Ben', 'C')])).toEqual({ a: 'Ana', b: 'Ben' });
  });

  it('adds the last initial when two players share a first name, ignoring case', () => {
    const names = displayNames([player('a', 'Ben', 'C'), player('b', 'ben', 'D'), player('c', 'Ana', 'R')]);
    expect(names).toEqual({ a: 'Ben C.', b: 'ben D.', c: 'Ana' });
  });

  it('leaves a shared first name bare when there is no initial', () => {
    expect(displayNames([player('a', 'Ben', null), player('b', 'Ben', 'D')])).toEqual({ a: 'Ben', b: 'Ben D.' });
  });
});

describe('summarize', () => {
  const view = (over: Partial<AttendanceViewData> = {}): AttendanceViewData => ({
    title: 'Tuesday open play',
    weekday: 2,
    venue: null,
    start_min: null,
    end_min: null,
    courts: null,
    play_date: '2026-11-10',
    cancelled: null,
    players: [player('a', 'Ana'), player('b', 'Ben'), player('c', 'Cy'), player('d', 'Di'), player('e', 'Ed')],
    answers: [
      { player_id: 'a', status: 'in', late: true },
      { player_id: 'b', status: 'in', late: false },
      { player_id: 'c', status: 'maybe', late: false },
      { player_id: 'd', status: 'out', late: false },
    ],
    friends: 2,
    ...over,
  });

  it('counts in, maybe, out and late, and keeps friends and waiting names', () => {
    const waiting = [{ id: 'g1', name: 'Zed', broughtBy: null }];
    const s = summarize('tue', 'abc', view(), waiting, 5000);
    expect(s).toEqual({
      slotId: 'tue',
      code: 'abc',
      playDate: '2026-11-10',
      cancelled: null,
      counts: { in: 2, maybe: 1, out: 1, late: 1 },
      friends: 2,
      waiting,
      answers: { a: 'in', b: 'in', c: 'maybe', d: 'out' },
      names: { a: 'Ana', b: 'Ben', c: 'Cy', d: 'Di', e: 'Ed' },
      fetchedAt: 5000,
    });
  });

  it('counts a player who has not answered nowhere', () => {
    const s = summarize('tue', 'abc', view({ answers: [] }), [], 1);
    expect(s.counts).toEqual({ in: 0, maybe: 0, out: 0, late: 0 });
  });

  it('ignores an answer from someone no longer on the roster', () => {
    const s = summarize('tue', 'abc', view({ answers: [{ player_id: 'gone', status: 'in', late: false }] }), [], 1);
    expect(s.counts.in).toBe(0);
    expect(s.answers).toEqual({});
  });

  it('carries the cancellation', () => {
    const s = summarize('tue', 'abc', view({ cancelled: { reason: 'Rain' } }), [], 1);
    expect(s.cancelled).toEqual({ reason: 'Rain' });
  });
});

describe('diffChange', () => {
  const names = { a: 'Ana', b: 'Ben' };
  const answers = (o: Record<string, AttendanceStatus>) => o;

  it('reports a player who changed to a different status', () => {
    expect(diffChange(answers({ a: 'in', b: 'in' }), answers({ a: 'in', b: 'out' }), names, 99)).toEqual({
      player: 'Ben',
      from: 'in',
      to: 'out',
      at: 99,
    });
  });

  it('does not count a first answer as a change', () => {
    expect(diffChange(answers({ a: 'in' }), answers({ a: 'in', b: 'out' }), names, 1)).toBeNull();
  });

  it('returns null when nothing changed, or when there is no previous list', () => {
    expect(diffChange(answers({ a: 'in' }), answers({ a: 'in' }), names, 1)).toBeNull();
    expect(diffChange(undefined, answers({ a: 'in' }), names, 1)).toBeNull();
  });

  it('keeps the last of several changes, in the order of the new answers', () => {
    const note = diffChange(answers({ a: 'in', b: 'in' }), answers({ a: 'maybe', b: 'out' }), names, 7);
    expect(note).toEqual({ player: 'Ben', from: 'in', to: 'out', at: 7 });
  });

  it('does not report an answer that went away', () => {
    expect(diffChange(answers({ a: 'in', b: 'in' }), answers({ a: 'in' }), names, 1)).toBeNull();
  });

  it('skips a player with no display name', () => {
    expect(diffChange(answers({ z: 'in' }), answers({ z: 'out' }), names, 1)).toBeNull();
  });
});

describe('localDate', () => {
  it('rolls to the next day in Manila when UTC is late evening', () => {
    const ms = Date.UTC(2026, 10, 9, 23, 30); // 9 Nov 23:30 UTC is 10 Nov 07:30 in Manila
    expect(localDate(ms, 'UTC')).toBe('2026-11-09');
    expect(localDate(ms, 'Asia/Manila')).toBe('2026-11-10');
  });

  it('goes back a day in a zone behind UTC', () => {
    const ms = Date.UTC(2026, 10, 10, 3, 0); // 10 Nov 03:00 UTC is 9 Nov 22:00 in New York
    expect(localDate(ms, 'America/New_York')).toBe('2026-11-09');
    expect(localDate(ms, 'Asia/Manila')).toBe('2026-11-10');
  });

  it('pads month and day', () => {
    expect(localDate(Date.UTC(2026, 0, 5, 12), 'UTC')).toBe('2026-01-05');
  });
});

describe('shareUrl', () => {
  it('joins the origin, /j/ and the code', () => {
    expect(shareUrl('https://pikl.example', 'abc123')).toBe('https://pikl.example/j/abc123');
  });

  it('does not double a trailing slash', () => {
    expect(shareUrl('https://pikl.example/', 'abc')).toBe('https://pikl.example/j/abc');
  });
});
