import { describe, expect, it } from 'vitest';
import { addCourt, removeCourt } from './courts';
import { EngineError } from './errors';
import { finishGame } from './game';
import { assertInvariants } from './invariants';
import { mulberry32 } from './rng';
import { addPlayer } from './session';
import { setPlayerStatus } from './status';
import { makeCtx, newTestSession } from './testing';
import type { Mode, PlayerStatus, Session } from './types';

const TOLERATED = new Set(['CANNOT_RETURN', 'LAST_COURT', 'NOT_PLAYING']);
const TARGETS: PlayerStatus[] = ['active', 'break', 'left'];
const STEPS = 250;

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

describe.each<Mode>(['fairness', 'queue'])('operation fuzzing (%s mode)', (mode) => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`keeps every invariant over ${STEPS} random operations (seed ${seed})`, () => {
      const rng = mulberry32(seed);
      const base = makeCtx(seed, 0);
      const names = Array.from({ length: 9 }, (_, i) => `P${i + 1}`);
      let s: Session = newTestSession(names, { courts: 2, mode }, base);
      assertInvariants(s);
      let nextName = names.length + 1;
      let applied = 0;

      for (let step = 1; step <= STEPS; step++) {
        const ctx = { ...base, now: step * 60_000 };
        const kind = Math.floor(rng() * 5);
        try {
          switch (kind) {
            case 0: {
              const playing = s.courts.filter((c) => c.status === 'playing');
              if (playing.length === 0) continue;
              s = finishGame(s, pick(playing, rng).id, ctx);
              break;
            }
            case 1:
              s = addPlayer(s, { name: `P${nextName++}` }, ctx);
              break;
            case 2:
              s = setPlayerStatus(s, pick(s.players, rng).id, pick(TARGETS, rng), ctx);
              break;
            case 3:
              if (s.courts.length >= 5) continue;
              s = addCourt(s, ctx);
              break;
            default:
              s = removeCourt(s, pick(s.courts, rng).id);
          }
        } catch (e) {
          if (e instanceof EngineError && TOLERATED.has(e.code)) continue;
          throw e;
        }
        applied++;
        assertInvariants(s);
      }

      expect(applied).toBeGreaterThan(0);
    });
  }
});
