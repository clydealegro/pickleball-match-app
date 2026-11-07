import { describe, expect, it } from 'vitest';
import { addPlayer, createSession, endSession } from './session';
import { expectEngineError, idOf, makeCtx, mkPlayer, mkSession, newTestSession } from './testing';
import { onCourtIds } from './pool';

describe('createSession', () => {
  it('creates numbered empty courts when there are fewer than 4 players', () => {
    const s = newTestSession(['Ann', 'Ben', 'Cy'], { courts: 2 });
    expect(s.courts.map((c) => [c.number, c.status])).toEqual([
      [1, 'empty'],
      [2, 'empty'],
    ]);
    expect(s.queueOrder).toHaveLength(3);
  });

  it('starts a game on every court when there are enough players', () => {
    const s = newTestSession(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'], { courts: 2 });
    expect(s.courts.every((c) => c.status === 'playing')).toBe(true);
    expect(onCourtIds(s).size).toBe(8);
    expect(s.queueOrder).toHaveLength(1);
    expect(s.courts[0].game!.startedAt).toBe(1_000);
  });

  it('never puts the same player on two courts', () => {
    const s = newTestSession(Array.from({ length: 12 }, (_, i) => `P${i}`), { courts: 3 });
    const ids = s.courts.flatMap((c) => [...c.game!.team1, ...c.game!.team2]);
    expect(new Set(ids).size).toBe(12);
  });

  it('rejects a court count below 1', () => {
    expectEngineError(
      () => createSession({ name: 'x', mode: 'fairness', courtCount: 0, players: [] }, makeCtx()),
      'INVALID_COURTS',
    );
  });

  it('rejects duplicate or empty player names', () => {
    expectEngineError(
      () =>
        createSession(
          { name: 'x', mode: 'fairness', courtCount: 1, players: [{ name: 'Ann' }, { name: ' ann ' }] },
          makeCtx(),
        ),
      'DUPLICATE_NAME',
    );
    expectEngineError(
      () =>
        createSession({ name: 'x', mode: 'fairness', courtCount: 1, players: [{ name: '  ' }] }, makeCtx()),
      'EMPTY_NAME',
    );
  });

  it('falls back to a default session name', () => {
    const s = createSession({ name: '  ', mode: 'queue', courtCount: 1, players: [] }, makeCtx());
    expect(s.name).toBe('Pickleball session');
    expect(s.mode).toBe('queue');
  });

  it('keeps the roster link on each player', () => {
    const s = createSession(
      { name: 'x', mode: 'fairness', courtCount: 1, players: [{ name: 'Ann', rosterId: 'r1' }] },
      makeCtx(),
    );
    expect(s.players[0].rosterId).toBe('r1');
  });
});

describe('addPlayer', () => {
  it('rejects empty and duplicate names (case-insensitive)', () => {
    const s = newTestSession(['Ann', 'Ben']);
    expectEngineError(() => addPlayer(s, { name: '   ' }, makeCtx()), 'EMPTY_NAME');
    expectEngineError(() => addPlayer(s, { name: 'ANN' }, makeCtx()), 'DUPLICATE_NAME');
  });

  it('starts late arrivals at the floor of the average games played', () => {
    const s = mkSession(
      [
        mkPlayer('a', { gamesPlayed: 3 }),
        mkPlayer('b', { gamesPlayed: 2 }),
        mkPlayer('c', { status: 'break', gamesPlayed: 9 }),
      ],
      { gameSeq: 7 },
    );
    const next = addPlayer(s, { name: 'New' }, makeCtx());
    const p = next.players.find((q) => q.name === 'New')!;
    expect(p.gamesPlayed).toBe(2);
    expect(p.lastFinishedSeq).toBe(7);
    expect(next.queueOrder.at(-1)).toBe(p.id);
  });

  it('fills an empty court once a fourth player arrives', () => {
    const s = newTestSession(['A', 'B', 'C']);
    expect(s.courts[0].status).toBe('empty');
    const next = addPlayer(s, { name: 'D' }, makeCtx(2));
    expect(next.courts[0].status).toBe('playing');
    expect(next.queueOrder).toHaveLength(0);
  });

  it('does not mutate the input session', () => {
    const s = newTestSession(['A', 'B', 'C']);
    const before = JSON.stringify(s);
    addPlayer(s, { name: 'D' }, makeCtx(2));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('endSession', () => {
  it('stamps endedAt without touching anything else', () => {
    const s = newTestSession(['A', 'B', 'C', 'D']);
    const ended = endSession(s, makeCtx(1, 9_999));
    expect(ended.endedAt).toBe(9_999);
    expect(ended.courts).toEqual(s.courts);
    expect(idOf(ended, 'A')).toBe(idOf(s, 'A'));
  });
});

describe('private ratings', () => {
  it('copies a saved player\'s rating onto the session player and uses it for the first split', () => {
    const ratings: Record<string, number> = { ra: 10, rb: 9, rc: 2, rd: 1 };
    const ctx = { ...makeCtx(), ratingOf: (id: string) => ratings[id] };
    const s = createSession(
      {
        name: 'T',
        mode: 'fairness',
        courtCount: 1,
        players: ['a', 'b', 'c', 'd'].map((n) => ({ name: n, rosterId: `r${n}` })),
      },
      ctx,
    );
    expect(s.players.map((p) => p.rating)).toEqual([10, 9, 2, 1]);
    const game = s.courts[0].game!;
    const teamOf = (id: string) => (game.team1.includes(id) ? 1 : 2);
    const byName = (n: string) => s.players.find((p) => p.name === n)!.id;
    // 10 + 1 against 9 + 2 is the closest split.
    expect(teamOf(byName('a'))).toBe(teamOf(byName('d')));
    expect(teamOf(byName('b'))).toBe(teamOf(byName('c')));
    expect(teamOf(byName('a'))).not.toBe(teamOf(byName('b')));
  });

  it('adds no rating field when the lookup has none', () => {
    const s = createSession(
      { name: 'T', mode: 'fairness', courtCount: 1, players: [{ name: 'a', rosterId: 'ra' }] },
      makeCtx(),
    );
    expect('rating' in s.players[0]).toBe(false);
  });
});
