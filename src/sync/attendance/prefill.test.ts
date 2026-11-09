import { describe, expect, it } from 'vitest';
import { prefillFor } from './prefill';
import type { Summary } from './types';

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
const TODAY = '2026-11-10';

describe('prefillFor', () => {
  it('is null with no summary', () => {
    expect(prefillFor(undefined, TODAY)).toBeNull();
  });

  it('is null when the summary is for another day, earlier or later', () => {
    expect(prefillFor(summary(), '2026-11-09')).toBeNull();
    expect(prefillFor(summary(), '2026-11-11')).toBeNull();
    expect(prefillFor(summary({ playDate: '2026-11-03' }), TODAY)).toBeNull();
  });

  it('is null when the day is cancelled, with or without a reason', () => {
    expect(prefillFor(summary({ cancelled: { reason: 'Rain' } }), TODAY)).toBeNull();
    expect(prefillFor(summary({ cancelled: { reason: null } }), TODAY)).toBeNull();
  });

  it('is null for a summary of another slot when the slot is given, and not otherwise', () => {
    expect(prefillFor(summary({ slotId: 'thu' }), TODAY, 'tue')).toBeNull();
    expect(prefillFor(summary(), TODAY, 'tue')).not.toBeNull();
    expect(prefillFor(summary({ slotId: 'thu' }), TODAY)).not.toBeNull();
  });

  it('is empty lists when nobody answered', () => {
    expect(prefillFor(summary(), TODAY)).toEqual({ inIds: [], lateIds: [], maybeIds: [], friends: [] });
  });

  it('splits answers: In, Maybe, and leaves Out out', () => {
    const s = summary({
      names: { a: 'Ana', b: 'Ben', c: 'Cy', d: 'Di' },
      answers: { a: 'in', b: 'maybe', c: 'out', d: 'in' },
    });
    expect(prefillFor(s, TODAY)).toEqual({ inIds: ['a', 'd'], lateIds: [], maybeIds: ['b'], friends: [] });
  });

  it('orders each list by display name, ignoring case', () => {
    const s = summary({
      names: { a: 'zed', b: 'Ben', c: 'ana', d: 'Cy', e: 'bo', f: 'Al' },
      answers: { a: 'in', b: 'in', c: 'in', d: 'maybe', e: 'maybe', f: 'maybe' },
    });
    const p = prefillFor(s, TODAY)!;
    expect(p.inIds).toEqual(['c', 'b', 'a']);
    expect(p.maybeIds).toEqual(['f', 'e', 'd']);
  });

  it('keeps late players in inIds and in lateIds, in name order', () => {
    const s = summary({
      names: { a: 'Ana', b: 'Ben', c: 'Cy' },
      answers: { a: 'in', b: 'in', c: 'in' },
      lateIds: ['c', 'a'],
    });
    const p = prefillFor(s, TODAY)!;
    expect(p.inIds).toEqual(['a', 'b', 'c']);
    expect(p.lateIds).toEqual(['a', 'c']);
  });

  it('does not count a late id whose answer is not In', () => {
    const s = summary({ names: { a: 'Ana', b: 'Ben' }, answers: { a: 'out', b: 'in' }, lateIds: ['a', 'b'] });
    expect(prefillFor(s, TODAY)!.lateIds).toEqual(['b']);
  });

  it('takes friends only from the play-tonight list, by name, with the guest id', () => {
    const s = summary({
      waiting: [{ id: 'w1', name: 'Pending Pat', broughtBy: null }],
      tonight: [
        { id: 'g2', name: 'zoe', broughtBy: 'a' },
        { id: 'g1', name: 'Amy', broughtBy: null },
      ],
    });
    expect(prefillFor(s, TODAY)!.friends).toEqual([
      { id: 'g1', name: 'Amy' },
      { id: 'g2', name: 'zoe' },
    ]);
  });

  it('skips an answer from an id with no display name', () => {
    const s = summary({ names: { a: 'Ana' }, answers: { a: 'in', gone: 'in', gone2: 'maybe' } });
    expect(prefillFor(s, TODAY)).toMatchObject({ inIds: ['a'], maybeIds: [] });
  });

  it('does not change the summary', () => {
    const s = summary({ names: { a: 'Ana', b: 'Al' }, answers: { a: 'in', b: 'in' }, lateIds: ['a'] });
    const copy = structuredClone(s);
    prefillFor(s, TODAY);
    expect(s).toEqual(copy);
  });
});
