import { cloneSession } from './clone';
import { EngineError } from './errors';
import { fillCourts } from './fill';
import { lateArrivalGames, onCourtIds, playerById } from './pool';
import type { Ctx, PlayerId, PlayerStatus, Session } from './types';

export type StatusTarget = PlayerStatus;

/**
 * Break / leave: immediate for waiting players; for a player on court it is
 * recorded as `pendingStatus` and applied when their game ends.
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

  p.status = target;
  n.queueOrder = n.queueOrder.filter((id) => id !== p.id);
  return n;
}
