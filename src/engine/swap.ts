import { cloneSession } from './clone';
import { EngineError } from './errors';
import { unpin } from './pins';
import { availablePlayers, orderedWaiting, playerById } from './pool';
import { setPlayerStatus } from './status';
import type { Court, Ctx, PlayerId, Session, Team } from './types';

interface Slot {
  court: Court;
  group: 'game' | 'lineup';
  team: 'team1' | 'team2';
  index: 0 | 1;
}

function slotOf(s: Session, id: PlayerId): Slot | null {
  for (const court of s.courts) {
    const group = court.game ? 'game' : court.lineup ? 'lineup' : null;
    if (!group) continue;
    const teams = court[group]!;
    for (const team of ['team1', 'team2'] as const) {
      const index = teams[team].indexOf(id);
      if (index >= 0) return { court, group, team, index: index as 0 | 1 };
    }
  }
  return null;
}

/** MUTATES the session the slot belongs to: puts `id` in the slot. */
function place(slot: Slot, id: PlayerId): void {
  const team: Team = [...slot.court[slot.group]![slot.team]];
  team[slot.index] = id;
  slot.court[slot.group]![slot.team] = team;
}

/**
 * Trades the places of two players. One may be waiting: they take the other's place on a court (in a Ready lineup or a
 * running game), and the one taken off goes back to waiting, at the front of the queue in queue mode. Or both may be on
 * courts, in the same game on different teams or in different games, and trade places. The game in progress is
 * untouched, and a game credits whoever is on court when it finishes: a substitute is credited, the player taken off is
 * not. Nobody's own games or counts change.
 */
export function swapPlayers(s: Session, aId: PlayerId, bId: PlayerId): Session {
  const n = cloneSession(s);
  const a = playerById(n, aId);
  const b = playerById(n, bId);
  if (aId === bId) throw new EngineError('INVALID_SWAP', 'Choose two different players.');
  for (const p of [a, b]) {
    if (p.status !== 'active') throw new EngineError('INVALID_SWAP', `${p.name} is not available to swap.`);
  }
  const slotA = slotOf(n, aId);
  const slotB = slotOf(n, bId);

  if (slotA && slotB) {
    if (slotA.court === slotB.court && slotA.group === slotB.group && slotA.team === slotB.team) {
      throw new EngineError('INVALID_SWAP', `${a.name} and ${b.name} are already on the same team.`);
    }
    place(slotA, bId);
    place(slotB, aId);
    return n;
  }

  if (!slotA && !slotB) {
    throw new EngineError('INVALID_SWAP', 'Swap needs at least one player on a court.');
  }

  // One on a court, one waiting.
  const [outId, inId, slot] = slotA ? [aId, bId, slotA] : [bId, aId, slotB!];
  const waiting = availablePlayers(n).some((p) => p.id === inId);
  if (!waiting) throw new EngineError('INVALID_SWAP', `${playerById(n, inId).name} is not waiting.`);
  place(slot, inId);
  unpin(n, [inId]);
  const out = playerById(n, outId);
  n.queueOrder = n.queueOrder.filter((id) => id !== inId);
  if (out.pendingStatus) {
    // They asked to go on a break or leave when the game ended: taken off the court, that is now.
    out.status = out.pendingStatus;
    delete out.pendingStatus;
  } else {
    n.queueOrder = [outId, ...n.queueOrder];
  }
  return n;
}

/**
 * A player on a court did not turn up, or cannot play: the next waiting player takes their place and they go on a
 * break, as one step. Refused when nobody is waiting.
 */
export function notHere(s: Session, playerId: PlayerId, ctx: Ctx): Session {
  const player = playerById(s, playerId);
  if (!slotOf(s, playerId)) {
    throw new EngineError('INVALID_SWAP', `${player.name} is not on a court.`);
  }
  const next = orderedWaiting(s)[0];
  if (!next) throw new EngineError('NO_REPLACEMENT', 'No one is waiting to take their place.');
  return setPlayerStatus(swapPlayers(s, playerId, next.id), playerId, 'break', ctx);
}
