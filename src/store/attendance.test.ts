import { describe, expect, it } from 'vitest';
import type { Session } from '../engine';
import { attendanceByRoster, attendanceLine, regularsForWeekday, sortByAttendance } from './attendance';
import type { HistoryEntry } from './historyDb';

const at = (y: number, m: number, d: number) => new Date(y, m, d, 18).getTime();
function entry(id: string, created: number, ids: (string | undefined)[], ended = created + 3_600_000): HistoryEntry {
  const session = {
    id,
    name: id,
    createdAt: created,
    endedAt: ended,
    history: [],
    players: ids.map((r, i) => ({ id: `p${i}`, name: `P${i}`, rosterId: r })),
  } as unknown as Session;
  return { id, name: id, createdAt: created, endedAt: ended, games: 0, session };
}

// 4 Nov 2026 is a Wednesday; 11 Nov is the next one; 5 Nov is a Thursday.
const wed1 = at(2026, 10, 4);
const wed2 = at(2026, 10, 11);
const thu = at(2026, 10, 5);

describe('attendanceByRoster', () => {
  it('counts a player once per session and tracks the latest end', () => {
    const m = attendanceByRoster([entry('a', wed1, ['x', 'x', 'y']), entry('b', wed2, ['x', undefined])]);
    expect(m.get('x')).toEqual({ sessions: 2, lastAt: wed2 + 3_600_000 });
    expect(m.get('y')?.sessions).toBe(1);
    expect(m.size).toBe(2);
  });
  it('is empty with no history', () => expect(attendanceByRoster([]).size).toBe(0));
});

describe('regularsForWeekday', () => {
  const list = [entry('a', wed1, ['x', 'y']), entry('b', wed2, ['x', 'z']), entry('c', thu, ['y', 'y'])];
  it('needs the minimum on that weekday', () => {
    expect(regularsForWeekday(list, 3)).toEqual(['x']);
  });
  it('ignores other weekdays', () => {
    expect(regularsForWeekday(list, 4)).toEqual([]);
    expect(regularsForWeekday(list, 4, 1)).toEqual(['y']);
  });
  it('orders by how often, then id', () => {
    const more = [...list, entry('d', at(2026, 10, 18), ['z', 'x'])];
    expect(regularsForWeekday(more, 3)).toEqual(['x', 'z']);
  });
});

describe('attendanceLine', () => {
  it('says none yet', () => expect(attendanceLine(undefined)).toBe('No sessions yet'));
  it('uses the singular and a short date', () => {
    expect(attendanceLine({ sessions: 1, lastAt: wed1 })).toBe('1 session, last Wed 4 Nov');
    expect(attendanceLine({ sessions: 3, lastAt: wed1 })).toMatch(/^3 sessions, last /);
  });
});

describe('sortByAttendance', () => {
  const players = [
    { id: 'a', name: 'Ann' },
    { id: 'b', name: 'Ben' },
    { id: 'c', name: 'Cy' },
    { id: 'd', name: 'Di' },
  ];
  it('puts frequent first, newer next, then name, and strangers last in given order', () => {
    const att = new Map([
      ['a', { sessions: 1, lastAt: 5 }],
      ['b', { sessions: 3, lastAt: 1 }],
      ['c', { sessions: 1, lastAt: 9 }],
    ]);
    expect(sortByAttendance(players, att).map((p) => p.id)).toEqual(['b', 'c', 'a', 'd']);
  });
  it('does not change the input', () => {
    const copy = [...players];
    sortByAttendance(players, new Map());
    expect(players).toEqual(copy);
  });
});
