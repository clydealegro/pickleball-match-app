import { cloneSession } from './clone';
import { EngineError } from './errors';
import { fillCourts } from './fill';
import { lateArrivalGames } from './pool';
import type { Court, Ctx, NewPlayerInput, NewSessionInput, Player, Session } from './types';

const normalize = (name: string) => name.trim().toLowerCase();

function makeCourt(number: number, ctx: Ctx): Court {
  return { id: ctx.newId(), number, status: 'empty', closing: false };
}

/** MUTATES `s`. Validates, creates the player, and queues them at the back. */
function insertPlayer(s: Session, input: NewPlayerInput, ctx: Ctx): void {
  const name = input.name.trim();
  if (!name) throw new EngineError('EMPTY_NAME', 'Enter a name for the player.');
  if (s.players.some((p) => p.status !== 'left' && normalize(p.name) === normalize(name))) {
    throw new EngineError('DUPLICATE_NAME', `${name} is already in this session.`);
  }
  const player: Player = {
    id: ctx.newId(),
    name,
    rosterId: input.rosterId,
    status: 'active',
    gamesPlayed: lateArrivalGames(s),
    lastFinishedSeq: s.gameSeq,
    tieKey: ctx.rng(),
    partnerCounts: {},
    opponentCounts: {},
  };
  s.players.push(player);
  s.queueOrder.push(player.id);
}

export function createSession(input: NewSessionInput, ctx: Ctx): Session {
  if (!Number.isInteger(input.courtCount) || input.courtCount < 1) {
    throw new EngineError('INVALID_COURTS', 'A session needs at least one court.');
  }
  const s: Session = {
    id: ctx.newId(),
    name: input.name.trim() || 'Pickleball session',
    mode: input.mode,
    courts: Array.from({ length: input.courtCount }, (_, i) => makeCourt(i + 1, ctx)),
    players: [],
    queueOrder: [],
    history: [],
    gameSeq: 0,
    createdAt: ctx.now,
  };
  // Players are inserted first and courts filled once, so a whole group starts together.
  for (const p of input.players) insertPlayer(s, p, ctx);
  fillCourts(s, ctx);
  return s;
}

export function addPlayer(s: Session, input: NewPlayerInput, ctx: Ctx): Session {
  const next = cloneSession(s);
  insertPlayer(next, input, ctx);
  fillCourts(next, ctx);
  return next;
}

export function endSession(s: Session, ctx: Ctx): Session {
  const next = cloneSession(s);
  next.endedAt = ctx.now;
  return next;
}
