import { describe, expect, it } from 'vitest';
import type { AttendanceViewData } from '../sync/attendance/types';
import { calendarFile } from './ics';

const NOW = Date.UTC(2026, 10, 9, 12, 30, 5);
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
const file = (patch: Partial<AttendanceViewData> = {}) => calendarFile({ ...base, ...patch }, NOW);
const lines = (text: string) => text.split('\r\n');
const octets = (s: string) => new TextEncoder().encode(s).length;
const unfold = (text: string) => text.replace(/\r\n /g, '');

describe('calendarFile', () => {
  it('writes a full event, exactly', () => {
    expect(file().text).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//PIKLMatch//Attendance//EN',
        'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT',
        'UID:2026-11-10-tuesday-open-play@piklmatch',
        'DTSTAMP:20261109T123005Z',
        'DTSTART:20261110T190000',
        'DTEND:20261110T210000',
        'SUMMARY:Tuesday open play',
        'LOCATION:Sample Hall',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
  });

  it('names the file after the title and the date', () => {
    expect(file().name).toBe('tuesday-open-play-2026-11-10.ics');
  });

  it('writes a two hour event when there is a start and no end', () => {
    const text = file({ end_min: null }).text;
    expect(text).toContain('\r\nDTSTART:20261110T190000\r\n');
    expect(text).toContain('\r\nDTEND:20261110T210000\r\n');
  });

  it('runs a two hour event past midnight into the next day', () => {
    const text = file({ start_min: 1380, end_min: null }).text;
    expect(text).toContain('\r\nDTSTART:20261110T230000\r\n');
    expect(text).toContain('\r\nDTEND:20261111T010000\r\n');
  });

  it('runs an end that is not after the start into the next day', () => {
    const text = file({ start_min: 1320, end_min: 60 }).text;
    expect(text).toContain('\r\nDTSTART:20261110T220000\r\n');
    expect(text).toContain('\r\nDTEND:20261111T010000\r\n');
    const same = file({ start_min: 600, end_min: 600 }).text;
    expect(same).toContain('\r\nDTEND:20261111T100000\r\n');
  });

  it('writes an all-day event when there is no start', () => {
    const text = file({ start_min: null, end_min: null }).text;
    expect(text).toContain('\r\nDTSTART;VALUE=DATE:20261110\r\n');
    expect(text).toContain('\r\nDTEND;VALUE=DATE:20261111\r\n');
    expect(text).not.toContain('DTSTART:');
  });

  it('writes an all-day event when there is an end and no start', () => {
    const text = file({ start_min: null, end_min: 1260 }).text;
    expect(text).toContain('\r\nDTSTART;VALUE=DATE:20261110\r\n');
  });

  it('ends an all-day event on the next day across a month and a year', () => {
    expect(file({ start_min: null, end_min: null, play_date: '2026-11-30' }).text).toContain('DTEND;VALUE=DATE:20261201');
    expect(file({ start_min: null, end_min: null, play_date: '2026-12-31' }).text).toContain('DTEND;VALUE=DATE:20270101');
  });

  it('pads the clock and the date', () => {
    const text = file({ play_date: '2027-01-05', start_min: 65, end_min: 125 }).text;
    expect(text).toContain('DTSTART:20270105T010500');
    expect(text).toContain('DTEND:20270105T020500');
  });

  it('leaves out the location when the venue is missing or blank', () => {
    expect(file({ venue: null }).text).not.toContain('LOCATION');
    expect(file({ venue: '   ' }).text).not.toContain('LOCATION');
  });

  it('uses CRLF for every line and ends with one', () => {
    const text = file().text;
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('has the same UID for the same date and a different one for another date', () => {
    const uid = (t: string) => /UID:(.*)\r\n/.exec(t)![1];
    expect(uid(file().text)).toBe('2026-11-10-tuesday-open-play@piklmatch');
    expect(uid(file({ play_date: '2026-11-17' }).text)).toBe('2026-11-17-tuesday-open-play@piklmatch');
  });

  it('makes the UID slug from lower case letters, digits and single dashes', () => {
    const uid = (t: string) => /UID:(.*)\r\n/.exec(t)![1];
    expect(uid(file({ title: "  Friday: Night's  Open Play!! " }).text)).toBe('2026-11-10-friday-night-s-open-play@piklmatch');
    expect(uid(file({ title: '!!!' }).text)).toBe('2026-11-10-open-play@piklmatch');
    expect(file({ title: '!!!' }).name).toBe('open-play-2026-11-10.ics');
  });

  it('never has the link code in it', () => {
    const code = 'abcdef0123456789abcdef01';
    expect(JSON.stringify(file())).not.toContain(code);
    expect(file().text).not.toMatch(/\/#\/j\//);
  });

  it('escapes backslash, semicolon, comma and newline', () => {
    const text = file({ title: 'A;B,C\\D', venue: 'Hall 1\nGate 2\r\nUp\rDown' }).text;
    expect(text).toContain('\r\nSUMMARY:A\\;B\\,C\\\\D\r\n');
    expect(text).toContain('\r\nLOCATION:Hall 1\\nGate 2\\nUp\\nDown\r\n');
  });

  it('escapes the backslash first, so it does not escape twice', () => {
    expect(file({ title: 'a\\;b' }).text).toContain('SUMMARY:a\\\\\\;b');
  });

  it('keeps every line to 75 octets', () => {
    const long = 'Spring league, doubles; mixed é ' + 'x'.repeat(200);
    const text = file({ title: long, venue: 'V'.repeat(300) }).text;
    for (const l of lines(text)) expect(octets(l)).toBeLessThanOrEqual(75);
  });

  it('folds a long line with a CRLF and one space, and unfolds to the original', () => {
    const title = 'T'.repeat(200);
    const text = file({ title }).text;
    const out = lines(text);
    const at = out.findIndex((l) => l.startsWith('SUMMARY:'));
    expect(out[at]).toHaveLength(75);
    expect(out[at + 1].startsWith(' ')).toBe(true);
    expect(unfold(text)).toContain(`SUMMARY:${title}\r\n`);
  });

  it('does not fold a line of exactly 75 octets', () => {
    const title = 'T'.repeat(75 - 'SUMMARY:'.length);
    const text = file({ title }).text;
    expect(text).toContain(`\r\nSUMMARY:${title}\r\n`);
  });

  it('folds a line of 76 octets', () => {
    const title = 'T'.repeat(76 - 'SUMMARY:'.length);
    const out = lines(file({ title }).text);
    const at = out.findIndex((l) => l.startsWith('SUMMARY:'));
    expect(out[at]).toHaveLength(75);
    expect(out[at + 1]).toBe(' T');
  });

  it('never splits a multi-byte character when folding', () => {
    const title = 'é'.repeat(100);
    const text = file({ title }).text;
    for (const l of lines(text)) expect(octets(l)).toBeLessThanOrEqual(75);
    expect(unfold(text)).toContain(`SUMMARY:${title}\r\n`);
    expect(text).not.toContain('�');
  });

  it('never splits an emoji when folding', () => {
    const title = '\u{1F3D3}'.repeat(40);
    const text = file({ title }).text;
    for (const l of lines(text)) expect(octets(l)).toBeLessThanOrEqual(75);
    expect(unfold(text)).toContain(`SUMMARY:${title}\r\n`);
  });

  it('counts the leading space of a continuation line in its 75 octets', () => {
    const out = lines(file({ title: 'T'.repeat(400) }).text);
    const folded = out.filter((l) => l.startsWith(' '));
    expect(folded.length).toBeGreaterThan(1);
    expect(folded.some((l) => octets(l) === 75)).toBe(true);
  });

  it('writes the time stamp in UTC from the moment it is given', () => {
    expect(calendarFile(base, Date.UTC(2027, 0, 2, 3, 4, 5)).text).toContain('DTSTAMP:20270102T030405Z');
  });
});
