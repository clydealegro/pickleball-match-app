import { cloneSession } from './clone';
import { EngineError } from './errors';
import { fillCourts } from './fill';
import { playerById } from './pool';
import type { Ctx, PlayerId, Session } from './types';

function bump(counts: Record<PlayerId, number>, id: PlayerId): void {
  counts[id] = (counts[id] ?? 0) + 1;
}

export function finishGame(s: Session, courtId: string, ctx: Ctx): Session {
  const n = cloneSession(s);
  const court = n.courts.find((c) => c.id === courtId);
  if (!court) throw new EngineError('NOT_FOUND', 'Court not found.');
  if (court.status !== 'playing' || !court.game) {
    throw new EngineError('NOT_PLAYING', 'No game is being played on this court.');
  }

  const { team1, team2, startedAt } = court.game;
  const everyone = [...team1, ...team2];
  n.gameSeq += 1;

  for (const id of everyone) {
    const p = playerById(n, id);
    p.gamesPlayed += 1;
    p.lastFinishedSeq = n.gameSeq;
  }
  for (const [a, b] of [team1, team2]) {
    bump(playerById(n, a).partnerCounts, b);
    bump(playerById(n, b).partnerCounts, a);
  }
  for (const a of team1) {
    for (const b of team2) {
      bump(playerById(n, a).opponentCounts, b);
      bump(playerById(n, b).opponentCounts, a);
    }
  }

  n.history.push({ team1, team2, courtNumber: court.number, startedAt, finishedAt: ctx.now });

  // Apply break/leave requests made while the game was running, then re-queue.
  for (const id of everyone) {
    const p = playerById(n, id);
    if (p.pendingStatus) {
      p.status = p.pendingStatus;
      delete p.pendingStatus;
    }
    if (p.status === 'active') n.queueOrder.push(id);
  }

  if (court.closing) {
    n.courts = n.courts.filter((c) => c.id !== court.id);
  } else {
    court.status = 'empty';
    delete court.game;
  }

  fillCourts(n, ctx);
  return n;
}
