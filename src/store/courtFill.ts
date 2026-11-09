/** Four players make a doubles game, so a court is four. */
export const PLAYERS_PER_COURT = 4;
const MIN_GROUPS = 2;
const MAX_GROUPS = 4;

export interface CourtFill {
  /** One entry per court shown: how many of its four places are taken. */
  groups: number[];
  /** What the count means: how many more make a game, or how many courts are full. */
  caption: string;
}

/** The court bar and its caption for this many players saying yes. */
export function courtFill(playing: number): CourtFill {
  const n = Math.max(0, Math.floor(playing));
  const shown = Math.min(MAX_GROUPS, Math.max(MIN_GROUPS, Math.ceil(n / PLAYERS_PER_COURT)));
  const groups = Array.from({ length: shown }, (_, i) => Math.min(PLAYERS_PER_COURT, Math.max(0, n - i * PLAYERS_PER_COURT)));
  if (n === 0) return { groups, caption: `${PLAYERS_PER_COURT} players make a game` };
  if (n < PLAYERS_PER_COURT) return { groups, caption: `${PLAYERS_PER_COURT - n} more makes a game` };
  const courts = Math.floor(n / PLAYERS_PER_COURT);
  const waiting = n % PLAYERS_PER_COURT;
  return { groups, caption: `${courts} ${courts === 1 ? 'court' : 'courts'} full${waiting > 0 ? `, ${waiting} waiting` : ''}` };
}
