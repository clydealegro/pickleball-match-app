import { describe, expect, it } from 'vitest';
import type { Court } from '../engine';
import { mkPlayer, mkSession } from '../engine/testing';
import { boardName, courtViews, gameClock, gridFor, nameHue, waitingCapacity } from './boardInfo';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const NOW = 10_000_000;

const players = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => mkPlayer(id, { name: id.toUpperCase() }));

function court(number: number, over: Partial<Court> = {}): Court {
  return { id: `c${number}`, number, status: 'empty', closing: false, ...over };
}

const names = (team: { name: string }[]) => team.map((p) => p.name);

describe('courtViews', () => {
  it('gives an empty court as open with no teams and no clock', () => {
    const [v] = courtViews(mkSession(players, { courts: [court(1)] }), NOW);
    expect(v).toEqual({ id: 'c1', number: 1, state: 'open', closing: false, teamA: [], teamB: [] });
  });

  it('gives a playing court its clock and both teams from the game', () => {
    const s = mkSession(players, {
      courts: [court(1, { status: 'playing', game: { team1: ['a', 'b'], team2: ['c', 'd'], startedAt: NOW - 12 * MIN - 41 * SEC } })],
    });
    const [v] = courtViews(s, NOW);
    expect(v.state).toBe('playing');
    expect(v.clock).toBe('12:41');
    expect(names(v.teamA)).toEqual(['A', 'B']);
    expect(names(v.teamB)).toEqual(['C', 'D']);
  });

  it('gives a ready court its teams from the lineup and no clock', () => {
    const s = mkSession(players, {
      courts: [court(1, { status: 'ready', lineup: { team1: ['e', 'f'], team2: ['g', 'h'] } })],
    });
    const [v] = courtViews(s, NOW);
    expect(v.state).toBe('ready');
    expect(v.clock).toBeUndefined();
    expect(names(v.teamA)).toEqual(['E', 'F']);
    expect(names(v.teamB)).toEqual(['G', 'H']);
  });

  it('treats a ready or playing court without its lineup or game as open', () => {
    const s = mkSession(players, { courts: [court(1, { status: 'ready' }), court(2, { status: 'playing' })] });
    expect(courtViews(s, NOW).map((v) => v.state)).toEqual(['open', 'open']);
  });

  it('keeps the closing flag with any state', () => {
    const s = mkSession(players, {
      courts: [
        court(1, { closing: true }),
        court(2, { closing: true, status: 'playing', game: { team1: ['a', 'b'], team2: ['c', 'd'], startedAt: NOW } }),
        court(3),
      ],
    });
    expect(courtViews(s, NOW).map((v) => v.closing)).toEqual([true, true, false]);
  });

  it('resolves teams by id and drops an id that is not in the session', () => {
    const s = mkSession(players, {
      courts: [court(1, { status: 'ready', lineup: { team1: ['a', 'zzz'], team2: ['c', 'd'] } })],
    });
    const [v] = courtViews(s, NOW);
    expect(names(v.teamA)).toEqual(['A']);
    expect(names(v.teamB)).toEqual(['C', 'D']);
  });

  it('lists the courts in court-number order', () => {
    const s = mkSession(players, { courts: [court(3), court(1), court(2)] });
    expect(courtViews(s, NOW).map((v) => v.number)).toEqual([1, 2, 3]);
  });

  it('does not change the session it is given', () => {
    const s = mkSession(players, { courts: [court(2), court(1)] });
    courtViews(s, NOW);
    expect(s.courts.map((c) => c.number)).toEqual([2, 1]);
  });
});

