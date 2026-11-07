import { EngineError } from './errors';
import { lineupIds } from './lineup';
import type { Player, PlayerId, Session } from './types';

export function playerById(s: Session, id: PlayerId): Player {
  const p = s.players.find((q) => q.id === id);
  if (!p) throw new EngineError('NOT_FOUND', `Player ${id} not found`);
  return p;
}

export function onCourtIds(s: Session): Set<PlayerId> {
  const ids = new Set<PlayerId>();
  for (const court of s.courts) {
    if (court.game) {
      for (const id of [...court.game.team1, ...court.game.team2]) ids.add(id);
    }
  }
  return ids;
}

/** Players held back in a Ready lineup. They are not waiting and not yet playing. */
export function reservedIds(s: Session): Set<PlayerId> {
  const ids = new Set<PlayerId>();
  for (const court of s.courts) for (const id of lineupIds(court)) ids.add(id);
  return ids;
}

/** Active players who are neither in a running game nor held in a Ready lineup. */
export function availablePlayers(s: Session): Player[] {
  const busy = onCourtIds(s);
  const reserved = reservedIds(s);
  return s.players.filter((p) => p.status === 'active' && !busy.has(p.id) && !reserved.has(p.id));
}

/** Fewest games first, then waited longest, then the stable random tie key. */
export function compareByPriority(a: Player, b: Player): number {
  return (
    a.gamesPlayed - b.gamesPlayed ||
    a.lastFinishedSeq - b.lastFinishedSeq ||
    a.tieKey - b.tieKey
  );
}

/**
 * Available players in the order they will be picked: the ones the organizer asked to play next first, in the order
 * they were asked, then everyone else. Fairness mode orders the rest by priority, queue mode by arrival.
 */
export function orderedWaiting(s: Session): Player[] {
  const pool = availablePlayers(s);
  let rest: Player[];
  if (s.mode === 'fairness') {
    rest = [...pool].sort(compareByPriority);
  } else {
    const byId = new Map(pool.map((p) => [p.id, p]));
    rest = s.queueOrder.flatMap((id) => {
      const p = byId.get(id);
      return p ? [p] : [];
    });
  }
  const asked = s.pinned ?? [];
  if (asked.length === 0) return rest;
  const byId = new Map(rest.map((p) => [p.id, p]));
  const first = asked.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const firstIds = new Set(first.map((p) => p.id));
  return [...first, ...rest.filter((p) => !firstIds.has(p.id))];
}

/** Floor of the average gamesPlayed of active players (optionally excluding one). */
export function lateArrivalGames(s: Session, excludeId?: PlayerId): number {
  const active = s.players.filter((p) => p.status === 'active' && p.id !== excludeId);
  if (active.length === 0) return 0;
  return Math.floor(active.reduce((sum, p) => sum + p.gamesPlayed, 0) / active.length);
}
