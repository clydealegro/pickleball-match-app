import { cloneSession } from './clone';
import { EngineError } from './errors';
import type { Court, Ctx, Session } from './types';

/** MUTATES `s`. Turns a Ready court into a running game and starts its clock. */
function begin(court: Court, ctx: Ctx): void {
  if (court.status !== 'ready' || !court.lineup) {
    throw new EngineError('NOT_READY', 'This court has no game ready to start.');
  }
  court.game = { team1: court.lineup.team1, team2: court.lineup.team2, startedAt: ctx.now };
  court.status = 'playing';
  delete court.lineup;
}

export function startCourt(s: Session, courtId: string, ctx: Ctx): Session {
  const n = cloneSession(s);
  const court = n.courts.find((c) => c.id === courtId);
  if (!court) throw new EngineError('NOT_FOUND', 'Court not found.');
  begin(court, ctx);
  return n;
}

export function startAllReady(s: Session, ctx: Ctx): Session {
  const n = cloneSession(s);
  const ready = n.courts.filter((c) => c.status === 'ready').sort((a, b) => a.number - b.number);
  if (ready.length === 0) throw new EngineError('NOT_READY', 'No court has a game ready to start.');
  for (const court of ready) begin(court, ctx);
  return n;
}