describe('gameClock', () => {
  const at = (ms: number) => gameClock(NOW - ms, NOW);

  it('starts at 0:00', () => expect(at(0)).toBe('0:00'));
  it('pads the seconds', () => expect(at(9 * SEC)).toBe('0:09'));
  it('shows 59 seconds', () => expect(at(59 * SEC)).toBe('0:59'));
  it('turns 60 seconds into a minute', () => expect(at(60 * SEC)).toBe('1:00'));
  it('drops the part of a second', () => expect(at(9 * SEC + 999)).toBe('0:09'));
  it('shows minutes and seconds', () => expect(at(12 * MIN + 41 * SEC)).toBe('12:41'));
  it('shows 59:59 just before an hour', () => expect(at(HOUR - SEC)).toBe('59:59'));
  it('switches to h:mm:ss at exactly one hour', () => expect(at(HOUR)).toBe('1:00:00'));
  it('pads minutes and seconds over an hour', () => expect(at(HOUR + 2 * MIN + 3 * SEC)).toBe('1:02:03'));
  it('keeps counting hours', () => expect(at(10 * HOUR + 5 * MIN + 9 * SEC)).toBe('10:05:09'));
  it('is never negative when the start is in the future', () => {
    expect(at(-5 * SEC)).toBe('0:00');
    expect(at(-3 * HOUR)).toBe('0:00');
  });
});

describe('boardName', () => {
  const p = (id: string, name: string) => mkPlayer(id, { name });

  it('is the first name when first names are unique', () => {
    const all = [p('1', 'Ana Reyes'), p('2', 'Ben Cruz')];
    expect(boardName(all[0], all)).toBe('Ana');
  });

  it('adds the last initial when another player shares the first name', () => {
    const all = [p('1', 'Ana Reyes'), p('2', 'Ana Cruz')];
    expect(boardName(all[0], all)).toBe('Ana R.');
    expect(boardName(all[1], all)).toBe('Ana C.');
  });

  it('uses the last word as the last name and upper-cases the initial', () => {
    const all = [p('1', 'Ana maria santos'), p('2', 'Ana Cruz')];
    expect(boardName(all[0], all)).toBe('Ana S.');
  });

  it('matches first names without caring about case', () => {
    const all = [p('1', 'ANA Reyes'), p('2', 'ana Cruz')];
    expect(boardName(all[0], all)).toBe('ANA R.');
  });

  it('gives a single-word name as it is', () => {
    const all = [p('1', 'Ana'), p('2', 'Ben')];
    expect(boardName(all[0], all)).toBe('Ana');
  });

  it('ignores extra spaces', () => {
    const all = [p('1', '  Ana   Reyes  '), p('2', 'Ben')];
    expect(boardName(all[0], all)).toBe('Ana');
    const dup = [p('1', '  Ana   Reyes  '), p('2', 'Ana  Cruz ')];
    expect(boardName(dup[0], dup)).toBe('Ana R.');
  });

  it('adds nothing for a player with no last name, even when the first name is shared', () => {
    const all = [p('1', 'Ana'), p('2', 'Ana Cruz')];
    expect(boardName(all[0], all)).toBe('Ana');
    expect(boardName(all[1], all)).toBe('Ana C.');
  });

  it('does not count the player as a clash with themselves', () => {
    const me = p('1', 'Ana Reyes');
    expect(boardName(me, [me])).toBe('Ana');
  });
});

