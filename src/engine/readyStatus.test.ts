import { describe, expect, it } from 'vitest';
import { assertInvariants } from './invariants';
import { lineupIds } from './lineup';
import { orderedWaiting } from './pool';
import { startAllReady } from './start';
import { setPlayerStatus } from './status';
import { idOf, makeCtx, newTestSession } from './testing';

const hold = (names: string[], opts: { courts?: number; mode?: 'fairness' | 'queue' } = {}) =>
  newTestSession(names, { courts: 1, autoStart: false, ...opts });

describe('a break or leave on a Ready lineup', () => {
  it('takes effect at once and the next waiting player takes the place', () => {
    let s = hold(['A', 'B', 'C', 'D', 'E']);
    const out = lineupIds(s.courts[0])[1];
    const outName = s.players.find((p) => p.id === out)!.name;
    const waiting = orderedWaiting(s)[0].id;
    s = setPlayerStatus(s, out, 'break', makeCtx());
    const player = s.players.find((p) => p.id === out)!;
    expect(player.status).toBe('break');
    expect(player.pendingStatus).toBeUndefined();
    expect(lineupIds(s.courts[0])).toContain(waiting);
    expect(lineupIds(s.courts[0])).not.toContain(out);
    expect(s.courts[0].lineup!.team1[1]).toBe(waiting);
    expect(outName).toBeTruthy();
    assertInvariants(s);
  });

  it('works the same for leaving', () => {
    let s = hold(['A', 'B', 'C', 'D', 'E']);
    const out = lineupIds(s.courts[0])[0];
    s = setPlayerStatus(s, out, 'left', makeCtx());
    expect(s.players.find((p) => p.id === out)!.status).toBe('left');
    expect(lineupIds(s.courts[0])).toHaveLength(4);
    assertInvariants(s);
  });

  it('with nobody to take the place, empties the court and returns the other three to the front of the queue', () => {
    let s = hold(['A', 'B', 'C', 'D'], { mode: 'queue' });
    const [first, second, third, fourth] = lineupIds(s.courts[0]);
    s = setPlayerStatus(s, second, 'break', makeCtx());
    expect(s.courts[0].status).toBe('empty');
    expect(s.courts[0].lineup).toBeUndefined();
    expect(s.queueOrder).toEqual([first, third, fourth]);
    assertInvariants(s);
  });

  it('still defers a break for a player in a running game', () => {
    let s = startAllReady(hold(['A', 'B', 'C', 'D']), makeCtx());
    const id = idOf(s, 'A');
    s = setPlayerStatus(s, id, 'break', makeCtx());
    expect(s.players.find((p) => p.id === id)!.pendingStatus).toBe('break');
    assertInvariants(s);
  });
});

describe('a player returning from a break', () => {
  it('a player coming back from a break who completes a lineup makes a Ready court', () => {
    let s = hold(['A', 'B', 'C', 'D']);
    s = setPlayerStatus(s, idOf(s, 'A'), 'break', makeCtx());
    expect(s.courts[0].status).toBe('empty');
    s = setPlayerStatus(s, idOf(s, 'A'), 'active', makeCtx());
    expect(s.courts[0].status).toBe('ready');
    assertInvariants(s);
  });
});
