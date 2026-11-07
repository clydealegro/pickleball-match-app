import { describe, expect, it } from 'vitest';
import { finishGame } from './game';
import { addPlayer } from './session';
import { setPlayerStatus } from './status';
import { expectEngineError, idOf, makeCtx, mkPlayer, mkSession, newTestSession } from './testing';
import { removeCourt } from './courts';
import { onCourtIds } from './pool';

describe('setPlayerStatus', () => {
  it('break while waiting: takes effect immediately and leaves the queue', () => {
    const s = newTestSession(['A', 'B', 'C', 'D', 'E']);
    const waiterId = s.queueOrder[0];
    const next = setPlayerStatus(s, waiterId, 'break', makeCtx());
    expect(next.players.find((p) => p.id === waiterId)!.status).toBe('break');
    expect(next.queueOrder).not.toContain(waiterId);
  });

  it('break while on court: pending until the game ends', () => {
    const s = newTestSession(['A', 'B', 'C', 'D']);
    const playerId = idOf(s, 'A');
    const pending = setPlayerStatus(s, playerId, 'break', makeCtx());
    const p = pending.players.find((q) => q.id === playerId)!;
    expect(p.status).toBe('active');
    expect(p.pendingStatus).toBe('break');

    const after = finishGame(pending, pending.courts[0].id, makeCtx(2));
    const done = after.players.find((q) => q.id === playerId)!;
    expect(done.status).toBe('break');
    expect(done.pendingStatus).toBeUndefined();
    expect(after.queueOrder).not.toContain(playerId);
    // Only three players remain available, so the court stays empty.
    expect(after.courts[0].status).toBe('empty');
  });

  it('cancels a pending break when the player is set back to active', () => {
    const s = newTestSession(['A', 'B', 'C', 'D']);
    const id = idOf(s, 'A');
    const pending = setPlayerStatus(s, id, 'break', makeCtx());
    const cancelled = setPlayerStatus(pending, id, 'active', makeCtx());
    expect(cancelled.players.find((p) => p.id === id)!.pendingStatus).toBeUndefined();
  });

  it('return from break: games played never drops, and rises to the average', () => {
    const s = mkSession(
      [
        mkPlayer('a', { gamesPlayed: 4 }),
        mkPlayer('b', { gamesPlayed: 4 }),
        mkPlayer('c', { gamesPlayed: 4 }),
        mkPlayer('low', { status: 'break', gamesPlayed: 1 }),
        mkPlayer('high', { status: 'break', gamesPlayed: 9 }),
      ],
      { gameSeq: 6, queueOrder: ['a', 'b', 'c'] },
    );
    const lowBack = setPlayerStatus(s, 'low', 'active', makeCtx());
    const low = lowBack.players.find((p) => p.id === 'low')!;
    expect(low.status).toBe('active');
    expect(low.gamesPlayed).toBe(4);
    expect(low.lastFinishedSeq).toBe(6);
    expect(lowBack.queueOrder.at(-1)).toBe('low');

    const highBack = setPlayerStatus(s, 'high', 'active', makeCtx());
    expect(highBack.players.find((p) => p.id === 'high')!.gamesPlayed).toBe(9);
  });

  it('returning can fill an idle court', () => {
    let s = newTestSession(['A', 'B', 'C', 'D']);
    const a = idOf(s, 'A');
    s = setPlayerStatus(s, a, 'break', makeCtx());
    s = finishGame(s, s.courts[0].id, makeCtx(2));
    // A went on break, so only 3 are available and the court is idle.
    expect(s.courts[0].status).toBe('empty');
    expect(s.queueOrder).toHaveLength(3);

    s = setPlayerStatus(s, a, 'active', makeCtx(3));
    expect(s.courts[0].status).toBe('playing');
    expect(s.queueOrder).toHaveLength(0);
  });

  it('pending leave is applied when the game ends', () => {
    let s = newTestSession(['A', 'B', 'C', 'D', 'E']);
    const onCourt = [...onCourtIds(s)][0];
    s = setPlayerStatus(s, onCourt, 'left', makeCtx());
    expect(s.players.find((p) => p.id === onCourt)!.pendingStatus).toBe('left');
    s = finishGame(s, s.courts[0].id, makeCtx(2));
    const p = s.players.find((q) => q.id === onCourt)!;
    expect(p.status).toBe('left');
    expect(p.pendingStatus).toBeUndefined();
    expect(s.queueOrder).not.toContain(onCourt);
    expect(onCourtIds(s).has(onCourt)).toBe(false);
  });

  it('break then leave while on court overwrites the pending value', () => {
    let s = newTestSession(['A', 'B', 'C', 'D', 'E']);
    const id = [...onCourtIds(s)][0];
    s = setPlayerStatus(s, id, 'break', makeCtx());
    s = setPlayerStatus(s, id, 'left', makeCtx());
    expect(s.players.find((p) => p.id === id)!.pendingStatus).toBe('left');
    s = finishGame(s, s.courts[0].id, makeCtx(2));
    expect(s.players.find((p) => p.id === id)!.status).toBe('left');
  });

  it('applies a pending break on a closing court', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    let s = newTestSession(names, { courts: 2 });
    const court2 = s.courts[1];
    s = removeCourt(s, court2.id, makeCtx());
    expect(s.courts[1].closing).toBe(true);
    const game = s.courts[1].game!;
    const four = [...game.team1, ...game.team2];
    const breaker = four[0];
    s = setPlayerStatus(s, breaker, 'break', makeCtx());
    s = finishGame(s, court2.id, makeCtx(2));
    expect(s.courts.find((c) => c.id === court2.id)).toBeUndefined();
    expect(s.players.find((p) => p.id === breaker)!.status).toBe('break');
    expect(s.queueOrder).not.toContain(breaker);
    expect(s.queueOrder).toHaveLength(3);
    for (const id of four.slice(1)) expect(s.queueOrder).toContain(id);
  });

  it('a cancelled pending status requeues the player exactly once', () => {
    let s = newTestSession(['A', 'B', 'C', 'D', 'E']);
    const id = [...onCourtIds(s)][0];
    s = setPlayerStatus(s, id, 'break', makeCtx());
    s = setPlayerStatus(s, id, 'active', makeCtx());
    s = finishGame(s, s.courts[0].id, makeCtx(2));
    const appearances =
      s.queueOrder.filter((q) => q === id).length + (onCourtIds(s).has(id) ? 1 : 0);
    expect(appearances).toBe(1);
  });

  it('a player who left cannot return, but the name can be re-added', () => {
    let s = newTestSession(['A', 'B', 'C', 'D', 'E']);
    const id = s.queueOrder[0];
    const name = s.players.find((p) => p.id === id)!.name;
    s = setPlayerStatus(s, id, 'left', makeCtx());
    expect(s.players.find((p) => p.id === id)!.status).toBe('left');
    expectEngineError(() => setPlayerStatus(s, id, 'active', makeCtx()), 'CANNOT_RETURN');

    const readded = addPlayer(s, { name }, makeCtx(5));
    expect(readded.players.filter((p) => p.name === name)).toHaveLength(2);
  });

  it('break → leave goes straight to left', () => {
    let s = newTestSession(['A', 'B', 'C', 'D', 'E']);
    const id = s.queueOrder[0];
    s = setPlayerStatus(s, id, 'break', makeCtx());
    s = setPlayerStatus(s, id, 'left', makeCtx());
    expect(s.players.find((p) => p.id === id)!.status).toBe('left');
  });

  it('is a no-op for repeated requests and does not mutate its input', () => {
    const s = newTestSession(['A', 'B', 'C', 'D', 'E']);
    const id = s.queueOrder[0];
    const before = JSON.stringify(s);
    const once = setPlayerStatus(s, id, 'break', makeCtx());
    expect(JSON.stringify(s)).toBe(before);
    const twice = setPlayerStatus(once, id, 'break', makeCtx());
    expect(twice).toEqual(once);
  });
});
