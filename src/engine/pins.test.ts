import { describe, expect, it } from 'vitest';
import { finishGame } from './game';
import { mkPlayer, mkSession } from './fixtures';
import { assertInvariants } from './invariants';
import { explainWaiting } from './explain';
import { playNext, skipTurn } from './pins';
import { orderedWaiting } from './pool';
import { startAllReady } from './start';
import { setPlayerStatus } from './status';
import { expectEngineError, idOf, makeCtx, newTestSession } from './testing';
import type { Mode } from './types';

const NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
/** Four on court 1, five waiting (E to I). */
const nine = (mode: Mode = 'fairness', autoStart?: boolean) => newTestSession(NAMES, { courts: 1, mode, autoStart });
const waitingNames = (s: ReturnType<typeof nine>) => orderedWaiting(s).map((p) => p.name);

describe.each<Mode>(['fairness', 'queue'])('playNext (%s mode)', (mode) => {
  it('puts a waiting player at the front of the line', () => {
    const s = nine(mode);
    const last = waitingNames(s).at(-1)!;
    const next = playNext(s, idOf(s, last));
    expect(waitingNames(next)[0]).toBe(last);
    expect(next.pinned).toEqual([idOf(s, last)]);
    assertInvariants(next);
  });

  it('keeps several players in the order they were asked', () => {
    let s = nine(mode);
    const [a, b, c, d, e] = waitingNames(s);
    s = playNext(s, idOf(s, e));
    s = playNext(s, idOf(s, c));
    expect(waitingNames(s).slice(0, 2)).toEqual([e, c]);
    expect(waitingNames(s).slice(2)).toEqual([a, b, d]);
    assertInvariants(s);
  });

  it('does nothing when asked twice', () => {
    let s = nine(mode);
    const id = idOf(s, waitingNames(s)[3]);
    s = playNext(s, id);
    expect(playNext(s, id)).toEqual(s);
  });

  it('changes nobody’s games or counts, and not the input', () => {
    const s = nine(mode);
    const before = JSON.stringify(s);
    const next = playNext(s, idOf(s, waitingNames(s)[4]));
    expect(next.players).toEqual(s.players);
    expect(next.courts).toEqual(s.courts);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('is for waiting players only', () => {
    const s = nine(mode);
    const playing = s.courts[0].game!.team1[0];
    expectEngineError(() => playNext(s, playing), 'NOT_WAITING'); // in a game
    const waiting = idOf(s, waitingNames(s)[0]);
    const onBreak = setPlayerStatus(s, waiting, 'break', makeCtx());
    expectEngineError(() => playNext(onBreak, waiting), 'NOT_WAITING');
    const left = setPlayerStatus(s, waiting, 'left', makeCtx());
    expectEngineError(() => playNext(left, waiting), 'NOT_WAITING');
    expectEngineError(() => playNext(s, 'nobody'), 'NOT_FOUND');
  });

  it('puts them on the next court, and the list is gone once they are placed', () => {
    let s = nine(mode);
    const chosen = waitingNames(s).at(-1)!;
    s = playNext(s, idOf(s, chosen));
    s = finishGame(s, s.courts[0].id, makeCtx(1, 60_000));
    const game = s.courts[0].game!;
    const names = [...game.team1, ...game.team2].map((id) => s.players.find((p) => p.id === id)!.name);
    expect(names).toContain(chosen);
    expect(s.pinned).toBeUndefined();
    assertInvariants(s);
  });

  it('puts them in a Ready lineup the same way', () => {
    let s = startAllReady(nine(mode, false), makeCtx(1, 1_000));
    const chosen = waitingNames(s).at(-1)!;
    s = playNext(s, idOf(s, chosen));
    s = finishGame(s, s.courts[0].id, makeCtx(1, 60_000));
    expect(s.courts[0].status).toBe('ready');
    const lineup = [...s.courts[0].lineup!.team1, ...s.courts[0].lineup!.team2];
    expect(lineup).toContain(idOf(s, chosen));
    expect(s.pinned).toBeUndefined();
    assertInvariants(s);
  });

  it('with more than four asked, the first four play and the rest stay asked', () => {
    let s = nine(mode);
    const ids = waitingNames(s).map((n) => idOf(s, n));
    for (const id of ids) s = playNext(s, id);
    s = finishGame(s, s.courts[0].id, makeCtx(1, 60_000));
    const playing = [...s.courts[0].game!.team1, ...s.courts[0].game!.team2];
    expect(playing.sort()).toEqual(ids.slice(0, 4).sort());
    expect(s.pinned).toEqual([ids[4]]);
    assertInvariants(s);
  });

  it('is dropped when the player goes on a break or leaves', () => {
    let s = nine(mode);
    const id = idOf(s, waitingNames(s)[2]);
    s = playNext(s, id);
    const onBreak = setPlayerStatus(s, id, 'break', makeCtx());
    expect(onBreak.pinned).toBeUndefined();
    assertInvariants(onBreak);
    const left = setPlayerStatus(s, id, 'left', makeCtx());
    expect(left.pinned).toBeUndefined();
    assertInvariants(left);
  });

  it('does not change a lineup that is already Ready', () => {
    let s = nine(mode, false);
    const lineup = JSON.stringify(s.courts[0].lineup);
    s = playNext(s, idOf(s, waitingNames(s).at(-1)!));
    expect(JSON.stringify(s.courts[0].lineup)).toBe(lineup);
    assertInvariants(s);
  });
});

describe('skipTurn', () => {
  it('moves a waiting player to the back among players with the same number of games, in fairness mode', () => {
    const players = ['a', 'b', 'c', 'd', 'e'].map((id, i) => mkPlayer(id, { gamesPlayed: 1, lastFinishedSeq: 3, tieKey: (i + 1) / 10 }));
    let s = mkSession(players, { gameSeq: 3 });
    expect(orderedWaiting(s).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    s = skipTurn(s, 'a');
    expect(orderedWaiting(s).map((p) => p.id)).toEqual(['b', 'c', 'd', 'e', 'a']);
    assertInvariants(s);
  });

  it('goes behind someone who finished a game just now, even with the same games', () => {
    const s = mkSession(
      [mkPlayer('a', { gamesPlayed: 1, lastFinishedSeq: 1 }), mkPlayer('b', { gamesPlayed: 1, lastFinishedSeq: 9 }), mkPlayer('c', { gamesPlayed: 1, lastFinishedSeq: 5 }), mkPlayer('d', { gamesPlayed: 1, lastFinishedSeq: 7 })],
      { gameSeq: 9 },
    );
    expect(orderedWaiting(skipTurn(s, 'a')).map((p) => p.id).at(-1)).toBe('a');
  });

  it('cannot put anyone behind players with more games, so fairness still owes them a game', () => {
    const s = mkSession(
      [mkPlayer('a', { gamesPlayed: 0 }), mkPlayer('b', { gamesPlayed: 1 }), mkPlayer('c', { gamesPlayed: 2 }), mkPlayer('d', { gamesPlayed: 2 })],
      { gameSeq: 4 },
    );
    const skipped = skipTurn(s, 'a');
    expect(orderedWaiting(skipped).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(skipped.players.find((p) => p.id === 'a')!.gamesPlayed).toBe(0);
  });

  it('moves a player to the back of the queue, in queue mode', () => {
    const s = mkSession(['a', 'b', 'c', 'd', 'e'].map((id) => mkPlayer(id)), { mode: 'queue' });
    expect(orderedWaiting(skipTurn(s, 'a')).map((p) => p.id)).toEqual(['b', 'c', 'd', 'e', 'a']);
    expect(orderedWaiting(skipTurn(s, 'c')).map((p) => p.id)).toEqual(['a', 'b', 'd', 'e', 'c']);
  });

  it('takes the player off the play next list', () => {
    let s = nine();
    const id = idOf(s, waitingNames(s)[3]);
    s = playNext(s, id);
    s = skipTurn(s, id);
    expect(s.pinned).toBeUndefined();
    expect(waitingNames(s).at(-1)).toBe(s.players.find((p) => p.id === id)!.name);
    assertInvariants(s);
  });

  it('is for waiting players only, and does not change the input', () => {
    const s = nine();
    expectEngineError(() => skipTurn(s, s.courts[0].game!.team1[0]), 'NOT_WAITING');
    expectEngineError(() => skipTurn(s, 'nobody'), 'NOT_FOUND');
    const before = JSON.stringify(s);
    skipTurn(s, idOf(s, waitingNames(s)[0]));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('explaining a place that was moved', () => {
  it('says you are playing next, and says someone was moved for the players behind', () => {
    let s = nine();
    const names = waitingNames(s);
    s = playNext(s, idOf(s, names[4]));
    expect(explainWaiting(s, idOf(s, names[4]))).toEqual({ position: 1, reason: 'You are playing next.' });
    expect(explainWaiting(s, idOf(s, names[0]))).toEqual({ position: 2, reason: 'Someone was moved to play next.' });
  });

  it('does the same in queue mode', () => {
    let s = nine('queue');
    const names = waitingNames(s);
    s = playNext(s, idOf(s, names[3]));
    expect(explainWaiting(s, idOf(s, names[3]))?.reason).toBe('You are playing next.');
    expect(explainWaiting(s, idOf(s, names[0]))?.reason).toBe('Someone was moved to play next.');
  });

  it('puts the moved player second behind another moved player', () => {
    let s = nine();
    const names = waitingNames(s);
    s = playNext(s, idOf(s, names[4]));
    s = playNext(s, idOf(s, names[2]));
    expect(explainWaiting(s, idOf(s, names[2]))).toEqual({ position: 2, reason: 'You are playing next.' });
    expect(explainWaiting(s, idOf(s, names[0]))).toEqual({ position: 3, reason: 'Someone was moved to play next.' });
  });
});

describe('the invariants know about players asked to play next', () => {
  const broken = (change: (s: ReturnType<typeof nine>) => void) => {
    const s = nine();
    change(s);
    return () => assertInvariants(s);
  };

  it('reject a pinned player who is not waiting', () => {
    expect(broken((s) => (s.pinned = [s.courts[0].game!.team1[0]]))).toThrow();
  });

  it('reject a player pinned twice, and an empty list left behind', () => {
    expect(broken((s) => (s.pinned = [s.queueOrder[0], s.queueOrder[0]]))).toThrow();
    expect(broken((s) => (s.pinned = []))).toThrow();
  });

  it('accept a healthy list', () => {
    expect(broken((s) => (s.pinned = [s.queueOrder[0]]))).not.toThrow();
  });
});
