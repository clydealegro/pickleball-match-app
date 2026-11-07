import { describe, expect, it } from 'vitest';
import { explainWaiting } from './explain';
import { mkPlayer, mkSession } from './fixtures';
import { orderedWaiting } from './pool';

const p = (id: string, games: number, seq: number, tieKey = 0.5) => mkPlayer(id, { gamesPlayed: games, lastFinishedSeq: seq, tieKey });

describe('explainWaiting', () => {
  it('is null for anyone who is not waiting', () => {
    const s = mkSession([p('a', 0, 0), p('b', 0, 0), p('c', 0, 0), p('d', 0, 0), mkPlayer('e', { status: 'break' })]);
    expect(explainWaiting(s, 'e')).toBeNull();
    expect(explainWaiting(s, 'nobody')).toBeNull();
  });

  it('says how many more players a game needs, when fewer than four wait', () => {
    const three = mkSession([p('a', 0, 0), p('b', 0, 0), p('c', 0, 0)]);
    expect(explainWaiting(three, 'a')).toEqual({ position: 1, reason: 'Waiting for 1 more player to start a game.' });
    const two = mkSession([p('a', 0, 0), p('b', 0, 0)]);
    expect(explainWaiting(two, 'b')?.reason).toBe('Waiting for 2 more players to start a game.');
  });

  it('puts the player with the fewest games first and says so', () => {
    const s = mkSession([p('a', 2, 1), p('b', 1, 1), p('c', 0, 1), p('d', 2, 1), p('e', 1, 1)]);
    expect(explainWaiting(s, 'c')).toEqual({ position: 1, reason: 'Fewest games so far (0).' });
  });

  it('says who has waited longest when games are level at the front', () => {
    const s = mkSession([p('a', 1, 4), p('b', 1, 2), p('c', 1, 6), p('d', 2, 1)]);
    expect(explainWaiting(s, 'b')).toEqual({ position: 1, reason: 'Waiting the longest among players with 1 game.' });
  });

  it('admits a fixed random pick when games and waiting are both level', () => {
    const s = mkSession([p('a', 1, 3, 0.9), p('b', 1, 3, 0.1), p('c', 1, 3, 0.5), p('d', 1, 3, 0.7)]);
    expect(explainWaiting(s, 'b')).toEqual({ position: 1, reason: 'Tied with others, so the order is a fixed random pick.' });
    expect(explainWaiting(s, 'c')).toEqual({ position: 2, reason: 'Tied with the player ahead, so the order is a fixed random pick.' });
  });

  it('explains a later place by the player directly ahead', () => {
    const s = mkSession([p('a', 0, 1), p('b', 1, 2), p('c', 1, 5), p('d', 2, 1)]);
    expect(explainWaiting(s, 'b')?.position).toBe(2);
    expect(explainWaiting(s, 'b')?.reason).toBe('Played 1 game. Players with fewer games go first.');
    expect(explainWaiting(s, 'c')).toEqual({ position: 3, reason: 'Same games as the player ahead, who has waited longer.' });
    expect(explainWaiting(s, 'd')).toEqual({ position: 4, reason: 'Played 2 games. Players with fewer games go first.' });
  });

  it('describes the queue by arrival order', () => {
    const s = mkSession([p('a', 3, 9), p('b', 0, 0), p('c', 0, 0), p('d', 0, 0), p('e', 0, 0)], {
      mode: 'queue',
      queueOrder: ['c', 'a', 'b', 'd', 'e'],
    });
    expect(explainWaiting(s, 'c')).toEqual({ position: 1, reason: 'Next in the order people arrived.' });
    expect(explainWaiting(s, 'a')).toEqual({ position: 2, reason: 'In the order people arrived.' });
  });

  it('always agrees with the order the engine really uses', () => {
    for (const mode of ['fairness', 'queue'] as const) {
      const players = [p('a', 2, 3, 0.3), p('b', 1, 7, 0.8), p('c', 1, 2, 0.1), p('d', 0, 9, 0.6), p('e', 2, 3, 0.2), p('f', 1, 2, 0.4)];
      const s = mkSession(players, { mode, queueOrder: ['f', 'd', 'a', 'c', 'b', 'e'] });
      orderedWaiting(s).forEach((q, i) => expect(explainWaiting(s, q.id)?.position).toBe(i + 1));
    }
  });
});
