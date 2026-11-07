import { expect } from 'vitest';
import { lineupIds } from './lineup';
import { availablePlayers, onCourtIds } from './pool';
import type { Session } from './types';

/** Test helper: asserts the structural invariants every engine operation must preserve. */
export function assertInvariants(s: Session): void {
  // queueOrder is exactly the set of available players, with no duplicates.
  const waiting = availablePlayers(s)
    .map((p) => p.id)
    .sort();
  expect([...s.queueOrder].sort()).toEqual(waiting);

  // Nobody is on two courts or twice in one game.
  const gameIds = s.courts.flatMap((c) => (c.game ? [...c.game.team1, ...c.game.team2] : []));
  expect(new Set(gameIds).size).toBe(gameIds.length);
  expect(onCourtIds(s).size).toBe(gameIds.length);

  // A Ready court holds four players and no game; a playing court holds a game and no lineup.
  const lineupPlayers = s.courts.flatMap((c) => lineupIds(c));
  for (const c of s.courts) {
    if (c.status === 'ready') {
      expect(c.game).toBeUndefined();
      expect(lineupIds(c)).toHaveLength(4);
    } else {
      expect(c.lineup).toBeUndefined();
    }
  }

  // Every player appears at most once across the queue, the running games and the Ready lineups.
  const everywhere = [...s.queueOrder, ...gameIds, ...lineupPlayers];
  expect(new Set(everywhere).size).toBe(everywhere.length);

  // Players on break or who left are neither waiting, playing nor held in a lineup.
  for (const p of s.players) {
    if (p.status === 'break' || p.status === 'left') {
      expect(s.queueOrder).not.toContain(p.id);
      expect(gameIds).not.toContain(p.id);
      expect(lineupPlayers).not.toContain(p.id);
    }
  }

  // Everyone asked to play next is waiting, once, and the list is dropped when it is empty.
  const asked = s.pinned ?? [];
  expect(new Set(asked).size).toBe(asked.length);
  for (const id of asked) expect(waiting).toContain(id);
  if (s.pinned) expect(s.pinned.length).toBeGreaterThan(0);

  // Court numbers are unique, and a closing court is always mid-game.
  const numbers = s.courts.map((c) => c.number);
  expect(new Set(numbers).size).toBe(numbers.length);
  for (const c of s.courts) {
    if (c.closing) expect(c.status).toBe('playing');
  }

  // Idle courts only exist when fewer than 4 are waiting.
  if (s.courts.some((c) => c.status === 'empty')) expect(waiting.length).toBeLessThan(4);
}
