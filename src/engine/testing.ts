import { expect } from 'vitest';
import { EngineError, type EngineErrorCode } from './errors';
import { makeCtx } from './fixtures';
import { createSession } from './session';
import type { Ctx, Mode, Session } from './types';

export { makeCtx, mkPlayer, mkSession } from './fixtures';

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
