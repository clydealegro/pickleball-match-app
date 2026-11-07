import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COURTS_KEY, getBoolPref, getNumPref, setBoolPref, setNumPref } from './prefs';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('boolean preferences', () => {
  it('use the fallback until set, then the stored value', () => {
    expect(getBoolPref('pickleball.testBool', true)).toBe(true);
    setBoolPref('pickleball.testBool', false);
    expect(getBoolPref('pickleball.testBool', true)).toBe(false);
    expect(localStorage.getItem('pickleball.testBool')).toBe('false');
  });

  it('keep working in memory when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getBoolPref('pickleball.blockedBool', true)).toBe(true);
    setBoolPref('pickleball.blockedBool', false);
    expect(getBoolPref('pickleball.blockedBool', true)).toBe(false);
  });
});

describe('number preferences', () => {
  it('fall back when missing or not a whole number, and clamp to the range', () => {
    expect(getNumPref(COURTS_KEY, 2, 1, 12)).toBe(2);
    localStorage.setItem(COURTS_KEY, 'abc');
    expect(getNumPref(COURTS_KEY, 2, 1, 12)).toBe(2);
    localStorage.setItem(COURTS_KEY, '2.5');
    expect(getNumPref(COURTS_KEY, 2, 1, 12)).toBe(2);
    setNumPref(COURTS_KEY, 4);
    expect(getNumPref(COURTS_KEY, 2, 1, 12)).toBe(4);
    setNumPref(COURTS_KEY, 99);
    expect(getNumPref(COURTS_KEY, 2, 1, 12)).toBe(12);
    setNumPref(COURTS_KEY, 0);
    expect(getNumPref(COURTS_KEY, 2, 1, 12)).toBe(1);
  });
});