describe('gridFor', () => {
  const land = (n: number) => gridFor(n, true);
  const port = (n: number) => gridFor(n, false);

  it('has nothing to show for no courts', () => {
    expect(land(0)).toMatchObject({ shown: 0, hidden: 0 });
    expect(port(0)).toMatchObject({ shown: 0, hidden: 0 });
    expect(land(0).columns).toBeGreaterThanOrEqual(1);
    expect(land(0).rows).toBeGreaterThanOrEqual(1);
  });

  it.each([
    [1, 1, 1],
    [2, 2, 1],
    [3, 3, 1],
    [4, 2, 2],
    [5, 3, 2],
    [6, 3, 2],
    [7, 3, 2],
    [8, 3, 2],
  ])('landscape %i courts: %i columns by %i rows', (n, columns, rows) => {
    expect(land(n)).toMatchObject({ columns, rows });
  });

  it.each([
    [1, 1, 1],
    [2, 1, 2],
    [3, 1, 3],
    [4, 1, 4],
    [5, 2, 3],
    [6, 2, 3],
    [7, 2, 3],
    [8, 2, 3],
  ])('portrait %i courts: %i columns by %i rows', (n, columns, rows) => {
    expect(port(n)).toMatchObject({ columns, rows });
  });

  it.each([
    [0, 0, 0],
    [1, 1, 0],
    [4, 4, 0],
    [6, 6, 0],
    [7, 6, 1],
    [8, 6, 2],
  ])('%i courts show %i and hide %i in both orientations', (n, shown, hidden) => {
    expect(land(n)).toMatchObject({ shown, hidden });
    expect(port(n)).toMatchObject({ shown, hidden });
  });

  it('has room for every court it shows', () => {
    for (let n = 1; n <= 8; n++) {
      for (const g of [land(n), port(n)]) expect(g.columns * g.rows).toBeGreaterThanOrEqual(g.shown);
    }
  });
});

describe('waitingCapacity', () => {
  // A 100 px strip of 20 px circles with a 5 px gap fits 4: 4 * 20 + 3 * 5 = 95.
  it('shows everyone when they all fit, with no room kept for +N', () => {
    expect(waitingCapacity(100, 20, 5, 4)).toBe(4);
    expect(waitingCapacity(100, 20, 5, 3)).toBe(3);
    expect(waitingCapacity(100, 20, 5, 1)).toBe(1);
  });

  it('keeps one slot for the +N circle when they do not all fit', () => {
    expect(waitingCapacity(100, 20, 5, 5)).toBe(3);
    expect(waitingCapacity(100, 20, 5, 40)).toBe(3);
  });

  it('counts the gap: one more circle fits only when its gap fits too', () => {
    expect(waitingCapacity(95, 20, 5, 4)).toBe(4); // 4 * 20 + 3 * 5 = 95 fits exactly
    expect(waitingCapacity(94, 20, 5, 4)).toBe(2); // only 3 fit, so 4 people need a +N slot
  });

  it('shows at least one person on a very small strip', () => {
    expect(waitingCapacity(10, 20, 5, 6)).toBe(1);
    expect(waitingCapacity(0, 20, 5, 6)).toBe(1);
    expect(waitingCapacity(30, 20, 5, 6)).toBe(1); // 1 fits, the +N slot would leave none
  });

  it('shows no one when no one waits', () => {
    expect(waitingCapacity(100, 20, 5, 0)).toBe(0);
  });

  it('gives 6 slots for a strip of 6 units, the jsdom default', () => {
    expect(waitingCapacity(6, 1, 0, 6)).toBe(6);
    expect(waitingCapacity(6, 1, 0, 7)).toBe(5);
  });
});

describe('nameHue', () => {
  it('is the same each time for the same name', () => {
    expect(nameHue('Ana Reyes')).toBe(nameHue('Ana Reyes'));
  });

  it('is a whole number from 0 to 359', () => {
    for (const name of ['', 'a', 'Ana', 'Ana Reyes', 'Zoë', 'x'.repeat(500), '😀 Ann', 'Ben', 'Cy']) {
      const h = nameHue(name);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it('gives different names different hues, for the pairs we know', () => {
    const pairs = [['Ana', 'Ben'], ['Ana', 'Carlo'], ['Jun', 'Mia'], ['Ben', 'Liza'], ['Eli', 'Fay']];
    for (const [a, b] of pairs) expect(nameHue(a)).not.toBe(nameHue(b));
  });

  it('spreads a set of names over many hues', () => {
    const hues = new Set(['Ana', 'Ben', 'Carlo', 'Dee', 'Eli', 'Fay', 'Gus', 'Hera', 'Ian', 'Jo', 'Kai', 'Lee'].map(nameHue));
    expect(hues.size).toBeGreaterThanOrEqual(10);
  });
});
