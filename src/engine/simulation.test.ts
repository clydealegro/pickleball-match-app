import { describe, expect, it } from 'vitest';
import { finishGame } from './game';
import { assertInvariants } from './invariants';
import { makeCtx, newTestSession } from './testing';
import type { Mode, Session } from './types';

function spread(s: Session): number {
  const games = s.players.filter((p) => p.status === 'active').map((p) => p.gamesPlayed);
  return Math.max(...games) - Math.min(...games);
}

describe.each<Mode>(['fairness', 'queue'])('long session (%s mode)', (mode) => {
  it('keeps invariants and an even spread of games over 100 games', () => {
    const names = Array.from({ length: 13 }, (_, i) => `P${i + 1}`);
    const base = makeCtx(42, 0);
    let s = newTestSession(names, { courts: 3, mode }, base);
    assertInvariants(s);

    let worstSpread = 0;
    for (let step = 1; step <= 100; step++) {
      const playing = s.courts
        .filter((c) => c.status === 'playing')
        .sort((a, b) => a.game!.startedAt - b.game!.startedAt);
      s = finishGame(s, playing[0].id, { ...base, now: step * 60_000 });
      assertInvariants(s);
      worstSpread = Math.max(worstSpread, spread(s));
    }

    expect(s.history).toHaveLength(100);
    expect(worstSpread).toBeLessThanOrEqual(1);
  });

  it('never repeats the exact same four players back-to-back on a court when others wait', () => {
    const names = Array.from({ length: 13 }, (_, i) => `P${i + 1}`);
    const base = makeCtx(7, 0);
    let s = newTestSession(names, { courts: 3, mode }, base);
    for (let step = 1; step <= 60; step++) {
      const playing = s.courts
        .filter((c) => c.status === 'playing')
        .sort((a, b) => a.game!.startedAt - b.game!.startedAt);
      const court = playing[0];
      const before = [...court.game!.team1, ...court.game!.team2].sort().join();
      s = finishGame(s, court.id, { ...base, now: step * 60_000 });
      const after = s.courts.find((c) => c.id === court.id)!;
      const afterIds = [...after.game!.team1, ...after.game!.team2].sort().join();
      expect(afterIds).not.toBe(before);
    }
  });
});
