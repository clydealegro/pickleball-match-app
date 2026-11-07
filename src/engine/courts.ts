import { cloneSession } from './clone';
import { EngineError } from './errors';
import { fillCourts } from './fill';
import { releaseLineup } from './lineup';
import type { Ctx, Court, Session } from './types';

export function addCourt(s: Session, ctx: Ctx): Session {
  const n = cloneSession(s);
  const number = Math.max(0, ...n.courts.map((c) => c.number)) + 1;
  const court: Court = { id: ctx.newId(), number, status: 'empty', closing: false };
  n.courts.push(court);
  fillCourts(n, ctx);
  return n;
}

/**
 * Empty or Ready court: removed immediately (a Ready lineup goes back to the front of the waiting list, and may fill
 * another empty court). Court in play: marked `closing` and removed when its game ends. Calling again on a closing
 * court cancels the closing. At least one court must stay open.
 */
export function removeCourt(s: Session, courtId: string, ctx: Ctx): Session {
  const n = cloneSession(s);
  const court = n.courts.find((c) => c.id === courtId);
  if (!court) throw new EngineError('NOT_FOUND', 'Court not found.');
  if (court.closing) {
    court.closing = false;
    return n;
  }
  if (n.courts.filter((c) => !c.closing).length <= 1) {
    throw new EngineError('LAST_COURT', 'At least one court must stay open.');
  }
  if (court.status === 'ready') {
    releaseLineup(n, court);
    n.courts = n.courts.filter((c) => c.id !== court.id);
    fillCourts(n, ctx);
  } else if (court.status === 'empty') {
    n.courts = n.courts.filter((c) => c.id !== court.id);
  } else {
    court.closing = true;
  }
  return n;
}
