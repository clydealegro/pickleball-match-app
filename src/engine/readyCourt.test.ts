import { describe, expect, it } from 'vitest';
import { addCourt } from './courts';
import { finishGame } from './game';
import { assertInvariants } from './invariants';
import { lineupIds } from './lineup';
import { orderedWaiting, reservedIds } from './pool';
import { previewNext } from './preview';
import { addPlayer } from './session';
import { startAllReady, startCourt } from './start';
import { setPlayerStatus } from './status';
import { expectEngineError, idOf, makeCtx, newTestSession } from './testing';
import type { Session } from './types';

const NAMES8 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const hold = (names: string[], opts: { courts?: number; mode?: 'fairness' | 'queue' } = {}) =>
  newTestSession(names, { courts: 1, autoStart: false, ...opts });

describe('a session that waits for Start', () => {
  it('opens its courts as Ready, with a lineup, no game and no clock', () => {
    const s = hold(['A', 'B', 'C', 'D', 'E']);
    const court = s.courts[0];
    expect(court.status).toBe('ready');
    expect(court.game).toBeUndefined();
    expect(lineupIds(court)).toHaveLength(4);
    expect(court.lineup!.team1).toHaveLength(2);
    assertInvariants(s);
  });

  it('keeps the proposed four out of the waiting list, and the rest waiting', () => {
    const s = hold(['A', 'B', 'C', 'D', 'E']);
    expect([...reservedIds(s)].sort()).toEqual([...lineupIds(s.courts[0])].sort());
    expect(orderedWaiting(s)).toHaveLength(1);
    expect(s.queueOrder).toHaveLength(1);
  });

  it('never proposes the same player to two courts', () => {
    const s = hold(NAMES8, { courts: 2 });
    expect(s.courts.map((c) => c.status)).toEqual(['ready', 'ready']);
    const all = s.courts.flatMap((c) => lineupIds(c));
    expect(new Set(all).size).toBe(8);
    assertInvariants(s);
  });

  it('starts games by themselves when the session does not say otherwise, as before', () => {
    const s = newTestSession(['A', 'B', 'C', 'D'], { courts: 1 });
    expect(s.courts[0].status).toBe('playing');
    expect(s.autoStart).toBeUndefined();
    const explicit = newTestSession(['A', 'B', 'C', 'D'], { courts: 1, autoStart: true });
    expect(explicit.courts[0].status).toBe('playing');
  });
});

