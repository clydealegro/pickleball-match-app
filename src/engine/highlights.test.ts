import { describe, expect, it } from 'vitest';
import { highlights, summaryLine } from './highlights';
import { mkPlayer, mkSession } from './fixtures';
import type { FinishedGame, Player, Session } from './types';

const MIN = 60_000;

function game(team1: [string, string], team2: [string, string], minutes: number, at = 0, winner?: 1 | 2): FinishedGame {
  return { team1, team2, courtNumber: 1, startedAt: at, finishedAt: at + minutes * MIN, ...(winner ? { winner } : {}) };
}

/** Six players, four games. Ann has 4 games, Ben 3, the rest 2 or 1. Ann has met the most partners. */
function sixPlayers(): Session {
  const p = (id: string, gamesPlayed: number, partners: string[]): Player =>
    mkPlayer(id, { name: id, gamesPlayed, partnerCounts: Object.fromEntries(partners.map((x) => [x, 1])) });
  return mkSession(
    [p('Ann', 4, ['Ben', 'Cy', 'Dee']), p('Ben', 3, ['Ann', 'Cy']), p('Cy', 3, ['Ann', 'Ben']), p('Dee', 2, ['Ann']), p('Eve', 1, ['Fay']), p('Fay', 1, ['Eve'])],
    {
      history: [
        game(['Ann', 'Ben'], ['Cy', 'Dee'], 10),
        game(['Ann', 'Cy'], ['Ben', 'Dee'], 25, 10 * MIN),
        game(['Ann', 'Dee'], ['Ben', 'Cy'], 15, 35 * MIN),
        game(['Ann', 'Ben'], ['Eve', 'Fay'], 12, 50 * MIN),
      ],
    },
  );
}

describe('highlights', () => {
  it('names who played most, the longest game and who met the most partners, in that order', () => {
    const lines = highlights(sixPlayers());
    expect(lines.map((l) => l.text)).toEqual([
      'Most games: Ann, 4',
      'Longest game: 25m',
      'Most partners: Ann, 3 different',
    ]);
  });

  it('shows nothing for fewer than three games', () => {
    const s = sixPlayers();
    expect(highlights({ ...s, history: s.history.slice(0, 2) })).toEqual([]);
    expect(highlights({ ...s, history: s.history.slice(0, 3) })).not.toEqual([]);
  });

  it('names ties together', () => {
    const s = sixPlayers();
    const tied = { ...s, players: s.players.map((p) => (p.id === 'Ben' ? { ...p, gamesPlayed: 4 } : p)) };
    expect(highlights(tied)[0].text).toBe('Most games: Ann and Ben, 4');
    const three = { ...s, players: s.players.map((p) => (['Ben', 'Cy'].includes(p.id) ? { ...p, gamesPlayed: 4 } : p)) };
    expect(highlights(three)[0].text).toBe('Most games: Ann, Ben and Cy, 4');
    const many = { ...s, players: s.players.map((p) => (p.id === 'Fay' ? p : { ...p, gamesPlayed: 4 })) };
    expect(highlights(many)[0].text).toBe('Most games: 5 players, 4');
  });

  it('drops a line that would name everyone', () => {
    const s = sixPlayers();
    const even = { ...s, players: s.players.map((p) => ({ ...p, gamesPlayed: 3 })) };
    expect(highlights(even).map((l) => l.key)).not.toContain('mostGames');
  });

  it('adds the shortest game once the longest and the partners leave room, and only when it differs', () => {
    const s = sixPlayers();
    const noPartners = { ...s, players: s.players.map((p) => ({ ...p, partnerCounts: {} })) };
    expect(highlights(noPartners).map((l) => l.text)).toEqual(['Most games: Ann, 4', 'Longest game: 25m', 'Shortest game: 10m']);
    const samelength = { ...noPartners, history: noPartners.history.map((g) => ({ ...g, finishedAt: g.startedAt + 10 * MIN })) };
    expect(highlights(samelength).map((l) => l.key)).toEqual(['mostGames']);
  });

  it('never lists more than three lines', () => {
    const s = sixPlayers();
    const withResults = { ...s, history: s.history.map((g) => ({ ...g, winner: 1 as const })) };
    expect(highlights(withResults, { results: true }).length).toBeLessThanOrEqual(3);
  });

  describe('unbeaten', () => {
    function withWinners(winners: (1 | 2)[]): Session {
      const s = sixPlayers();
      const teams: [[string, string], [string, string]][] = [
        [['Ann', 'Ben'], ['Cy', 'Dee']],
        [['Ann', 'Ben'], ['Cy', 'Dee']],
        [['Ann', 'Cy'], ['Ben', 'Dee']],
        [['Eve', 'Fay'], ['Cy', 'Dee']],
      ];
      return { ...s, history: teams.map(([a, b], i) => game(a, b, 10 + i, i * 20 * MIN, winners[i])) };
    }

    it('comes first when results are on, and names players with two or more wins and no loss', () => {
      // Ben wins games 1 and 2 with Ann, then wins game 3 on the other side: 3 wins, no loss. Ann lost game 3.
      const s = withWinners([1, 1, 2, 1]);
      expect(highlights(s, { results: true })[0]).toEqual({ key: 'unbeaten', text: 'Unbeaten: Ben' });
    });

    it('names a tie together', () => {
      const s = sixPlayers();
      const together = { ...s, history: [0, 1, 2].map((i) => game(['Ann', 'Ben'], ['Cy', 'Dee'], 10 + i, i * 20 * MIN, 1)) };
      expect(highlights(together, { results: true })[0].text).toBe('Unbeaten: Ann and Ben');
    });

    it('needs two wins, so one lucky game is not a highlight', () => {
      const s = withWinners([1, 2, 2, 1]);
      expect(highlights(s, { results: true }).map((l) => l.key)).not.toContain('unbeaten');
    });

    it('stays out when results are off, which is the default', () => {
      const s = withWinners([1, 1, 2, 1]);
      expect(highlights(s).map((l) => l.key)).not.toContain('unbeaten');
      expect(highlights(s, { results: false }).map((l) => l.key)).not.toContain('unbeaten');
    });
  });
});

describe('summaryLine', () => {
  function played(games: number, minutes: number, minGames: number): Session {
    const s = sixPlayers();
    return {
      ...s,
      history: Array.from({ length: games }, (_, i) => game(['Ann', 'Ben'], ['Cy', 'Dee'], minutes, i * minutes * MIN)),
      players: s.players.map((p) => ({ ...p, gamesPlayed: minGames })),
    };
  }

  it('says the games, the time in plain words and the fewest games anyone got', () => {
    expect(summaryLine(played(12, 15, 3))).toBe('12 games, 3 hours, everyone got at least 3');
  });

  it('uses half hours, minutes and the singular', () => {
    expect(summaryLine(played(6, 15, 2))).toBe('6 games, 1.5 hours, everyone got at least 2');
    expect(summaryLine(played(4, 10, 2))).toBe('4 games, 40 minutes, everyone got at least 2');
    expect(summaryLine(played(4, 15, 2))).toBe('4 games, 1 hour, everyone got at least 2');
    expect(summaryLine(played(1, 10, 1))).toBe('1 game, 10 minutes, everyone got at least 1');
  });

  it('leaves out the last part when someone did not play', () => {
    expect(summaryLine(played(3, 10, 0))).toBe('3 games, 30 minutes');
  });

  it('is empty with no games', () => {
    expect(summaryLine(played(0, 10, 0))).toBe('');
  });
});
