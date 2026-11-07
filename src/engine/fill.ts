import { unpin } from './pins';
import { orderedWaiting } from './pool';
import { bestSplit } from './selection';
import type { Ctx, Session, Team } from './types';

/**
 * Fills every empty court that can be filled. With auto-start (the default for sessions that do not say otherwise) the
 * game starts at once. Without it the court becomes Ready and waits for the organizer's Start.
 * MUTATES `s` — callers must pass a clone.
 *
 * Both modes take the first 4 of `orderedWaiting`. Fairness mode then picks the
 * best team split; queue mode uses the order as-is (first two vs last two).
 */
export function fillCourts(s: Session, ctx: Ctx): void {
  const courts = [...s.courts].sort((a, b) => a.number - b.number);
  for (const court of courts) {
    if (court.status !== 'empty') continue;
    const four = orderedWaiting(s).slice(0, 4);
    if (four.length < 4) return;
    const ids = four.map((p) => p.id);
    const [team1, team2]: [Team, Team] =
      s.mode === 'queue'
        ? [
            [ids[0], ids[1]],
            [ids[2], ids[3]],
          ]
        : bestSplit(four, ctx.rng);
    if (s.autoStart === false) {
      court.status = 'ready';
      court.lineup = { team1, team2 };
    } else {
      court.status = 'playing';
      court.game = { team1, team2, startedAt: ctx.now };
    }
    s.queueOrder = s.queueOrder.filter((id) => !ids.includes(id));
    unpin(s, ids);
  }
}