describe('startCourt', () => {
  it('turns Ready into a running game with the same teams, and stamps the clock when Start is pressed', () => {
    const s = hold(['A', 'B', 'C', 'D']);
    const lineup = s.courts[0].lineup!;
    const started = startCourt(s, s.courts[0].id, makeCtx(1, 5_000));
    const court = started.courts[0];
    expect(court.status).toBe('playing');
    expect(court.lineup).toBeUndefined();
    expect(court.game).toEqual({ team1: lineup.team1, team2: lineup.team2, startedAt: 5_000 });
    assertInvariants(started);
  });

  it('refuses a court that is not Ready, and an unknown court', () => {
    const playing = newTestSession(['A', 'B', 'C', 'D'], { courts: 1 });
    expectEngineError(() => startCourt(playing, playing.courts[0].id, makeCtx()), 'NOT_READY');
    const empty = hold(['A', 'B']);
    expectEngineError(() => startCourt(empty, empty.courts[0].id, makeCtx()), 'NOT_READY');
    expectEngineError(() => startCourt(empty, 'nope', makeCtx()), 'NOT_FOUND');
  });

  it('does not change the input session', () => {
    const s = hold(['A', 'B', 'C', 'D']);
    const before = JSON.stringify(s);
    startCourt(s, s.courts[0].id, makeCtx());
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('startAllReady', () => {
  it('starts every Ready court at one moment and leaves playing and empty courts alone', () => {
    let s = hold(NAMES8, { courts: 3 });
    expect(s.courts.map((c) => c.status)).toEqual(['ready', 'ready', 'empty']);
    s = startCourt(s, s.courts[0].id, makeCtx(1, 1_000));
    s = { ...s, courts: s.courts.map((c) => c) };
    const started = startAllReady(s, makeCtx(1, 9_000));
    expect(started.courts.map((c) => c.status)).toEqual(['playing', 'playing', 'empty']);
    expect(started.courts[0].game!.startedAt).toBe(1_000);
    expect(started.courts[1].game!.startedAt).toBe(9_000);
    assertInvariants(started);
  });

  it('says so when nothing is Ready', () => {
    const s = newTestSession(NAMES8, { courts: 2 });
    expectEngineError(() => startAllReady(s, makeCtx()), 'NOT_READY');
  });
});

describe('nothing starts by itself when the session waits for Start', () => {
  const started = (s: Session) => startAllReady(s, makeCtx(1, 2_000));

  it('finishing a game makes the court Ready with the next four', () => {
    let s = started(hold(NAMES8));
    s = finishGame(s, s.courts[0].id, makeCtx(1, 60_000));
    expect(s.courts[0].status).toBe('ready');
    expect(s.courts[0].game).toBeUndefined();
    expect(lineupIds(s.courts[0])).toHaveLength(4);
    expect(s.history).toHaveLength(1);
    assertInvariants(s);
  });

  it('finishing a game with too few waiting leaves the court empty', () => {
    let s = started(hold(['A', 'B', 'C', 'D']));
    s = setPlayerStatus(s, idOf(s, 'A'), 'break', makeCtx());
    s = finishGame(s, s.courts[0].id, makeCtx(1, 60_000));
    expect(s.courts[0].status).toBe('empty');
    assertInvariants(s);
  });

  it('a late arrival who completes a lineup makes a Ready court, not a game', () => {
    let s = hold(['A', 'B', 'C']);
    expect(s.courts[0].status).toBe('empty');
    s = addPlayer(s, { name: 'D' }, makeCtx());
    expect(s.courts[0].status).toBe('ready');
    assertInvariants(s);
  });

  it('adding a court with four waiting makes it Ready', () => {
    let s = started(hold(NAMES8));
    s = addCourt(s, makeCtx());
    expect(s.courts[1].status).toBe('ready');
    assertInvariants(s);
  });
});

describe('the preview of the next game', () => {
  it('ignores Ready courts, so the reserved four are never offered twice', () => {
    let s = hold(NAMES8, { courts: 2 });
    expect(previewNext(s)).toBeNull();
    s = startCourt(s, s.courts[0].id, makeCtx(1, 100));
    s = addPlayer(s, { name: 'I' }, makeCtx());
    s = addPlayer(s, { name: 'J' }, makeCtx());
    s = addPlayer(s, { name: 'K' }, makeCtx());
    s = addPlayer(s, { name: 'L' }, makeCtx());
    const next = previewNext(s)!;
    expect(next.courtNumber).toBe(1);
    expect(next.playerIds).toHaveLength(4);
    for (const id of next.playerIds) expect(reservedIds(s).has(id)).toBe(false);
  });
});

describe('the invariants know about Ready courts', () => {
  const broken = (change: (s: Session) => void) => {
    const s = hold(['A', 'B', 'C', 'D', 'E']);
    change(s);
    return () => assertInvariants(s);
  };

  it('reject a Ready court that also has a game', () => {
    expect(broken((s) => (s.courts[0].game = { team1: ['x', 'y'], team2: ['z', 'w'], startedAt: 1 }))).toThrow();
  });

  it('reject a Ready court marked closing', () => {
    expect(broken((s) => (s.courts[0].closing = true))).toThrow();
  });

  it('reject a player who is both in a lineup and waiting', () => {
    expect(broken((s) => s.queueOrder.push(lineupIds(s.courts[0])[0]))).toThrow();
  });

  it('reject a lineup that holds someone on a break', () => {
    expect(broken((s) => (s.players.find((p) => p.id === lineupIds(s.courts[0])[0])!.status = 'break'))).toThrow();
  });

  it('accept a healthy Ready session', () => {
    expect(broken(() => {})).not.toThrow();
  });
});
