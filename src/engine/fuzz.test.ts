import { describe, expect, it } from 'vitest';
import { addCourt, removeCourt } from './courts';
import { EngineError } from './errors';
import { finishGame } from './game';
import { assertInvariants } from './invariants';
import { playNext, skipTurn } from './pins';
import { mulberry32 } from './rng';
import { addPlayer } from './session';
import { startAllReady, startCourt } from './start';
import { setPlayerStatus } from './status';
import { notHere, swapPlayers } from './swap';
import { makeCtx, newTestSession } from './testing';
import type { Mode, PlayerStatus, Session } from './types';

const TOLERATED = new Set(['CANNOT_RETURN', 'LAST_COURT', 'NOT_PLAYING', 'NOT_READY', 'NOT_WAITING', 'INVALID_SWAP', 'NO_REPLACEMENT']);
const TARGETS: PlayerStatus[] = ['active', 'break', 'left'];
const STEPS = 250;

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

// Games start by themselves (a session that does not say, as before) or wait for the organizer's Start.
describe.each<[Mode, boolean | undefined]>([
  ['fairness', undefined],
  ['queue', undefined],
  ['fairness', false],
  ['queue', false],
])('operation fuzzing (%s mode, autoStart %s)', (mode, autoStart) => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`keeps every invariant over ${STEPS} random operations (seed ${seed})`, () => {
      const rng = mulberry32(seed);
      const base = makeCtx(seed, 0);
      const names = Array.from({ length: 9 }, (_, i) => `P${i + 1}`);
      let s: Session = newTestSession(names, { courts: 2, mode, autoStart }, base);
      assertInvariants(s);
      let nextName = names.length + 1;
      let applied = 0;

      for (let step = 1; step <= STEPS; step++) {
        const ctx = { ...base, now: step * 60_000 };
        const kind = Math.floor(rng() * 10);
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
            case 4:
              s = removeCourt(s, pick(s.courts, rng).id, ctx);
              break;
            case 5: {
              const ready = s.courts.filter((c) => c.status === 'ready');
              if (ready.length === 0) continue;
              s = rng() < 0.5 ? startCourt(s, pick(ready, rng).id, ctx) : startAllReady(s, ctx);
              break;
            }
            case 6:
              s = playNext(s, pick(s.players, rng).id);
              break;
            case 7:
              s = skipTurn(s, pick(s.players, rng).id);
              break;
            case 8:
              s = swapPlayers(s, pick(s.players, rng).id, pick(s.players, rng).id);
              break;
            default:
              s = notHere(s, pick(s.players, rng).id, ctx);
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
