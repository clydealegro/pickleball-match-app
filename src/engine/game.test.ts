import { describe, expect, it } from 'vitest';
import { removeCourt } from './courts';
import { finishGame } from './game';
import { onCourtIds } from './pool';
import { expectEngineError, makeCtx, nameOf, newTestSession } from './testing';

describe('finishGame', () => {
  it('records history, bumps counters, and refills the court', () => {
    const ctx = makeCtx(1, 1_000);
    const s = newTestSession(['A', 'B', 'C', 'D', 'E'], { courts: 1 }, ctx);
    const court = s.courts[0];
    const { team1, team2 } = court.game!;
    const waiter = s.players.find((p) => ![...team1, ...team2].includes(p.id))!;

    const next = finishGame(s, court.id, { ...ctx, now: 5_000 });

    expect(next.history).toEqual([
      { team1, team2, courtNumber: 1, startedAt: 1_000, finishedAt: 5_000 },
    ]);
    expect(next.gameSeq).toBe(1);
    expect(next.players.filter((p) => p.gamesPlayed === 1)).toHaveLength(4);
    // The waiting player has the fewest games, so must be in the next game.
    expect(onCourtIds(next).has(waiter.id)).toBe(true);
    expect(next.courts[0].game!.startedAt).toBe(5_000);

    const byId = (id: string) => next.players.find((p) => p.id === id)!;
    expect(byId(team1[0]).partnerCounts[team1[1]]).toBe(1);
    expect(byId(team1[1]).partnerCounts[team1[0]]).toBe(1);
    expect(byId(team2[0]).partnerCounts[team2[1]]).toBe(1);
    expect(byId(team1[0]).opponentCounts[team2[0]]).toBe(1);
    expect(byId(team2[1]).opponentCounts[team1[1]]).toBe(1);
    expect(byId(team1[0]).lastFinishedSeq).toBe(1);
  });

  it('queue mode: finishers go to the back (team 1 then team 2) and the next four play', () => {
    const s = newTestSession(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], { courts: 1, mode: 'queue' });
    const names = (ids: string[], sess = s) => ids.map((id) => nameOf(sess, id));
    expect(names(s.courts[0].game!.team1)).toEqual(['A', 'B']);
    expect(names(s.courts[0].game!.team2)).toEqual(['C', 'D']);

    const next = finishGame(s, s.courts[0].id, makeCtx(2));
    expect(names(next.courts[0].game!.team1, next)).toEqual(['E', 'F']);
    expect(names(next.courts[0].game!.team2, next)).toEqual(['G', 'H']);
    expect(names(next.queueOrder, next)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('removes a closing court after its game ends', () => {
    const ctx = makeCtx();
    let s = newTestSession(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], { courts: 2 }, ctx);
    const second = s.courts[1];
    s = removeCourt(s, second.id, makeCtx());
    expect(s.courts[1].closing).toBe(true);

    const next = finishGame(s, second.id, makeCtx(3));
    expect(next.courts).toHaveLength(1);
    expect(next.courts[0].number).toBe(1);
    // Its four players are waiting again.
    expect(next.queueOrder).toHaveLength(4);
  });

  it('throws for an unknown court or one that is not playing', () => {
    const s = newTestSession(['A', 'B', 'C'], { courts: 1 });
    expectEngineError(() => finishGame(s, 'nope', makeCtx()), 'NOT_FOUND');
    expectEngineError(() => finishGame(s, s.courts[0].id, makeCtx()), 'NOT_PLAYING');
  });

  it('does not mutate the input session', () => {
    const s = newTestSession(['A', 'B', 'C', 'D', 'E'], { courts: 1 });
    const before = JSON.stringify(s);
    finishGame(s, s.courts[0].id, makeCtx(2));
    expect(JSON.stringify(s)).toBe(before);
  });
});
