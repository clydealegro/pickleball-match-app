import type { Player, Team } from './types';

type Pair = [Player, Player];

function splitCost(t1: Pair, t2: Pair): number {
  const partnerRepeats =
    (t1[0].partnerCounts[t1[1].id] ?? 0) + (t2[0].partnerCounts[t2[1].id] ?? 0);
  let opponentRepeats = 0;
  for (const a of t1) {
    for (const b of t2) opponentRepeats += a.opponentCounts[b.id] ?? 0;
  }
  return partnerRepeats * 10 + opponentRepeats;
}

/**
 * Of the 3 ways to split 4 players into two teams, choose the one with the
 * fewest repeat partners (weight 10) and repeat opponents (weight 1).
 * Exact ties are broken with the injected rng.
 */
export function bestSplit(four: Player[], rng: () => number): [Team, Team] {
  if (four.length !== 4) throw new Error('bestSplit needs exactly 4 players');
  const [a, b, c, d] = four;
  const options: [Pair, Pair][] = [
    [[a, b], [c, d]],
    [[a, c], [b, d]],
    [[a, d], [b, c]],
  ];
  const costs = options.map(([t1, t2]) => splitCost(t1, t2));
  const min = Math.min(...costs);
  const best = options.filter((_, i) => costs[i] === min);
  const [t1, t2] = best[Math.floor(rng() * best.length)];
  return [
    [t1[0].id, t1[1].id],
    [t2[0].id, t2[1].id],
  ];
}
