import { cloneSession } from './clone';
import { EngineError } from './errors';
import { fillCourts } from './fill';
import { playerById } from './pool';
import type { Ctx, GameResult, PlayerId, Session } from './types';

function bump(counts: Record<PlayerId, number>, id: PlayerId): void {
  counts[id] = (counts[id] ?? 0) + 1;
}

/** A recorded result must name a team, and a score must be whole numbers with the winner ahead. */
function checkResult(result: GameResult): void {
  if (result.winner !== 1 && result.winner !== 2) {
    throw new EngineError('INVALID_RESULT', 'Choose which team won.');
  }
  if (!result.score) return;
  const [a, b] = result.score;
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
    throw new EngineError('INVALID_RESULT', 'A score is a whole number, from 0 up.');
  }
  const winning = result.winner === 1 ? a : b;
  const losing = result.winner === 1 ? b : a;
  if (winning <= losing) {
    throw new EngineError('INVALID_RESULT', 'The winning score must be higher than the losing score.');
  }
}

/** Finishes the game on a court. With a `result`, the winner (and score) are recorded; without one nothing is. */
export function finishGame(s: Session, courtId: string, ctx: Ctx, result?: GameResult): Session {
  if (result) checkResult(result);
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

  n.history.push({
    team1,
    team2,
    courtNumber: court.number,
    startedAt,
    finishedAt: ctx.now,
    ...(result ? { winner: result.winner } : {}),
    ...(result?.score ? { score: [result.score[0], result.score[1]] as [number, number] } : {}),
  });

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
