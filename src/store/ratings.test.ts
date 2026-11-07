import { beforeEach, describe, expect, it } from 'vitest';
import { liveCtx } from './liveCtx';
import { getRating, getRatings, RATINGS_KEY, setRating } from './ratings';

beforeEach(() => {
  localStorage.clear();
});

describe('private ratings', () => {
  it('starts empty', () => {
    expect(getRatings()).toEqual({});
    expect(getRating('p1')).toBeUndefined();
  });

  it('saves and reads a rating', () => {
    setRating('p1', 7);
    expect(getRating('p1')).toBe(7);
    expect(JSON.parse(localStorage.getItem(RATINGS_KEY)!)).toEqual({ p1: 7 });
  });

  it('removes a rating when set to undefined', () => {
    setRating('p1', 7);
    setRating('p1', undefined);
    expect(getRating('p1')).toBeUndefined();
  });

  it('ignores values outside 1 to 10 and non-whole numbers', () => {
    setRating('p1', 11);
    setRating('p1', 0);
    setRating('p1', 5.5);
    expect(getRating('p1')).toBeUndefined();
  });

  it('drops malformed stored data', () => {
    localStorage.setItem(RATINGS_KEY, JSON.stringify({ a: 4, b: 99, c: 'x' }));
    expect(getRatings()).toEqual({ a: 4 });
    localStorage.setItem(RATINGS_KEY, 'not json');
    expect(getRatings()).toEqual({});
  });

  it('hands the live engine context a way to look a rating up', () => {
    setRating('p1', 9);
    expect(liveCtx().ratingOf?.('p1')).toBe(9);
    expect(liveCtx().ratingOf?.('p2')).toBeUndefined();
  });
});
