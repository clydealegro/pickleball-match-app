import { hasResults, summarize } from '../engine/summary';
import { MIN_GAMES_FOR_HIGHLIGHTS } from '../engine/highlights';
import type { HistoryEntry } from './historyDb';
import { sessionWeekday } from './homeInfo';

export interface LastWeekStat {
  key: 'played' | 'wins' | 'losses';
  /** The number: games, wins or losses. */
  value: number;
  /** Who has it. Ties read "Ana +1". */
  name: string;
}

export interface LastWeekStats {
  /** When that session started, in ms. */
  at: number;
  games: number;
  stats: LastWeekStat[];
}

const startOfDay = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

/**
 * Who stood out in the latest earlier session on this weekday: most games, most wins, most losses.
 * Wins and losses only count when a result was recorded. A stat that everyone shares is left out, because then
 * nobody stands out. Undefined when there is no earlier session, or it was too short to say anything.
 */
export function lastWeekStats(entries: HistoryEntry[], weekday: number, now: Date): LastWeekStats | undefined {
  const today = startOfDay(now);
  const last = entries
    .filter((e) => sessionWeekday(e.session) === weekday && e.createdAt < today)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!last || last.session.history.length < MIN_GAMES_FOR_HIGHLIGHTS) return undefined;
  const rows = summarize(last.session).filter((r) => r.gamesPlayed > 0);
  if (rows.length === 0) return undefined;

  const pick = (key: LastWeekStat['key'], score: (r: (typeof rows)[number]) => number): LastWeekStat | undefined => {
    const best = Math.max(0, ...rows.map(score));
    if (best < 1) return undefined;
    const top = rows.filter((r) => score(r) === best).map((r) => r.name).sort((a, b) => a.localeCompare(b));
    if (top.length === rows.length) return undefined;
    return { key, value: best, name: top.length > 1 ? `${top[0]} +${top.length - 1}` : top[0] };
  };

  const results = hasResults(last.session);
  const stats = [
    pick('played', (r) => r.gamesPlayed),
    results ? pick('wins', (r) => r.wins) : undefined,
    results ? pick('losses', (r) => r.losses) : undefined,
  ].filter((s): s is LastWeekStat => s !== undefined);
  if (stats.length === 0) return undefined;
  return { at: last.createdAt, games: last.session.history.length, stats };
}
