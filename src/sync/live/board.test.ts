import { describe, expect, it } from 'vitest';
import { mkPlayer, mkSession } from '../../engine/fixtures';
import type { Court, FinishedGame } from '../../engine/types';
import { buildBoard, nameParts } from './board';

const FACTS = { title: 'Tuesday open play', venue: 'Nitro', startMin: 960, endMin: 1140 };
const court = (n: number, over: Partial<Court> = {}): Court => ({ id: `c${n}`, number: n, status: 'empty', closing: false, ...over });
const game = (startedAt: number, finishedAt: number): FinishedGame => ({ team1: ['a', 'b'], team2: ['c', 'd'], courtNumber: 1, startedAt, finishedAt, winner: 1, score: [11, 5] });

function session() {
  return mkSession(
    [
      mkPlayer('a', { name: 'Ana Reyes', rosterId: 'r-a', rating: 9, gamesPlayed: 3, partnerCounts: { b: 2 } }),
      mkPlayer('b', { name: 'Ben Cruz', rating: 2 }),
      mkPlayer('c', { name: 'Cy' }),
      mkPlayer('d', { name: 'Dee Santos de la Cruz' }),
      mkPlayer('e', { name: 'Eli', status: 'break' }),
      mkPlayer('f', { name: 'Fay Ong', status: 'left' }),
      mkPlayer('g', { name: 'Gio' }),
      mkPlayer('h', { name: 'Hana' }),
      mkPlayer('i', { name: 'Ivy' }),
      mkPlayer('j', { name: 'Jo' }),
    ],
    {
      courts: [
        court(2, { status: 'playing', game: { team1: ['a', 'b'], team2: ['c', 'd'], startedAt: 1000 } }),
        court(1, { status: 'ready', lineup: { team1: ['g', 'h'], team2: ['i', 'j'] } }),
      ],
      history: [game(0, 600_000), game(0, 1_200_000)],
    },
  );
}

describe('nameParts', () => {
  it('splits a full name into a first name and a last initial', () => {
    expect(nameParts('Ana Reyes')).toEqual({ f: 'Ana', l: 'R' });
    expect(nameParts('  dee   santos de la cruz ')).toEqual({ f: 'dee', l: 'S' });
    expect(nameParts('Cy')).toEqual({ f: 'Cy', l: null });
    expect(nameParts('')).toEqual({ f: '?', l: null });
  });
});

describe('buildBoard', () => {
  it('carries the title, place and time, and the courts in number order', () => {
    const b = buildBoard(session(), FACTS);
    expect(b).toMatchObject({ title: 'Tuesday open play', venue: 'Nitro', startMin: 960, endMin: 1140 });
    expect(b.courts.map((c) => c.n)).toEqual([1, 2]);
  });

  it('shows who is on a playing court with its start, and who is up on a ready one', () => {
    const [ready, playing] = buildBoard(session(), FACTS).courts;
    expect(playing).toEqual({ n: 2, status: 'playing', closing: false, startedAt: 1000, teams: [['a', 'b'], ['c', 'd']] });
    expect(ready).toEqual({ n: 1, status: 'ready', closing: false, teams: [['g', 'h'], ['i', 'j']] });
  });

  it('leaves a court with nobody on it bare', () => {
    const s = { ...session(), courts: [court(1)] };
    expect(buildBoard(s, FACTS).courts).toEqual([{ n: 1, status: 'empty', closing: false }]);
  });

  it('names only first names and last initials, with the saved player id for the face', () => {
    const { players } = buildBoard(session(), FACTS);
    expect(players.a).toEqual({ f: 'Ana', l: 'R', r: 'r-a' });
    expect(players.d).toEqual({ f: 'Dee', l: 'S', r: null });
    expect(players.c).toEqual({ f: 'Cy', l: null, r: null });
  });

  it('lists the waiting and the players on a break, and leaves out players who left', () => {
    const b = buildBoard(session(), FACTS);
    expect(b.waiting).toEqual([]);
    expect(b.onBreak).toEqual(['e']);
    expect(Object.keys(b.players)).not.toContain('f');
  });

  it('gives the waiting order, and the likely next four with the court that frees first', () => {
    const s = mkSession(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => mkPlayer(id, { name: id.toUpperCase() })),
      { courts: [court(1, { status: 'playing', game: { team1: ['a', 'b'], team2: ['c', 'd'], startedAt: 5 } })], pinned: ['g'] },
    );
    const b = buildBoard(s, FACTS);
    expect(b.waiting).toEqual(['g', 'e', 'f']);
    expect(b.next).toBeUndefined();
    const more = { ...s, players: [...s.players, mkPlayer('h', { name: 'H' })] };
    const b2 = buildBoard(more, FACTS);
    expect(b2.next).toEqual({ court: 1, ids: b2.waiting.slice(0, 4) });
  });

  it('averages the finished games, and omits the average before there is one', () => {
    expect(buildBoard(session(), FACTS).avgGameMs).toBe(900_000);
    expect(buildBoard({ ...session(), history: [] }, FACTS).avgGameMs).toBeUndefined();
  });

  it('never carries a rating, a score, a result, a history or a partner count', () => {
    const text = JSON.stringify(buildBoard(session(), FACTS));
    for (const key of ['rating', 'score', 'winner', 'history', 'partnerCounts', 'opponentCounts', 'gamesPlayed']) {
      expect(text).not.toContain(`"${key}"`);
    }
    expect(text).not.toContain('Reyes');
    expect(text).not.toContain('Santos');
  });

  it('stays well under the size the database allows, for a full night', () => {
    const many = mkSession(
      Array.from({ length: 24 }, (_, i) => mkPlayer(`p${i}`, { name: `Player${i} Lastname${i}`, rosterId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` })),
      { courts: [1, 2, 3, 4].map((n) => court(n, { status: 'playing', game: { team1: [`p${n * 2}`, `p${n * 2 + 1}`], team2: [`p${n * 2 + 8}`, `p${n * 2 + 9}`], startedAt: 1 } })) },
    );
    expect(JSON.stringify(buildBoard(many, FACTS)).length).toBeLessThan(6000);
  });
});
