import { cloneSession } from './clone';
import { EngineError } from './errors';
import { availablePlayers, playerById } from './pool';
import type { PlayerId, Session } from './types';

/** Takes players off the "play next" list. MUTATES `s`: callers must pass a clone. */
export function unpin(s: Session, ids: PlayerId[]): void {
  if (!s.pinned) return;
  const rest = s.pinned.filter((id) => !ids.includes(id));
  if (rest.length > 0) s.pinned = rest;
  else delete s.pinned;
}

function requireWaiting(s: Session, playerId: PlayerId): void {
  const p = playerById(s, playerId);
  if (!availablePlayers(s).some((q) => q.id === playerId)) {
    throw new EngineError('NOT_WAITING', `${p.name} is not waiting, so this does not apply.`);
  }
}

/**
 * Puts a waiting player at the front of the line, behind anyone already asked to play next. It lasts until they are
 * placed on a court, go on a break or leave. It works in both modes, and does not change anyone's games.
 */
export function playNext(s: Session, playerId: PlayerId): Session {
  const n = cloneSession(s);
  requireWaiting(n, playerId);
  if (n.pinned?.includes(playerId)) return n;
  n.pinned = [...(n.pinned ?? []), playerId];
  return n;
}

/**
 * Passes a waiting player over for this turn: they go to the back of the line. In fairness mode that only reorders
 * players with the same number of games, because fewest games always comes first, so nobody can be cheated out of a
 * game. Takes them off the "play next" list too.
 */
export function skipTurn(s: Session, playerId: PlayerId): Session {
  const n = cloneSession(s);
  requireWaiting(n, playerId);
  const me = playerById(n, playerId);
  unpin(n, [playerId]);

  const others = availablePlayers(n).filter((p) => p.id !== playerId && p.gamesPlayed === me.gamesPlayed);
  // As if they had just finished a game: nobody can have finished later, so they are last among the same games, and
  // last among an exact tie too.
  me.lastFinishedSeq = n.gameSeq;
  const tied = others.filter((p) => p.lastFinishedSeq === me.lastFinishedSeq);
  if (tied.length > 0) me.tieKey = Math.max(me.tieKey, ...tied.map((p) => p.tieKey)) + 0.001;

  n.queueOrder = [...n.queueOrder.filter((id) => id !== playerId), playerId];
  return n;
}
