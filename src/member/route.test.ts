import { describe, expect, it } from 'vitest';
import { joinChanged, parseJoinHash } from './route';

describe('parseJoinHash', () => {
  it('reads the code from a join hash', () => {
    expect(parseJoinHash('#/j/abc123')).toBe('abc123');
  });

  it('accepts letters, digits, dash and underscore', () => {
    expect(parseJoinHash('#/j/Ab-9_zZ')).toBe('Ab-9_zZ');
  });

  it('keeps the case of the code', () => {
    expect(parseJoinHash('#/j/ABCdef')).toBe('ABCdef');
  });

  it('is null for no hash', () => {
    expect(parseJoinHash('')).toBeNull();
    expect(parseJoinHash('#')).toBeNull();
  });

  it('is null for another prefix', () => {
    expect(parseJoinHash('#/x/abc')).toBeNull();
    expect(parseJoinHash('#/join/abc')).toBeNull();
    expect(parseJoinHash('#j/abc')).toBeNull();
    expect(parseJoinHash('/j/abc')).toBeNull();
    expect(parseJoinHash('#/J/abc')).toBeNull();
  });

  it('is null for an empty code', () => {
    expect(parseJoinHash('#/j/')).toBeNull();
    expect(parseJoinHash('#/j')).toBeNull();
  });

  it('is null for an extra path, query or trailing slash', () => {
    expect(parseJoinHash('#/j/abc/def')).toBeNull();
    expect(parseJoinHash('#/j/abc/')).toBeNull();
    expect(parseJoinHash('#/j/abc?x=1')).toBeNull();
    expect(parseJoinHash('#/j/abc#top')).toBeNull();
  });

  it('is null for odd characters in the code', () => {
    expect(parseJoinHash('#/j/ab c')).toBeNull();
    expect(parseJoinHash('#/j/ab.c')).toBeNull();
    expect(parseJoinHash('#/j/ab%20c')).toBeNull();
    expect(parseJoinHash('#/j/<script>')).toBeNull();
    expect(parseJoinHash('#/j/abc\n')).toBeNull();
    expect(parseJoinHash('#/j/café')).toBeNull();
  });

  it('does not match text before the hash', () => {
    expect(parseJoinHash('x#/j/abc')).toBeNull();
    expect(parseJoinHash(' #/j/abc')).toBeNull();
  });
});

describe('joinChanged', () => {
  it('is false when the code is the same', () => {
    expect(joinChanged('abc', '#/j/abc')).toBe(false);
  });

  it('is true when the code changes', () => {
    expect(joinChanged('abc', '#/j/def')).toBe(true);
  });

  it('is true when a join code appears', () => {
    expect(joinChanged(null, '#/j/abc')).toBe(true);
  });

  it('is true when the join code goes away', () => {
    expect(joinChanged('abc', '')).toBe(true);
    expect(joinChanged('abc', '#/settings')).toBe(true);
  });

  it('is false when there was none and there is none', () => {
    expect(joinChanged(null, '')).toBe(false);
    expect(joinChanged(null, '#/other')).toBe(false);
  });

  it('treats a different case as a different code', () => {
    expect(joinChanged('abc', '#/j/ABC')).toBe(true);
  });
});
