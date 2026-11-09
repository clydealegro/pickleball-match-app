import { describe, expect, it } from 'vitest';
import { mkPlayer, mkSession } from '../engine/fixtures';
import type { FinishedGame, Session } from '../engine/types';
import type { HistoryEntry } from './historyDb';
import { lastWeekStats } from './lastWeekStats';

const MIN = 60_000;
// Saturday 14 Nov 2026, noon. The Tuesday before is 10 Nov, and the one before that is 3 Nov.
const NOW = new Date(2026, 10, 14, 12);
const TUE_3 = new Date(2026, 10, 3, 18).getTime();
const TUE_10 = new Date(2026, 10, 10, 18).getTime();

const game = (team1: [string, string], team2: [string, string], at: number, winner?: 1 | 2): FinishedGame => ({
  team1,
  team2,
  courtNumber: 1,
  startedAt: at,
  finishedAt: at + 10 * MIN,
  ...(winner ? { winner } : {}),
});

/** Ann plays 4, Ben 3, Cy 3, Dee 2. Ann and Ben win 3 each; Cy and Dee lose 3 each. */
function session(createdAt: number, withResults: boolean): Session {
  const w = (x: 1 | 2) => (withResults ? x : undefined);
  return mkSession(
    [
      mkPlayer('Ann', { name: 'Ann', gamesPlayed: 4 }),
      mkPlayer('Ben', { name: 'Ben', gamesPlayed: 3 }),
      mkPlayer('Cy', { name: 'Cy', gamesPlayed: 3 }),
      mkPlayer('Dee', { name: 'Dee', gamesPlayed: 2 }),
    ],
    {
      createdAt,
      history: [
        game(['Ann', 'Ben'], ['Cy', 'Dee'], 0, w(1)),
        game(['Ann', 'Cy'], ['Ben', 'Dee'], 1, w(1)),
        game(['Ann', 'Ben'], ['Cy', 'Dee'], 2, w(1)),
        game(['Ann', 'Cy'], ['Ben', 'Dee'], 3, w(2)),
      ],
    },
  );
}

const entry = (createdAt: number, withResults = true): HistoryEntry => ({
  id: `e${createdAt}`,
  name: 'Open play',
  createdAt,
  endedAt: createdAt + 3_600_000,
  games: 4,
  session: session(createdAt, withResults),
});

describe('lastWeekStats', () => {
  it('names who played, won and lost most in the latest earlier session on that weekday', () => {
    const got = lastWeekStats([entry(TUE_10)], 2, NOW);
    expect(got?.at).toBe(TUE_10);
    expect(got?.games).toBe(4);
    expect(got?.stats.map((s) => [s.key, s.name, s.value])).toEqual([
      ['played', 'Ann', 4],
      ['wins', 'Ann +1', 3],
      ['losses', 'Cy +1', 3],
    ]);
  });

  it('uses the most recent matching session, not an older one', () => {
    expect(lastWeekStats([entry(TUE_3), entry(TUE_10)], 2, NOW)?.at).toBe(TUE_10);
  });

  it('ignores other weekdays and today', () => {
    expect(lastWeekStats([entry(TUE_10)], 4, NOW)).toBeUndefined();
    const today = new Date(2026, 10, 14, 9).getTime();
    expect(lastWeekStats([{ ...entry(today), session: { ...session(today, true), weekday: 6 } }], 6, NOW)).toBeUndefined();
  });

  it('leaves wins and losses out when no result was recorded', () => {
    expect(lastWeekStats([entry(TUE_10, false)], 2, NOW)?.stats.map((s) => s.key)).toEqual(['played']);
  });

  it('says nothing for fewer than three games', () => {
    const e = entry(TUE_10);
    expect(lastWeekStats([{ ...e, session: { ...e.session, history: e.session.history.slice(0, 2) } }], 2, NOW)).toBeUndefined();
  });

  it('is undefined with no history', () => {
    expect(lastWeekStats([], 2, NOW)).toBeUndefined();
  });

  it('writes a tie as the first name and a count', () => {
    const e = entry(TUE_10);
    const tied = { ...e, session: { ...e.session, players: e.session.players.map((p) => (p.id === 'Ben' ? { ...p, gamesPlayed: 4 } : p)) } };
    expect(lastWeekStats([tied], 2, NOW)?.stats[0]).toEqual({ key: 'played', value: 4, name: 'Ann +1' });
  });

  it('drops a stat that everyone shares', () => {
    const e = entry(TUE_10);
    const even = { ...e, session: { ...e.session, players: e.session.players.map((p) => ({ ...p, gamesPlayed: 3 })) } };
    expect(lastWeekStats([even], 2, NOW)?.stats.map((s) => s.key)).toEqual(['wins', 'losses']);
  });
});
