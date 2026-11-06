import { mulberry32 } from './rng';
import type { Ctx, Player, Session } from './types';

export function makeCtx(seed = 1, now = 1_000): Ctx {
  let n = 0;
  return { now, rng: mulberry32(seed), newId: () => `id${++n}` };
}

export function mkPlayer(id: string, over: Partial<Player> = {}): Player {
  return {
    id,
    name: id,
    status: 'active',
    gamesPlayed: 0,
    lastFinishedSeq: 0,
    tieKey: 0.5,
    partnerCounts: {},
    opponentCounts: {},
    ...over,
  };
}

/** A hand-built session with no courts, for unit tests of single functions. */
export function mkSession(players: Player[], over: Partial<Session> = {}): Session {
  return {
    id: 's',
    name: 'T',
    mode: 'fairness',
    courts: [],
    players,
    queueOrder: players.filter((p) => p.status === 'active').map((p) => p.id),
    history: [],
    gameSeq: 0,
    createdAt: 0,
    ...over,
  };
}
