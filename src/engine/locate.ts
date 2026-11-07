import { availablePlayers, orderedWaiting, playerById } from './pool';
import type { Court, Player, PlayerId, Session } from './types';

export type Place =
  | { kind: 'waiting' }
  | { kind: 'lineup' | 'game'; courtNumber: number; team: 1 | 2 }
  | { kind: 'off' };

/** Which team of a court holds the player, in its running game or its Ready lineup. */
export function teamOf(court: Court, id: PlayerId): 1 | 2 | null {
  const group = court.game ?? court.lineup;
  if (!group) return null;
  if (group.team1.includes(id)) return 1;
  if (group.team2.includes(id)) return 2;
  return null;
}

/** Where a player is right now: waiting, in a Ready lineup, in a running game, or off (on a break or gone). */
export function locatePlayer(s: Session, id: PlayerId): Place {
  for (const court of s.courts) {
    const team = teamOf(court, id);
    if (team) return { kind: court.status === 'ready' ? 'lineup' : 'game', courtNumber: court.number, team };
  }
  return availablePlayers(s).some((p) => p.id === id) ? { kind: 'waiting' } : { kind: 'off' };
}

export interface OnCourt {
  player: Player;
  courtNumber: number;
  status: 'ready' | 'playing';
  team: 1 | 2;
}

export interface SwapCandidates {
  /** Waiting players, in the order they will be picked. Empty for a player who is waiting themselves. */
  waiting: Player[];
  /** Players on courts they could trade places with, never a partner on the same team. */
  onCourts: OnCourt[];
}

/** Everyone a player could swap with, for the picker. */
export function swapCandidates(s: Session, id: PlayerId): SwapCandidates {
  const me = locatePlayer(s, id);
  const onCourts: OnCourt[] = [];
  for (const court of [...s.courts].sort((a, b) => a.number - b.number)) {
    const group = court.game ?? court.lineup;
    if (!group) continue;
    for (const team of [1, 2] as const) {
      for (const pid of team === 1 ? group.team1 : group.team2) {
        const myTeam = (me.kind === 'lineup' || me.kind === 'game') && me.courtNumber === court.number && me.team === team;
        if (pid === id || myTeam) continue;
        onCourts.push({ player: playerById(s, pid), courtNumber: court.number, status: court.status === 'ready' ? 'ready' : 'playing', team });
      }
    }
  }
  const waiting = me.kind === 'waiting' || me.kind === 'off' ? [] : orderedWaiting(s).filter((p) => p.id !== id);
  return { waiting, onCourts: me.kind === 'off' ? [] : onCourts };
}
