import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SLOTS,
  SLOTS_KEY,
  effectiveSlot,
  formatClock,
  formatRange,
  nextSlot,
  parseSlots,
  timestampAt,
  useSlotsStore,
  type Slot,
} from './slots';

const fresh = () =>
  useSlotsStore.setState({
    slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })),
    venues: [],
    tonight: {},
  });

beforeEach(() => {
  localStorage.clear();
  fresh();
});
afterEach(() => vi.restoreAllMocks());

const stored = () => parseSlots(localStorage.getItem(SLOTS_KEY));

describe('DEFAULT_SLOTS', () => {
  it('is Tuesday, Thursday and Saturday with no time and no venue', () => {
    expect(DEFAULT_SLOTS.slots).toEqual([
      { id: 'tue', weekday: 2 },
      { id: 'thu', weekday: 4 },
      { id: 'sat', weekday: 6 },
    ]);
    expect(DEFAULT_SLOTS.venues).toEqual([]);
  });
});

describe('parseSlots', () => {
  it('returns the defaults for null, bad JSON and the wrong shape', () => {
    expect(parseSlots(null)).toEqual(DEFAULT_SLOTS);
    expect(parseSlots('{not json')).toEqual(DEFAULT_SLOTS);
    expect(parseSlots('42')).toEqual(DEFAULT_SLOTS);
    expect(parseSlots('null')).toEqual(DEFAULT_SLOTS);
    expect(parseSlots('{"slots":"x","venues":[]}')).toEqual(DEFAULT_SLOTS);
    expect(parseSlots('{"slots":[]}')).toEqual(DEFAULT_SLOTS);
    expect(parseSlots('{"slots":[],"venues":"x"}')).toEqual(DEFAULT_SLOTS);
  });

  it('keeps valid slots and venues as stored', () => {
    const data = {
      slots: [{ id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Hall' }, { id: 'x', weekday: 0 }],
      venues: ['Hall'],
    };
    expect(parseSlots(JSON.stringify(data))).toEqual(data);
  });

  it('drops invalid slots', () => {
    const raw = JSON.stringify({
      slots: [
        { id: 'ok', weekday: 1 },
        null,
        'x',
        { weekday: 1 },
        { id: '', weekday: 1 },
        { id: 'a', weekday: 7 },
        { id: 'b', weekday: -1 },
        { id: 'c', weekday: 1.5 },
        { id: 'd', weekday: '1' },
        { id: 'e', weekday: 1, startMin: '19:00' },
        { id: 'f', weekday: 1, endMin: null },
        { id: 'g', weekday: 1, venue: 5 },
      ],
      venues: [],
    });
    expect(parseSlots(raw).slots).toEqual([{ id: 'ok', weekday: 1 }]);
  });

  it('keeps courts from 1 to 12 and drops any other value, keeping the slot', () => {
    const slot = (courts: unknown) => ({ id: 'a', weekday: 1, courts });
    const parsed = (courts: unknown) => parseSlots(JSON.stringify({ slots: [slot(courts)], venues: [] })).slots;
    expect(parsed(1)).toEqual([{ id: 'a', weekday: 1, courts: 1 }]);
    expect(parsed(5)).toEqual([{ id: 'a', weekday: 1, courts: 5 }]);
    expect(parsed(12)).toEqual([{ id: 'a', weekday: 1, courts: 12 }]);
    for (const bad of [0, 13, 2.5, -1, '3', null, true]) expect(parsed(bad)).toEqual([{ id: 'a', weekday: 1 }]);
  });

  it('drops non-string venues', () => {
    const raw = JSON.stringify({ slots: [], venues: ['Hall', 3, null, 'Court B'] });
    expect(parseSlots(raw)).toEqual({ slots: [], venues: ['Hall', 'Court B'] });
  });
});

describe('nextSlot', () => {
  // 2026-11-08 is a Sunday. Local dates, so the weekday does not depend on the time zone.
  const sunday = new Date(2026, 10, 8, 10, 0);
  const day = (n: number) => new Date(2026, 10, 8 + n, 10, 0); // 0 Sun .. 6 Sat
  const slot = (id: string, weekday: number, startMin?: number): Slot => ({ id, weekday, startMin });

  it('returns undefined with no slots', () => {
    expect(nextSlot([], sunday)).toBeUndefined();
  });

  it('picks the slot that is today', () => {
    expect(nextSlot(DEFAULT_SLOTS.slots, day(4))?.id).toBe('thu');
  });

  it('picks the earliest of several slots today, with unset times last', () => {
    const slots = [slot('none', 4), slot('late', 4, 1200), slot('early', 4, 600)];
    expect(nextSlot(slots, day(4))?.id).toBe('early');
    expect(nextSlot([slot('none', 4), slot('late', 4, 1200)], day(4))?.id).toBe('late');
    expect(nextSlot([slot('a', 4), slot('b', 4)], day(4))?.id).toBe('a');
  });

  it('picks the next weekday that has a slot', () => {
    expect(nextSlot(DEFAULT_SLOTS.slots, day(0))?.id).toBe('tue');
    expect(nextSlot(DEFAULT_SLOTS.slots, day(1))?.id).toBe('tue');
    expect(nextSlot(DEFAULT_SLOTS.slots, day(3))?.id).toBe('thu');
    expect(nextSlot(DEFAULT_SLOTS.slots, day(5))?.id).toBe('sat');
  });

  it('takes the earliest slot on that next weekday', () => {
    const slots = [slot('b', 2, 1200), slot('a', 2, 600)];
    expect(nextSlot(slots, day(0))?.id).toBe('a');
  });

  it('wraps from Saturday to Sunday and on into the next week', () => {
    const slots = [slot('sun', 0), slot('tue', 2)];
    expect(nextSlot(slots, day(6))?.id).toBe('sun');
    expect(nextSlot([slot('tue', 2)], day(6))?.id).toBe('tue');
  });

  it('does not change the list it was given', () => {
    const slots = [slot('late', 4, 1200), slot('early', 4, 600)];
    nextSlot(slots, day(4));
    expect(slots.map((s) => s.id)).toEqual(['late', 'early']);
  });
});

describe('formatClock', () => {
  it('formats the cases around noon and midnight', () => {
    expect(formatClock(0)).toBe('12:00 am');
    expect(formatClock(30)).toBe('12:30 am');
    expect(formatClock(60)).toBe('1:00 am');
    expect(formatClock(11 * 60 + 59)).toBe('11:59 am');
    expect(formatClock(12 * 60)).toBe('12:00 pm');
    expect(formatClock(12 * 60 + 5)).toBe('12:05 pm');
    expect(formatClock(13 * 60)).toBe('1:00 pm');
    expect(formatClock(19 * 60)).toBe('7:00 pm');
    expect(formatClock(23 * 60 + 59)).toBe('11:59 pm');
  });
});

describe('formatRange', () => {
  it('shares the am or pm when both ends match', () => {
    expect(formatRange(19 * 60, 21 * 60)).toBe('7:00 to 9:00 pm');
    expect(formatRange(9 * 60, 11 * 60 + 30)).toBe('9:00 to 11:30 am');
  });
  it('shows both when they differ', () => {
    expect(formatRange(11 * 60, 13 * 60)).toBe('11:00 am to 1:00 pm');
    expect(formatRange(11 * 60 + 30, 12 * 60)).toBe('11:30 am to 12:00 pm');
  });
  it('handles one end or none', () => {
    expect(formatRange(19 * 60, undefined)).toBe('From 7:00 pm');
    expect(formatRange(undefined, 21 * 60)).toBe('Until 9:00 pm');
    expect(formatRange(undefined, undefined)).toBe('Add a time');
  });
  it('treats 0 minutes as a real time', () => {
    expect(formatRange(0, undefined)).toBe('From 12:00 am');
    expect(formatRange(undefined, 0)).toBe('Until 12:00 am');
  });
});

describe('timestampAt', () => {
  it('is the local time on the day of now', () => {
    const now = new Date(2026, 10, 11, 15, 42, 7, 500).getTime();
    expect(timestampAt(21 * 60, now)).toBe(new Date(2026, 10, 11, 21, 0, 0, 0).getTime());
    expect(timestampAt(0, now)).toBe(new Date(2026, 10, 11, 0, 0, 0, 0).getTime());
    expect(timestampAt(19 * 60 + 30, now)).toBe(new Date(2026, 10, 11, 19, 30, 0, 0).getTime());
  });
});

describe('effectiveSlot', () => {
  const base: Slot = { id: 'tue', weekday: 2, startMin: 1140, venue: 'Hall' };
  it('returns the slot when there is no override', () => {
    expect(effectiveSlot(base, {})).toEqual(base);
  });
  it('merges the override for that slot only', () => {
    expect(effectiveSlot(base, { tue: { endMin: 1260, venue: 'Court B' } })).toEqual({
      ...base,
      endMin: 1260,
      venue: 'Court B',
    });
    expect(effectiveSlot(base, { thu: { venue: 'Court B' } })).toEqual(base);
  });
  it('lets an override clear a value', () => {
    expect(effectiveSlot(base, { tue: { venue: undefined } }).venue).toBeUndefined();
  });
  it('carries courts, and lets an override set or clear them', () => {
    const withCourts = { ...base, courts: 3 };
    expect(effectiveSlot(withCourts, {}).courts).toBe(3);
    expect(effectiveSlot(base, { tue: { courts: 4 } }).courts).toBe(4);
    expect(effectiveSlot(withCourts, { tue: { courts: 4 } }).courts).toBe(4);
    expect(effectiveSlot(withCourts, { tue: { courts: undefined } }).courts).toBeUndefined();
  });
});

describe('useSlotsStore', () => {
  it('saveSlot updates the slot and persists it', () => {
    useSlotsStore.getState().saveSlot('tue', { startMin: 1140, endMin: 1260, venue: 'Hall' });
    expect(useSlotsStore.getState().slots[0]).toEqual({ id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Hall' });
    expect(stored().slots[0]).toEqual({ id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Hall' });
    expect(stored().slots).toHaveLength(3);
  });

  it('saveSlot can clear a value, and ignores an unknown id', () => {
    const s = useSlotsStore.getState();
    s.saveSlot('tue', { startMin: 1140, venue: 'Hall' });
    useSlotsStore.getState().saveSlot('tue', { venue: undefined });
    expect(stored().slots[0]).toEqual({ id: 'tue', weekday: 2, startMin: 1140 });
    const before = localStorage.getItem(SLOTS_KEY);
    useSlotsStore.getState().saveSlot('nope', { startMin: 5 });
    expect(localStorage.getItem(SLOTS_KEY)).toBe(before);
  });

  it('saveSlot stores courts and persists them, and undefined clears them', () => {
    useSlotsStore.getState().saveSlot('tue', { courts: 4, venue: 'Hall' });
    expect(useSlotsStore.getState().slots[0]).toEqual({ id: 'tue', weekday: 2, courts: 4, venue: 'Hall' });
    expect(stored().slots[0]).toEqual({ id: 'tue', weekday: 2, courts: 4, venue: 'Hall' });
    useSlotsStore.getState().saveSlot('tue', { courts: undefined });
    expect(useSlotsStore.getState().slots[0]).toEqual({ id: 'tue', weekday: 2, venue: 'Hall' });
    expect(stored().slots[0]).toEqual({ id: 'tue', weekday: 2, venue: 'Hall' });
    expect(localStorage.getItem(SLOTS_KEY)).not.toContain('courts');
  });

  it('setTonight carries courts in memory only', () => {
    useSlotsStore.getState().setTonight('tue', { courts: 3 });
    expect(useSlotsStore.getState().tonight).toEqual({ tue: { courts: 3 } });
    expect(useSlotsStore.getState().slots[0].courts).toBeUndefined();
    expect(localStorage.getItem(SLOTS_KEY)).toBeNull();
  });

  it('saveSlot keeps the saved venues', () => {
    useSlotsStore.getState().addVenue('Hall');
    useSlotsStore.getState().saveSlot('tue', { venue: 'Hall' });
    expect(stored().venues).toEqual(['Hall']);
  });

  it('setTonight changes memory only, and clearTonight removes it', () => {
    useSlotsStore.getState().setTonight('tue', { startMin: 1200 });
    expect(useSlotsStore.getState().tonight).toEqual({ tue: { startMin: 1200 } });
    expect(localStorage.getItem(SLOTS_KEY)).toBeNull();
    expect(useSlotsStore.getState().slots[0].startMin).toBeUndefined();
    useSlotsStore.getState().setTonight('tue', { venue: 'Hall' });
    expect(useSlotsStore.getState().tonight.tue).toEqual({ startMin: 1200, venue: 'Hall' });
    useSlotsStore.getState().clearTonight('tue');
    expect(useSlotsStore.getState().tonight).toEqual({});
  });

  describe('addVenue', () => {
    const add = (n: string) => useSlotsStore.getState().addVenue(n);

    it('trims, stores, persists and returns the stored name', () => {
      expect(add('  Tacloban Sports Hall ')).toBe('Tacloban Sports Hall');
      expect(useSlotsStore.getState().venues).toEqual(['Tacloban Sports Hall']);
      expect(stored().venues).toEqual(['Tacloban Sports Hall']);
    });

    it('ignores an empty name', () => {
      expect(add('   ')).toBe('');
      expect(useSlotsStore.getState().venues).toEqual([]);
      expect(localStorage.getItem(SLOTS_KEY)).toBeNull();
    });

    it('caps a name at 40 characters', () => {
      const out = add('x'.repeat(60));
      expect(out).toBe('x'.repeat(40));
      expect(useSlotsStore.getState().venues).toEqual(['x'.repeat(40)]);
    });

    it('keeps a 40 character name whole', () => {
      expect(add('y'.repeat(40))).toBe('y'.repeat(40));
    });

    it('dedupes case-insensitively and returns the name already stored', () => {
      add('Tacloban Hall');
      expect(add('  tacloban HALL ')).toBe('Tacloban Hall');
      expect(useSlotsStore.getState().venues).toEqual(['Tacloban Hall']);
    });

    it('stops at 12 venues', () => {
      for (let i = 1; i <= 12; i++) expect(add(`Venue ${i}`)).toBe(`Venue ${i}`);
      expect(add('Venue 13')).toBe('');
      expect(useSlotsStore.getState().venues).toHaveLength(12);
      expect(add('venue 5')).toBe('Venue 5');
    });
  });

  it('keeps working in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => useSlotsStore.getState().saveSlot('tue', { startMin: 600 })).not.toThrow();
    expect(useSlotsStore.getState().slots[0].startMin).toBe(600);
    expect(useSlotsStore.getState().addVenue('Hall')).toBe('Hall');
    expect(useSlotsStore.getState().venues).toEqual(['Hall']);
  });
});
