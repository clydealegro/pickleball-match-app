import { describe, expect, it } from 'vitest';
import { finishGame } from './game';
import { assertInvariants } from './invariants';
import { startAllReady } from './start';
import { expectEngineError, makeCtx, newTestSession } from './testing';
import type { GameResult } from './types';

const NAMES = ['A', 'B', 'C', 'D', 'E'];
const play = () => newTestSession(NAMES, { courts: 1 });
const finish = (result?: GameResult) => {
  const s = play();
  return finishGame(s, s.courts[0].id, makeCtx(1, 60_000), result);
};

describe('finishGame with a result', () => {
  it('records the winner and the score, team 1 first', () => {
    const s = finish({ winner: 1, score: [11, 7] });
    expect(s.history[0].winner).toBe(1);
    expect(s.history[0].score).toEqual([11, 7]);
    assertInvariants(s);
  });

  it('keeps the score in team order when team 2 wins', () => {
    const s = finish({ winner: 2, score: [4, 11] });
    expect(s.history[0].winner).toBe(2);
    expect(s.history[0].score).toEqual([4, 11]);
  });

  it('records a winner without a score', () => {
    const h = finish({ winner: 2 }).history[0];
    expect(h.winner).toBe(2);
    expect(h).not.toHaveProperty('score');
  });

  it('records nothing for a game finished without a result, as before', () => {
    const h = finish().history[0];
    expect(h).not.toHaveProperty('winner');
    expect(h).not.toHaveProperty('score');
    expect(Object.keys(h).sort()).toEqual(['courtNumber', 'finishedAt', 'startedAt', 'team1', 'team2']);
  });

  it('accepts a win above the target, such as 12 to 10, and a 0 score', () => {
    expect(finish({ winner: 1, score: [12, 10] }).history[0].score).toEqual([12, 10]);
    expect(finish({ winner: 1, score: [11, 0] }).history[0].score).toEqual([11, 0]);
  });

  it('does not change who played whom or how many games anyone has', () => {
    const plain = finish();
    const withResult = finish({ winner: 1, score: [11, 5] });
    expect(withResult.players).toEqual(plain.players);
    expect(withResult.courts).toEqual(plain.courts);
    expect(withResult.queueOrder).toEqual(plain.queueOrder);
    expect(withResult.gameSeq).toBe(plain.gameSeq);
  });

  it('copies the score, so changing the input afterwards does not change the history', () => {
    const score: [number, number] = [11, 6];
    const s = finish({ winner: 1, score });
    score[0] = 99;
    expect(s.history[0].score).toEqual([11, 6]);
  });

  it('works for a game started from a Ready court', () => {
    let s = newTestSession(NAMES, { courts: 1, autoStart: false });
    s = startAllReady(s, makeCtx(1, 1_000));
    s = finishGame(s, s.courts[0].id, makeCtx(1, 90_000), { winner: 2, score: [3, 11] });
    expect(s.history[0]).toMatchObject({ winner: 2, score: [3, 11], startedAt: 1_000, finishedAt: 90_000 });
    expect(s.courts[0].status).toBe('ready');
    assertInvariants(s);
  });
});

describe('a result that does not make sense', () => {
  const bad = (result: unknown) => {
    const s = play();
    return () => finishGame(s, s.courts[0].id, makeCtx(), result as GameResult);
  };

  it('is refused when the winning score is not higher', () => {
    expectEngineError(bad({ winner: 1, score: [7, 11] }), 'INVALID_RESULT');
    expectEngineError(bad({ winner: 2, score: [11, 7] }), 'INVALID_RESULT');
    expectEngineError(bad({ winner: 1, score: [9, 9] }), 'INVALID_RESULT');
  });

  it('is refused for a negative or fractional score', () => {
    expectEngineError(bad({ winner: 1, score: [11, -1] }), 'INVALID_RESULT');
    expectEngineError(bad({ winner: 1, score: [11.5, 3] }), 'INVALID_RESULT');
    expectEngineError(bad({ winner: 1, score: [Number.NaN, 3] }), 'INVALID_RESULT');
  });

  it('is refused for a winner that is not team 1 or team 2', () => {
    expectEngineError(bad({ winner: 3 }), 'INVALID_RESULT');
    expectEngineError(bad({ winner: 0, score: [11, 5] }), 'INVALID_RESULT');
  });

  it('changes nothing when it is refused', () => {
    const s = play();
    const before = JSON.stringify(s);
    expect(() => finishGame(s, s.courts[0].id, makeCtx(), { winner: 1, score: [3, 3] })).toThrow();
    expect(JSON.stringify(s)).toBe(before);
  });
});
