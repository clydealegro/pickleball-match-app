import { orderedWaiting } from './pool';
import type { PlayerId, Session } from './types';

export interface UpNext {
  courtNumber: number;
  playerIds: PlayerId[];
}

/**
 * Advisory preview of the next game: the 4 players first in line, and the court
 * most likely to free up first. It is recomputed for real when a court frees up.
 */
export function previewNext(s: Session): UpNext | null {
  const waiting = orderedWaiting(s);
  if (waiting.length < 4) return null;
  const open = s.courts.filter((c) => !c.closing);
  const empty = open.find((c) => c.status === 'empty');
  const soonest = open
    .flatMap((c) =>
      c.status === 'playing' && c.game ? [{ number: c.number, startedAt: c.game.startedAt }] : [],
    )
    .sort((a, b) => a.startedAt - b.startedAt)[0];
  const court = empty ?? soonest;
  if (!court) return null;
  return { courtNumber: court.number, playerIds: waiting.slice(0, 4).map((p) => p.id) };
}
