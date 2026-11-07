import type { Ctx } from '../engine';
import { newId } from '../lib/id';
import { getRating } from './ratings';

/** Real clock, randomness and ids for use outside tests, plus this device's private ratings. */
export function liveCtx(): Ctx {
  return { now: Date.now(), rng: Math.random, newId, ratingOf: getRating };
}
