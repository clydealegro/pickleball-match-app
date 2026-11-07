import type { Court, PlayerId, Session } from './types';

/** The four players in a Ready lineup, team 1 first. Empty when the court has none. */
export function lineupIds(court: Court): PlayerId[] {
  return court.lineup ? [...court.lineup.team1, ...court.lineup.team2] : [];
}

/**
 * Empties a Ready court and puts its players back at the front of the queue, in lineup order. `leaving` is a player who
 * is going on a break or leaving, so they are not queued.
 * MUTATES `s`: callers must pass a clone.
 */
export function releaseLineup(s: Session, court: Court, leaving?: PlayerId): void {
  const ids = lineupIds(court).filter((id) => id !== leaving);
  court.status = 'empty';
  delete court.lineup;
  s.queueOrder = [...ids, ...s.queueOrder.filter((id) => !ids.includes(id))];
}
