import { describe, expect, it } from 'vitest';
import { finishGame } from './game';
import { assertInvariants } from './invariants';
import { lineupIds } from './lineup';
import { locatePlayer, swapCandidates } from './locate';
import { playNext } from './pins';
import { orderedWaiting } from './pool';
import { startAllReady, startCourt } from './start';
import { setPlayerStatus } from './status';
import { notHere, swapPlayers } from './swap';
import { expectEngineError, makeCtx, newTestSession } from './testing';
import type { Mode, Session } from './types';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `P${i + 1}`);
/** One court with a Ready lineup and `extra` players waiting. */
const ready = (extra: number, mode: Mode = 'fairness') => newTestSession(ids(4 + extra), { courts: 1, mode, autoStart: false });
/** Same, with the game started. */
const playing = (extra: number, mode: Mode = 'fairness') => startAllReady(ready(extra, mode), makeCtx(1, 1_000));
const firstWaiting = (s: Session) => orderedWaiting(s)[0].id;
const courtIds = (s: Session, i = 0) => (s.courts[i].game ? [...s.courts[i].game!.team1, ...s.courts[i].game!.team2] : lineupIds(s.courts[i]));

describe.each<Mode>(['fairness', 'queue'])('swapping a waiting player onto a Ready lineup (%s mode)', (mode) => {
  it('puts the waiting player in the other’s exact place, and the other back to waiting', () => {
    const s = ready(2, mode);
    const out = s.courts[0].lineup!.team2[1];
    const inId = firstWaiting(s);
    const next = swapPlayers(s, inId, out);
    expect(next.courts[0].lineup!.team2[1]).toBe(inId);
    expect(next.courts[0].lineup!.team1).toEqual(s.courts[0].lineup!.team1);
    expect(orderedWaiting(next).map((p) => p.id)).toContain(out);
    expect(orderedWaiting(next).map((p) => p.id)).not.toContain(inId);
    assertInvariants(next);
  });

  it('works whichever way round the two are named', () => {
    const s = ready(1, mode);
    const out = s.courts[0].lineup!.team1[0];
    const inId = firstWaiting(s);
    expect(swapPlayers(s, out, inId)).toEqual(swapPlayers(s, inId, out));
  });

  it('changes nobody’s games or counts, and not the input', () => {
    const s = ready(1, mode);
    const before = JSON.stringify(s);
    const next = swapPlayers(s, firstWaiting(s), s.courts[0].lineup!.team1[0]);
    expect(next.players).toEqual(s.players);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('who goes to the front of the line when someone is taken off', () => {
  it('is the front of the queue in queue mode', () => {
    const s = ready(3, 'queue');
    const out = s.courts[0].lineup!.team1[0];
    const next = swapPlayers(s, firstWaiting(s), out);
    expect(next.queueOrder[0]).toBe(out);
    assertInvariants(next);
  });

  it('is a place by the usual rule in fairness mode, so a player who has played less comes back sooner', () => {
    const s = ready(3, 'fairness');
    const out = s.courts[0].lineup!.team1[0];
    const next = swapPlayers(s, firstWaiting(s), out);
    expect(orderedWaiting(next).map((p) => p.id)).toContain(out);
    assertInvariants(next);
  });
});

describe('swapping into a game that is running', () => {
  it('replaces the player in the game, and credits the substitute and not the player taken off, at the finish', () => {
    let s = playing(2);
    const out = s.courts[0].game!.team1[0];
    const sub = firstWaiting(s);
    s = swapPlayers(s, sub, out);
    expect(courtIds(s)).toContain(sub);
    expect(courtIds(s)).not.toContain(out);
    s = finishGame(s, s.courts[0].id, makeCtx(1, 600_000));
    expect(s.players.find((p) => p.id === sub)!.gamesPlayed).toBe(1);
    expect(s.players.find((p) => p.id === out)!.gamesPlayed).toBe(0);
    // Partners and opponents are the four who really played.
    const g = s.history[0];
    expect([...g.team1, ...g.team2]).toContain(sub);
    expect([...g.team1, ...g.team2]).not.toContain(out);
    expect(Object.keys(s.players.find((p) => p.id === sub)!.partnerCounts)).toHaveLength(1);
    expect(Object.keys(s.players.find((p) => p.id === out)!.partnerCounts)).toHaveLength(0);
    assertInvariants(s);
  });

  it('leaves the clock of the game alone', () => {
    const s = playing(1);
    const next = swapPlayers(s, firstWaiting(s), s.courts[0].game!.team2[0]);
    expect(next.courts[0].game!.startedAt).toBe(1_000);
  });

  it('applies a break or leave that the player taken off had asked for at the end of the game', () => {
    let s = playing(2);
    const out = s.courts[0].game!.team1[1];
    s = setPlayerStatus(s, out, 'break', makeCtx());
    expect(s.players.find((p) => p.id === out)!.pendingStatus).toBe('break');
    s = swapPlayers(s, firstWaiting(s), out);
    const p = s.players.find((q) => q.id === out)!;
    expect(p.status).toBe('break');
    expect(p.pendingStatus).toBeUndefined();
    expect(s.queueOrder).not.toContain(out);
    assertInvariants(s);
  });
});

describe('swapping two players who are both on courts', () => {
  it('trades their places across two courts, whether Ready or running', () => {
    let s = newTestSession(ids(8), { courts: 2, autoStart: false });
    s = startCourt1(s);
    const a = s.courts[0].game!.team1[0];
    const b = s.courts[1].lineup!.team2[1];
    const next = swapPlayers(s, a, b);
    expect(next.courts[0].game!.team1[0]).toBe(b);
    expect(next.courts[1].lineup!.team2[1]).toBe(a);
    assertInvariants(next);
  });

  it('moves a player to the other team of the same court', () => {
    const s = ready(0);
    const a = s.courts[0].lineup!.team1[0];
    const b = s.courts[0].lineup!.team2[0];
    const next = swapPlayers(s, a, b);
    expect(next.courts[0].lineup!.team1[0]).toBe(b);
    expect(next.courts[0].lineup!.team2[0]).toBe(a);
    assertInvariants(next);
  });

  it('refuses two partners on the same team', () => {
    const s = ready(0);
    expectEngineError(() => swapPlayers(s, s.courts[0].lineup!.team1[0], s.courts[0].lineup!.team1[1]), 'INVALID_SWAP');
  });
});

describe('a swap that makes no sense', () => {
  it('is refused for two waiting players, the same player twice, and anyone on a break or gone', () => {
    const s = ready(3);
    const [w1, w2] = orderedWaiting(s).map((p) => p.id);
    expectEngineError(() => swapPlayers(s, w1, w2), 'INVALID_SWAP');
    expectEngineError(() => swapPlayers(s, w1, w1), 'INVALID_SWAP');
    const onBreak = setPlayerStatus(s, w2, 'break', makeCtx());
    expectEngineError(() => swapPlayers(onBreak, w2, s.courts[0].lineup!.team1[0]), 'INVALID_SWAP');
    const left = setPlayerStatus(s, w2, 'left', makeCtx());
    expectEngineError(() => swapPlayers(left, s.courts[0].lineup!.team1[0], w2), 'INVALID_SWAP');
    expectEngineError(() => swapPlayers(s, 'nobody', w1), 'NOT_FOUND');
  });

  it('takes a waiting player off the play next list when they are swapped in', () => {
    let s = ready(3);
    const sub = orderedWaiting(s)[2].id;
    s = playNext(s, sub);
    s = swapPlayers(s, sub, s.courts[0].lineup!.team1[0]);
    expect(s.pinned).toBeUndefined();
    assertInvariants(s);
  });
});

describe('notHere', () => {
  it('takes the absent player out of a Ready lineup, brings the next waiting player in, and puts the absent one on a break', () => {
    const s = ready(2);
    const absent = s.courts[0].lineup!.team2[0];
    const replacement = firstWaiting(s);
    const next = notHere(s, absent, makeCtx());
    expect(courtIds(next)).toContain(replacement);
    expect(courtIds(next)).not.toContain(absent);
    expect(next.players.find((p) => p.id === absent)!.status).toBe('break');
    expect(next.queueOrder).not.toContain(absent);
    assertInvariants(next);
  });

  it('does the same inside a running game, and the replacement is credited at the finish', () => {
    let s = playing(1);
    const absent = s.courts[0].game!.team1[0];
    const replacement = firstWaiting(s);
    s = notHere(s, absent, makeCtx());
    expect(s.players.find((p) => p.id === absent)!.status).toBe('break');
    s = finishGame(s, s.courts[0].id, makeCtx(1, 600_000));
    expect(s.players.find((p) => p.id === replacement)!.gamesPlayed).toBe(1);
    expect(s.players.find((p) => p.id === absent)!.gamesPlayed).toBe(0);
    assertInvariants(s);
  });

  it('says so and changes nothing when nobody is waiting', () => {
    const s = ready(0);
    const before = JSON.stringify(s);
    expectEngineError(() => notHere(s, s.courts[0].lineup!.team1[0], makeCtx()), 'NO_REPLACEMENT');
    expect(JSON.stringify(s)).toBe(before);
  });

  it('is for a player on a court', () => {
    const s = ready(2);
    expectEngineError(() => notHere(s, firstWaiting(s), makeCtx()), 'INVALID_SWAP');
    expectEngineError(() => notHere(s, 'nobody', makeCtx()), 'NOT_FOUND');
  });

  it('brings in a player who was asked to play next first, since they are first in line', () => {
    let s = ready(3);
    const chosen = orderedWaiting(s)[2].id;
    s = playNext(s, chosen);
    const next = notHere(s, s.courts[0].lineup!.team1[0], makeCtx());
    expect(courtIds(next)).toContain(chosen);
    expect(next.pinned).toBeUndefined();
  });
});

describe('locatePlayer and swapCandidates', () => {
  it('says where each player is', () => {
    let s = newTestSession(ids(10), { courts: 2, autoStart: false });
    s = startCourt1(s);
    const inGame = s.courts[0].game!.team1[0];
    const inLineup = s.courts[1].lineup!.team2[0];
    const waiting = firstWaiting(s);
    expect(locatePlayer(s, inGame)).toEqual({ kind: 'game', courtNumber: 1, team: 1 });
    expect(locatePlayer(s, inLineup)).toEqual({ kind: 'lineup', courtNumber: 2, team: 2 });
    expect(locatePlayer(s, waiting)).toEqual({ kind: 'waiting' });
    const onBreak = setPlayerStatus(s, waiting, 'break', makeCtx());
    expect(locatePlayer(onBreak, waiting)).toEqual({ kind: 'off' });
  });

  it('offers a court player the waiting players in order and the other court players, never their own partner', () => {
    let s = newTestSession(ids(10), { courts: 2, autoStart: false });
    s = startCourt1(s);
    const me = s.courts[0].game!.team1[0];
    const partner = s.courts[0].game!.team1[1];
    const c = swapCandidates(s, me);
    expect(c.waiting.map((p) => p.id)).toEqual(orderedWaiting(s).map((p) => p.id));
    const others = c.onCourts.map((o) => o.player.id);
    expect(others).not.toContain(me);
    expect(others).not.toContain(partner);
    expect(others).toHaveLength(7 - 1); // 8 on courts, minus themselves and their partner
    expect(c.onCourts.find((o) => o.courtNumber === 2)!.status).toBe('ready');
    expect(c.onCourts.find((o) => o.courtNumber === 1)!.team).toBe(2);
  });

  it('offers a waiting player only the players on courts', () => {
    let s = newTestSession(ids(10), { courts: 2, autoStart: false });
    s = startCourt1(s);
    const c = swapCandidates(s, firstWaiting(s));
    expect(c.waiting).toEqual([]);
    expect(c.onCourts).toHaveLength(8);
  });

  it('offers nothing to a player who is on a break', () => {
    const s = ready(2);
    const w = firstWaiting(s);
    const onBreak = setPlayerStatus(s, w, 'break', makeCtx());
    expect(swapCandidates(onBreak, w)).toEqual({ waiting: [], onCourts: [] });
  });
});

/** Starts the first court only, leaving any others Ready. */
function startCourt1(s: Session): Session {
  return startCourt(s, s.courts[0].id, makeCtx(1, 1_000));
}
