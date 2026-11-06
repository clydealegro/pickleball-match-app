import { describe, expect, it } from 'vitest';
import { mkPlayer, mkSession } from './fixtures';
import { availablePlayers, lateArrivalGames, onCourtIds, orderedWaiting } from './pool';
import type { Court } from './types';

const playingCourt: Court = {
  id: 'c1',
  number: 1,
  status: 'playing',
  closing: false,
  game: { team1: ['a', 'b'], team2: ['c', 'd'], startedAt: 0 },
};

describe('availablePlayers', () => {
  it('excludes players on court, on break, and who left', () => {
    const s = mkSession(
      [
        mkPlayer('a'),
        mkPlayer('b'),
        mkPlayer('c'),
        mkPlayer('d'),
        mkPlayer('e'),
        mkPlayer('f', { status: 'break' }),
        mkPlayer('g', { status: 'left' }),
      ],
      { courts: [playingCourt] },
    );
    expect(onCourtIds(s)).toEqual(new Set(['a', 'b', 'c', 'd']));
    expect(availablePlayers(s).map((p) => p.id)).toEqual(['e']);
  });
});

describe('orderedWaiting', () => {
  it('fairness: fewest games first, then waited longest, then tieKey', () => {
    const s = mkSession([
      mkPlayer('p1', { gamesPlayed: 2 }),
      mkPlayer('p2', { gamesPlayed: 0, lastFinishedSeq: 5 }),
      mkPlayer('p3', { gamesPlayed: 0, lastFinishedSeq: 1, tieKey: 0.1 }),
      mkPlayer('p4', { gamesPlayed: 0, lastFinishedSeq: 1, tieKey: 0.9 }),
    ]);
    expect(orderedWaiting(s).map((p) => p.id)).toEqual(['p3', 'p4', 'p2', 'p1']);
  });

  it('queue: follows queueOrder and ignores unavailable players', () => {
    const s = mkSession([mkPlayer('a'), mkPlayer('b'), mkPlayer('c', { status: 'break' })], {
      mode: 'queue',
      queueOrder: ['b', 'c', 'a'],
    });
    expect(orderedWaiting(s).map((p) => p.id)).toEqual(['b', 'a']);
  });
});

describe('lateArrivalGames', () => {
  it('is the floor of the average games of active players', () => {
    const s = mkSession([
      mkPlayer('a', { gamesPlayed: 3 }),
      mkPlayer('b', { gamesPlayed: 2 }),
      mkPlayer('c', { status: 'break', gamesPlayed: 9 }),
    ]);
    expect(lateArrivalGames(s)).toBe(2);
  });

  it('is 0 with nobody active and can exclude one player', () => {
    expect(lateArrivalGames(mkSession([]))).toBe(0);
    const s = mkSession([mkPlayer('a', { gamesPlayed: 4 }), mkPlayer('b', { gamesPlayed: 0 })]);
    expect(lateArrivalGames(s, 'b')).toBe(4);
  });
});
