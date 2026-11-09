import { describe, expect, it } from 'vitest';
import type { Slot } from '../../store/slots';
import { listText, nudgeText } from './copy';
import type { Summary } from './types';

const TUE: Slot = { id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Sample Hall', courts: 3 };
const summary = (over: Partial<Summary> = {}): Summary => ({
  slotId: 'tue',
  code: 'abc',
  playDate: '2026-11-10',
  cancelled: null,
  counts: { in: 0, maybe: 0, out: 0, late: 0 },
  friends: 0,
  waiting: [],
  tonight: [],
  lateIds: [],
  answers: {},
  names: {},
  fetchedAt: 1,
  ...over,
});

describe('listText', () => {
  it('writes the heading, the In line, the Maybe line and the Friends line, in that order', () => {
    const s = summary({
      names: { a: 'Ana', b: 'Ben', c: 'Cy', d: 'Di' },
      answers: { a: 'in', b: 'in', c: 'maybe', d: 'out' },
      tonight: [{ id: 'g1', name: 'Fay', broughtBy: 'a' }],
    });
    expect(listText(TUE, s)).toBe(
      ['Tuesday open play, Tue 10 Nov, 7:00 to 9:00 pm, Sample Hall', 'In (2): Ana, Ben', 'Maybe (1): Cy', 'Friends (1): Fay'].join('\n'),
    );
  });

  it('has no trailing newline', () => {
    expect(listText(TUE, summary()).endsWith('\n')).toBe(false);
  });

  it('shows In (0) with nothing after it when nobody is in, and leaves the other lines off', () => {
    expect(listText(TUE, summary())).toBe('Tuesday open play, Tue 10 Nov, 7:00 to 9:00 pm, Sample Hall\nIn (0)');
  });

  it('marks a late name', () => {
    const s = summary({ names: { a: 'Ana', b: 'Ben' }, answers: { a: 'in', b: 'in' }, lateIds: ['b'] });
    expect(listText(TUE, s).split('\n')[1]).toBe('In (2): Ana, Ben (late)');
  });

  it('never lists Out answers', () => {
    const s = summary({ names: { a: 'Ana', b: 'Ben' }, answers: { a: 'out', b: 'out' } });
    expect(listText(TUE, s)).not.toMatch(/Ana|Ben/);
  });

  it('leaves the Maybe line off at zero and the Friends line off at zero', () => {
    const s = summary({ names: { a: 'Ana' }, answers: { a: 'in' } });
    expect(listText(TUE, s)).not.toMatch(/Maybe|Friends/);
  });

  it('does not list pending names as friends', () => {
    const s = summary({ waiting: [{ id: 'w', name: 'Pat', broughtBy: 'a' }] });
    expect(listText(TUE, s)).not.toMatch(/Friends|Pat/);
  });

  it('sorts names ignoring case in every line, with the late mark following its name', () => {
    const s = summary({
      names: { a: 'zed', b: 'Ben', c: 'ana', d: 'Kai', e: 'al' },
      answers: { a: 'in', b: 'in', c: 'in', d: 'maybe', e: 'maybe' },
      lateIds: ['c'],
      tonight: [
        { id: 'g1', name: 'zoe', broughtBy: null },
        { id: 'g2', name: 'Amy', broughtBy: null },
      ],
    });
    const lines = listText(TUE, s).split('\n');
    expect(lines[1]).toBe('In (3): ana (late), Ben, zed');
    expect(lines[2]).toBe('Maybe (2): al, Kai');
    expect(lines[3]).toBe('Friends (2): Amy, zoe');
  });

  it('leaves out the time part when the slot has no time', () => {
    const slot: Slot = { id: 'tue', weekday: 2, venue: 'Sample Hall' };
    expect(listText(slot, summary()).split('\n')[0]).toBe('Tuesday open play, Tue 10 Nov, Sample Hall');
  });

  it('leaves out the venue part when the slot has no venue, or a blank one', () => {
    expect(listText({ ...TUE, venue: undefined }, summary()).split('\n')[0]).toBe('Tuesday open play, Tue 10 Nov, 7:00 to 9:00 pm');
    expect(listText({ ...TUE, venue: '  ' }, summary()).split('\n')[0]).toBe('Tuesday open play, Tue 10 Nov, 7:00 to 9:00 pm');
  });

  it('is just the title and the date for a bare slot', () => {
    expect(listText({ id: 'tue', weekday: 2 }, summary()).split('\n')[0]).toBe('Tuesday open play, Tue 10 Nov');
  });

  it('writes a start time alone and an end time alone the way slots do', () => {
    expect(listText({ ...TUE, endMin: undefined, venue: undefined }, summary()).split('\n')[0]).toBe('Tuesday open play, Tue 10 Nov, From 7:00 pm');
    expect(listText({ ...TUE, startMin: undefined, venue: undefined }, summary()).split('\n')[0]).toBe('Tuesday open play, Tue 10 Nov, Until 9:00 pm');
  });

  it('names the date from the summary, not from today', () => {
    expect(listText(TUE, summary({ playDate: '2026-12-01' })).split('\n')[0]).toContain('Tue 1 Dec');
  });
});

describe('nudgeText', () => {
  const maybes = (...names: string[]) =>
    summary({
      names: Object.fromEntries(names.map((n, i) => [`p${i}`, n])),
      answers: Object.fromEntries(names.map((_, i) => [`p${i}`, 'maybe' as const])),
    });

  it('asks one maybe', () => {
    expect(nudgeText(TUE, maybes('Ben'))).toBe('Ben, are you in for Tuesday?');
  });

  it('joins two maybes with and', () => {
    expect(nudgeText(TUE, maybes('Kai', 'Ben'))).toBe('Ben and Kai, are you in for Tuesday?');
  });

  it('joins three maybes with commas and a last and', () => {
    expect(nudgeText(TUE, maybes('Kai', 'ian', 'Ben'))).toBe('Ben, ian and Kai, are you in for Tuesday?');
  });

  it('is an empty string with no maybes', () => {
    expect(nudgeText(TUE, summary())).toBe('');
  });

  it('only asks players who answered Maybe', () => {
    const s = summary({ names: { a: 'Ana', b: 'Ben', c: 'Cy' }, answers: { a: 'in', b: 'maybe', c: 'out' } });
    expect(nudgeText(TUE, s)).toBe('Ben, are you in for Tuesday?');
  });

  it('uses the slot weekday and carries no link', () => {
    const text = nudgeText({ id: 'thu', weekday: 4 }, { ...maybes('Ben'), code: 'secretcode' });
    expect(text).toBe('Ben, are you in for Thursday?');
    expect(text).not.toMatch(/secretcode|http|#/);
  });
});
