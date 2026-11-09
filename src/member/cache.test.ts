import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceViewData } from '../sync/attendance/types';
import { CACHE_KEY, parseCache, readCached, writeCached } from './cache';

const view = (title = 'Tuesday open play'): AttendanceViewData => ({
  title,
  weekday: 2,
  venue: 'Sample Hall',
  start_min: 1140,
  end_min: 1260,
  courts: 3,
  play_date: '2026-11-10',
  cancelled: null,
  players: [{ id: 'p1', first_name: 'Ana', last_initial: 'R', has_photo: false, photo_seq: 0 }],
  answers: [{ player_id: 'p1', status: 'in', late: true }],
  friends: 2,
});
const stored = () => JSON.parse(localStorage.getItem(CACHE_KEY)!) as { version: number; entries: Record<string, { view: unknown; at: number }> };

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the storage key', () => {
  it('is pikl.member.cache.v1', () => {
    expect(CACHE_KEY).toBe('pikl.member.cache.v1');
  });
});

describe('writeCached and readCached', () => {
  it('reads nothing for a code never kept', () => {
    expect(readCached('abc')).toBeNull();
  });

  it('keeps the view and when it was fetched', () => {
    writeCached('abc', view(), 1000);
    expect(readCached('abc')).toEqual({ view: view(), at: 1000 });
  });

  it('keeps each code apart', () => {
    writeCached('abc', view('One'), 1);
    writeCached('def', view('Two'), 2);
    expect(readCached('abc')?.view.title).toBe('One');
    expect(readCached('def')?.view.title).toBe('Two');
  });

  it('replaces the copy for a code', () => {
    writeCached('abc', view('Old'), 1);
    writeCached('abc', view('New'), 2);
    expect(readCached('abc')).toEqual({ view: view('New'), at: 2 });
    expect(Object.keys(stored().entries)).toEqual(['abc']);
  });

  it('writes the documented shape', () => {
    writeCached('abc', view(), 1000);
    expect(stored()).toEqual({ version: 1, entries: { abc: { view: view(), at: 1000 } } });
  });

  it('keeps at most 5 codes and drops the oldest', () => {
    for (let i = 0; i < 6; i += 1) writeCached(`code${i}`, view(), i);
    expect(Object.keys(stored().entries)).toHaveLength(5);
    expect(readCached('code0')).toBeNull();
    expect(readCached('code1')).not.toBeNull();
    expect(readCached('code5')).not.toBeNull();
  });

  it('counts a rewrite as new, so it is the last to go', () => {
    for (let i = 0; i < 5; i += 1) writeCached(`code${i}`, view(), i);
    writeCached('code0', view(), 10);
    writeCached('code5', view(), 11);
    expect(readCached('code0')).not.toBeNull();
    expect(readCached('code1')).toBeNull();
  });

  it('does not throw when storage is blocked or full', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(readCached('abc')).toBeNull();
    expect(() => writeCached('abc', view(), 1)).not.toThrow();
  });
});

describe('parseCache', () => {
  const good = JSON.stringify({ version: 1, entries: { abc: { view: view(), at: 5 } } });

  it('reads a good value', () => {
    expect(parseCache(good)).toEqual({ version: 1, entries: { abc: { view: view(), at: 5 } } });
  });

  it('is empty for nothing, bad JSON, the wrong shape and another version', () => {
    for (const raw of [null, '', '{nope', 'null', '[]', '{}', '{"version":1}', '{"version":1,"entries":[]}', '{"version":1,"entries":null}', '{"version":2,"entries":{}}']) {
      expect(parseCache(raw)).toEqual({ version: 1, entries: {} });
    }
  });

  it('drops an entry whose time is not a number', () => {
    for (const at of ['5', null, 'x', {}]) {
      expect(parseCache(JSON.stringify({ version: 1, entries: { abc: { view: view(), at } } })).entries).toEqual({});
    }
  });

  it('drops an entry with no view', () => {
    expect(parseCache('{"version":1,"entries":{"abc":{"at":5},"def":null,"ghi":7}}').entries).toEqual({});
  });

  it('drops a code that is not a link code', () => {
    expect(parseCache(JSON.stringify({ version: 1, entries: { 'a b': { view: view(), at: 5 }, ok: { view: view(), at: 5 } } })).entries).toHaveProperty('ok');
    expect(Object.keys(parseCache(JSON.stringify({ version: 1, entries: { 'a b': { view: view(), at: 5 } } })).entries)).toEqual([]);
  });

  it.each([
    ['title', { title: 7 }],
    ['weekday', { weekday: 'x' }],
    ['venue', { venue: 5 }],
    ['start_min', { start_min: 'x' }],
    ['end_min', { end_min: 'x' }],
    ['courts', { courts: 'x' }],
    ['play_date', { play_date: 'soon' }],
    ['play_date missing', { play_date: undefined }],
    ['cancelled', { cancelled: 'yes' }],
    ['cancelled reason', { cancelled: { reason: 5 } }],
    ['players', { players: 'x' }],
    ['a player', { players: [{ id: 'p1' }] }],
    ['answers', { answers: {} }],
    ['an answer', { answers: [{ player_id: 'p1', status: 'bogus', late: false }] }],
    ['friends', { friends: 'two' }],
  ])('drops an entry with a bad %s', (_name, patch) => {
    const entry = { view: { ...view(), ...patch }, at: 5 };
    expect(parseCache(JSON.stringify({ version: 1, entries: { abc: entry } })).entries).toEqual({});
  });

  it('accepts null for the optional fields and a cancelled week', () => {
    const v = { ...view(), venue: null, start_min: null, end_min: null, courts: null, cancelled: { reason: null } };
    expect(parseCache(JSON.stringify({ version: 1, entries: { abc: { view: v, at: 5 } } })).entries.abc.view).toEqual(v);
    const w = { ...view(), cancelled: { reason: 'Rain' } };
    expect(parseCache(JSON.stringify({ version: 1, entries: { abc: { view: w, at: 5 } } })).entries.abc.view.cancelled).toEqual({ reason: 'Rain' });
  });

  it('keeps the good entries next to a bad one', () => {
    const raw = JSON.stringify({ version: 1, entries: { bad: { view: 7, at: 1 }, abc: { view: view(), at: 5 } } });
    expect(Object.keys(parseCache(raw).entries)).toEqual(['abc']);
  });

  it('keeps the newest 5 when more are stored', () => {
    const entries = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`code${i}`, { view: view(), at: i }]));
    const kept = Object.keys(parseCache(JSON.stringify({ version: 1, entries })).entries);
    expect(kept).toEqual(['code3', 'code4', 'code5', 'code6', 'code7']);
  });

  it('keeps only the known fields of a view', () => {
    const v = { ...view(), ownerId: 'secret', extra: 1 };
    const out = parseCache(JSON.stringify({ version: 1, entries: { abc: { view: v, at: 5 } } })).entries.abc.view;
    expect(out).toEqual(view());
    expect(out).not.toHaveProperty('ownerId');
  });
});
