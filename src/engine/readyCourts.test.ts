import { describe, expect, it } from 'vitest';
import { removeCourt } from './courts';
import { assertInvariants } from './invariants';
import { lineupIds } from './lineup';
import { endSession } from './session';
import { expectEngineError, makeCtx, newTestSession } from './testing';

const NAMES8 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const hold = (names: string[], opts: { courts?: number; mode?: 'fairness' | 'queue' } = {}) =>
  newTestSession(names, { courts: 1, autoStart: false, ...opts });

describe('removing and ending around Ready courts', () => {
  it('removes a Ready court at once and puts its four back to wait', () => {
    let s = hold(NAMES8, { courts: 2 });
    s = removeCourt(s, s.courts[1].id, makeCtx());
    expect(s.courts).toHaveLength(1);
    expect(s.courts[0].status).toBe('ready');
    expect(s.queueOrder).toHaveLength(4);
    assertInvariants(s);
  });

  it('lets the returned four fill another empty court as a Ready lineup', () => {
    let s = hold(['A', 'B', 'C', 'D'], { courts: 3 });
    expect(s.courts.map((c) => c.status)).toEqual(['ready', 'empty', 'empty']);
    s = removeCourt(s, s.courts[0].id, makeCtx());
    expect(s.courts).toHaveLength(2);
    expect(s.courts.map((c) => c.status)).toEqual(['ready', 'empty']);
    assertInvariants(s);
  });

  it('still keeps the last open court', () => {
    const s = hold(['A', 'B', 'C', 'D']);
    expectEngineError(() => removeCourt(s, s.courts[0].id, makeCtx()), 'LAST_COURT');
  });

  it('ends a session that still has a Ready lineup without recording a game for it', () => {
    let s = hold(['A', 'B', 'C', 'D', 'E']);
    s = endSession(s, makeCtx(1, 9_000));
    expect(s.endedAt).toBe(9_000);
    expect(s.history).toHaveLength(0);
    expect(s.players.every((p) => p.gamesPlayed === 0)).toBe(true);
    assertInvariants(s);
  });
});

describe('returning a Ready lineup to the queue', () => {
  it('puts the four ahead of everyone already waiting, in lineup order', () => {
    let s = hold(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'], { courts: 2, mode: 'queue' });
    const waitingBefore = [...s.queueOrder];
    const lineup = lineupIds(s.courts[1]);
    expect(waitingBefore).toHaveLength(2);
    s = removeCourt(s, s.courts[1].id, makeCtx());
    expect(s.queueOrder).toEqual([...lineup, ...waitingBefore]);
    assertInvariants(s);
  });
});
