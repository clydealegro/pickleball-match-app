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

  it('clamps the tie-break index when rng returns 1', () => {
    expect(bestSplit(four(), () => 1)).toEqual([
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

  describe('with skill ratings', () => {
    const rated = (ratings: number[]) => ['a', 'b', 'c', 'd'].map((id, i) => mkPlayer(id, { rating: ratings[i] }));

    it('pairs the strongest with the weakest', () => {
      expect(bestSplit(rated([2, 4, 6, 10]), first)).toEqual([
        ['a', 'd'],
        ['b', 'c'],
      ]);
    });

    it('finds that pairing wherever the strongest player sits in the list', () => {
      expect(bestSplit(rated([10, 4, 6, 2]), first)).toEqual([
        ['a', 'd'],
        ['b', 'c'],
      ]);
      expect(bestSplit(rated([4, 10, 2, 6]), first)).toEqual([
        ['a', 'd'],
        ['b', 'c'],
      ]);
    });

    it('treats an unrated player as a 5', () => {
      const players = rated([9, 1, 5, 5]);
      players[2] = mkPlayer('c'); // no rating
      expect(bestSplit(players, first)).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });

    it('behaves as before when nobody is rated', () => {
      expect(bestSplit(four(), first)).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });

    it('still avoids a repeat partnership when the rating gap is small', () => {
      const [a, b, c, d] = rated([5, 5, 5, 6]);
      a.partnerCounts = { b: 1 };
      b.partnerCounts = { a: 1 };
      expect(bestSplit([a, b, c, d], first)).not.toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });
  });
});
