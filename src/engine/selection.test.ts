import { describe, expect, it } from 'vitest';
import { mkPlayer } from './fixtures';
import { bestSplit } from './selection';

const first = () => 0;

function four() {
  return ['a', 'b', 'c', 'd'].map((id) => mkPlayer(id));
}

describe('bestSplit', () => {
  it('takes the first pairing when there is no history', () => {
    expect(bestSplit(four(), first)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('breaks exact ties with the injected rng', () => {
    expect(bestSplit(four(), () => 0.99)).toEqual([
      ['a', 'd'],
      ['b', 'c'],
    ]);
  });

  it('avoids repeating a partnership', () => {
    const [a, b, c, d] = four();
    a.partnerCounts = { b: 1 };
    b.partnerCounts = { a: 1 };
    c.partnerCounts = { d: 1 };
    d.partnerCounts = { c: 1 };
    expect(bestSplit([a, b, c, d], first)).toEqual([
      ['a', 'c'],
      ['b', 'd'],
    ]);
  });

  it('prefers fewer repeat opponents when partner history is equal', () => {
    const [a, b, c, d] = four();
    a.opponentCounts = { c: 5 };
    c.opponentCounts = { a: 5 };
    // Pairing a+c as partners removes their 5 repeated meetings as opponents.
    expect(bestSplit([a, b, c, d], first)).toEqual([
      ['a', 'c'],
      ['b', 'd'],
    ]);
  });

  it('weights a repeat partnership more heavily than repeat opponents', () => {
    const [a, b, c, d] = four();
    a.partnerCounts = { b: 1 };
    b.partnerCounts = { a: 1 };
    a.opponentCounts = { b: 6 };
    b.opponentCounts = { a: 6 };
    // a+b again costs 10; separating them costs 6 (they face each other).
    expect(bestSplit([a, b, c, d], first)).toEqual([
      ['a', 'c'],
      ['b', 'd'],
    ]);
  });

  it('requires exactly four players', () => {
    expect(() => bestSplit([mkPlayer('a')], first)).toThrow();
  });
});
