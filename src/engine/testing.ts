import { expect } from 'vitest';
import { EngineError, type EngineErrorCode } from './errors';
import { mulberry32 } from './rng';
import { createSession } from './session';
import type { Ctx, Mode, Player, Session } from './types';

export function makeCtx(seed = 1, now = 1_000): Ctx {
  let n = 0;
  return { now, rng: mulberry32(seed), newId: () => `id${++n}` };
}

export function newTestSession(
  names: string[],
  opts: { courts?: number; mode?: Mode } = {},
  ctx: Ctx = makeCtx(),
): Session {
  return createSession(
    {
      name: 'Test',
      mode: opts.mode ?? 'fairness',
      courtCount: opts.courts ?? 1,
      players: names.map((name) => ({ name })),
    },
    ctx,
  );
}

export function idOf(s: Session, name: string): string {
  const p = s.players.find((q) => q.name === name);
  if (!p) throw new Error(`no player named ${name}`);
  return p.id;
}

export function nameOf(s: Session, id: string): string {
  const p = s.players.find((q) => q.id === id);
  if (!p) throw new Error(`no player with id ${id}`);
  return p.name;
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

export function expectEngineError(fn: () => unknown, code: EngineErrorCode): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    expect((e as EngineError).code).toBe(code);
    return;
  }
  throw new Error(`expected EngineError ${code} but nothing was thrown`);
}
