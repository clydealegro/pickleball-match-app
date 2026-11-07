import * as engine from '../engine';
import type { Session } from '../engine';

/** What the Undo bar says after two players trade places: who stepped in for whom, on which court. */
export function swapLabel(session: Session, aId: string, bId: string): string {
  const name = (id: string) => session.players.find((p) => p.id === id)?.name ?? 'Player';
  const a = engine.locatePlayer(session, aId);
  const b = engine.locatePlayer(session, bId);
  const onCourt = (p: ReturnType<typeof engine.locatePlayer>) => p.kind === 'lineup' || p.kind === 'game';
  if (onCourt(a) && onCourt(b)) return `${name(aId)} and ${name(bId)} swapped places`;
  const [inId, outId, place] = onCourt(a) ? [bId, aId, a] : [aId, bId, b];
  const court = place.kind === 'lineup' || place.kind === 'game' ? ` on Court ${place.courtNumber}` : '';
  return `${name(inId)} swapped in for ${name(outId)}${court}`;
}
