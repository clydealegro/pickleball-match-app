import { describe, expect, it } from 'vitest';
import { finishGame } from './game';
import { previewNext } from './preview';
import { makeCtx, nameOf, newTestSession } from './testing';
import { orderedWaiting } from './pool';

describe('previewNext', () => {
  it('is null when fewer than 4 players are waiting', () => {
    const s = newTestSession(['A', 'B', 'C', 'D', 'E'], { courts: 1 });
    expect(previewNext(s)).toBeNull();
  });

  it('shows the 4 who will play next on the court that started earliest', () => {
    const ctx = makeCtx(1, 1_000);
    const names = Array.from({ length: 12 }, (_, i) => `P${i}`);
    let s = newTestSession(names, { courts: 2 }, ctx);
    s = finishGame(s, s.courts[0].id, { ...ctx, now: 2_000 }); // court 1 restarts at 2000
    const next = previewNext(s)!;
    expect(next.courtNumber).toBe(2); // started at 1000, so it ends first
    expect(next.playerIds).toEqual(
      orderedWaiting(s)
        .slice(0, 4)
        .map((p) => p.id),
    );
  });

  it('queue mode previews the front of the queue', () => {
    const s = newTestSession(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], { courts: 1, mode: 'queue' });
    const next = previewNext(s)!;
    expect(next.playerIds.map((id) => nameOf(s, id))).toEqual(['E', 'F', 'G', 'H']);
  });

  it('is null when every court is closing', () => {
    const s = newTestSession(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], { courts: 1 });
    s.courts[0].closing = true;
    expect(previewNext(s)).toBeNull();
  });
});
