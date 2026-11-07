import * as engine from '../engine';
import type { Session } from '../engine';

const join = (names: string[]) => names.join(' and ');

/** What changed on a court after a game finished, written to be read out: the new lineup, or why there is none. */
export function finishMessage(after: Session, courtNumber: number): string {
  const court = after.courts.find((c) => c.number === courtNumber);
  if (!court) return `Court ${courtNumber} closed.`;
  const names = (ids: string[]) => ids.map((id) => after.players.find((p) => p.id === id)?.name ?? 'Unknown');
  if (court.game) {
    return `Court ${courtNumber}: ${join(names(court.game.team1))} vs ${join(names(court.game.team2))}`;
  }
  const missing = Math.max(0, 4 - engine.orderedWaiting(after).length);
  return missing > 0
    ? `Court ${courtNumber} finished. Waiting for ${missing} more ${missing === 1 ? 'player' : 'players'}.`
    : `Court ${courtNumber} finished.`;
}
