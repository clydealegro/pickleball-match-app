import type { Ctx } from '../engine';
import { newId } from '../lib/id';

/** Real clock, randomness and ids for use outside tests. */
export function liveCtx(): Ctx {
  return { now: Date.now(), rng: Math.random, newId };
}
