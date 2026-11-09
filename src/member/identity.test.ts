import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_KEY, forgetPick, parseIdentity, readPick, savePick } from './identity';

const stored = () => JSON.parse(localStorage.getItem(IDENTITY_KEY)!) as { version: number; picks: Record<string, string> };

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the storage key', () => {
  it('is pikl.member.v1', () => {
    expect(IDENTITY_KEY).toBe('pikl.member.v1');
  });
});

describe('parseIdentity', () => {
  it('is empty for nothing', () => {
    expect(parseIdentity(null)).toEqual({ version: 1, picks: {} });
    expect(parseIdentity('')).toEqual({ version: 1, picks: {} });
  });

  it('reads a good value', () => {
    expect(parseIdentity('{"version":1,"picks":{"abc":"p1","def":"p2"}}')).toEqual({ version: 1, picks: { abc: 'p1', def: 'p2' } });
  });

  it('is empty for text that is not JSON', () => {
    expect(parseIdentity('{nope')).toEqual({ version: 1, picks: {} });
  });

  it('is empty for JSON of the wrong shape', () => {
    for (const raw of ['null', '[]', '7', '"x"', '{}', '{"version":1}', '{"version":1,"picks":[]}', '{"version":1,"picks":null}', '{"version":1,"picks":"x"}']) {
      expect(parseIdentity(raw)).toEqual({ version: 1, picks: {} });
    }
  });

  it('is empty for another version', () => {
    expect(parseIdentity('{"version":2,"picks":{"abc":"p1"}}')).toEqual({ version: 1, picks: {} });
    expect(parseIdentity('{"version":"1","picks":{"abc":"p1"}}')).toEqual({ version: 1, picks: {} });
  });

  it('drops a pick that is not a non-empty string, and keeps the others', () => {
    const raw = '{"version":1,"picks":{"a":"p1","b":7,"c":"","d":null,"e":{"x":1},"f":["p"],"g":"p7"}}';
    expect(parseIdentity(raw).picks).toEqual({ a: 'p1', g: 'p7' });
  });

  it('drops a code that is not a link code', () => {
    const raw = '{"version":1,"picks":{"ok_-1":"p1","has space":"p2","dot.dot":"p3","":"p4"}}';
    expect(parseIdentity(raw).picks).toEqual({ 'ok_-1': 'p1' });
  });

  it('drops a player id that is far too long', () => {
    expect(parseIdentity(JSON.stringify({ version: 1, picks: { a: 'x'.repeat(65), b: 'x'.repeat(64) } })).picks).toEqual({ b: 'x'.repeat(64) });
  });

  it('keeps the newest 20 codes when more are stored', () => {
    const picks = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`code${i}`, `p${i}`]));
    const kept = Object.keys(parseIdentity(JSON.stringify({ version: 1, picks })).picks);
    expect(kept).toHaveLength(20);
    expect(kept[0]).toBe('code5');
    expect(kept[19]).toBe('code24');
  });
});

describe('readPick and savePick', () => {
  it('reads nothing for a code never picked', () => {
    expect(readPick('abc')).toBeNull();
  });

  it('remembers a pick for its code only', () => {
    savePick('abc', 'p1');
    expect(readPick('abc')).toBe('p1');
    expect(readPick('other')).toBeNull();
  });

  it('writes the documented shape', () => {
    savePick('abc', 'p1');
    expect(stored()).toEqual({ version: 1, picks: { abc: 'p1' } });
  });

  it('replaces the pick for a code', () => {
    savePick('abc', 'p1');
    savePick('abc', 'p2');
    expect(readPick('abc')).toBe('p2');
    expect(Object.keys(stored().picks)).toEqual(['abc']);
  });

  it('keeps picks for other codes', () => {
    savePick('abc', 'p1');
    savePick('def', 'p2');
    expect(readPick('abc')).toBe('p1');
    expect(readPick('def')).toBe('p2');
  });

  it('keeps at most 20 codes and drops the oldest', () => {
    for (let i = 0; i < 21; i += 1) savePick(`code${i}`, `p${i}`);
    const keys = Object.keys(stored().picks);
    expect(keys).toHaveLength(20);
    expect(readPick('code0')).toBeNull();
    expect(readPick('code1')).toBe('p1');
    expect(readPick('code20')).toBe('p20');
  });

  it('counts a repeated pick as new, so it is the last to go', () => {
    for (let i = 0; i < 20; i += 1) savePick(`code${i}`, `p${i}`);
    savePick('code0', 'again');
    savePick('code20', 'p20');
    expect(readPick('code0')).toBe('again');
    expect(readPick('code1')).toBeNull();
  });

  it('ignores a bad stored value and starts over', () => {
    localStorage.setItem(IDENTITY_KEY, 'garbage');
    expect(readPick('abc')).toBeNull();
    savePick('abc', 'p1');
    expect(readPick('abc')).toBe('p1');
  });

  it('does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readPick('abc')).toBeNull();
    expect(() => savePick('abc', 'p1')).not.toThrow();
    expect(() => forgetPick('abc')).not.toThrow();
  });
});

describe('forgetPick', () => {
  it('forgets one code and keeps the others', () => {
    savePick('abc', 'p1');
    savePick('def', 'p2');
    forgetPick('abc');
    expect(readPick('abc')).toBeNull();
    expect(readPick('def')).toBe('p2');
  });

  it('does nothing for a code with no pick', () => {
    savePick('def', 'p2');
    forgetPick('abc');
    expect(readPick('def')).toBe('p2');
  });

  it('does not write when there is nothing to forget', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    forgetPick('abc');
    expect(set).not.toHaveBeenCalled();
  });
});
