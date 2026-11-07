import { cloneSession } from './clone';
import { EngineError } from './errors';
import { fillCourts } from './fill';
import { lineupIds, releaseLineup } from './lineup';
import { lateArrivalGames, onCourtIds, orderedWaiting, playerById } from './pool';
import type { Ctx, PlayerId, PlayerStatus, Session } from './types';

export type StatusTarget = PlayerStatus;

/**
 * Break / leave: immediate for waiting players and for players in a Ready lineup (the next waiting player takes
 * their place, or the court goes back to empty); for a player in a running game it is recorded as `pendingStatus`
 * and applied when the game ends.
 * Active: returns a player from break (treated like a late arrival) or cancels
 * a pending break/leave. A player who left cannot return.
 */
export function setPlayerStatus(
  s: Session,
  playerId: PlayerId,
  target: StatusTarget,
  ctx: Ctx,
): Session {
  const n = cloneSession(s);
  const p = playerById(n, playerId);

  if (target === 'active') {
    if (p.status === 'left') {
      throw new EngineError('CANNOT_RETURN', `${p.name} has left the session.`);
    }
    if (p.pendingStatus) {
      delete p.pendingStatus;
      return n;
    }
    if (p.status === 'active') return n;
    p.status = 'active';
    p.gamesPlayed = Math.max(p.gamesPlayed, lateArrivalGames(n, p.id));
    p.lastFinishedSeq = n.gameSeq;
    n.queueOrder.push(p.id);
    fillCourts(n, ctx);
    return n;
  }

  if (p.status === 'left' || p.status === target) return n;

  if (onCourtIds(n).has(p.id)) {
    p.pendingStatus = target;
    return n;
  }

  const readyCourt = n.courts.find((c) => c.status === 'ready' && lineupIds(c).includes(p.id));
  if (readyCourt?.lineup) {
    p.status = target;
    const replacement = orderedWaiting(n)[0];
    if (replacement) {
      const swap = (team: [string, string]): [string, string] => [
        team[0] === p.id ? replacement.id : team[0],
        team[1] === p.id ? replacement.id : team[1],
      ];
      readyCourt.lineup = { team1: swap(readyCourt.lineup.team1), team2: swap(readyCourt.lineup.team2) };
      n.queueOrder = n.queueOrder.filter((id) => id !== replacement.id);
    } else {
      releaseLineup(n, readyCourt, p.id);
    }
    return n;
  }

  p.status = target;
  n.queueOrder = n.queueOrder.filter((id) => id !== p.id);
  return n;
}
