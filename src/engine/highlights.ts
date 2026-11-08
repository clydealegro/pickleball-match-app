import { formatDuration, plural, sessionStats, summarize } from './summary';
import type { Session } from './types';

/** Fewer games than this and a highlight says nothing, so none is shown. */
export const MIN_GAMES_FOR_HIGHLIGHTS = 3;
/** The summary shows at most this many lines. */
const MAX_LINES = 3;

export interface Highlight {
  key: 'unbeaten' | 'mostGames' | 'longest' | 'partners' | 'shortest';
  text: string;
}

/** "Ann", "Ann and Ben", "Ann, Ben and Cy", and "5 players" once a list would run long. */
function nameList(names: string[]): string {
  if (names.length > 3) return `${names.length} players`;
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * A few notable facts about a finished or running session, most interesting first. Win records only count when
 * `results` is true, because they can sting in a friendly group. A games or partners line that would name every
 * player is dropped: if everyone ties, nobody stands out.
 */
export function highlights(s: Session, options: { results?: boolean } = {}): Highlight[] {
  if (s.history.length < MIN_GAMES_FOR_HIGHLIGHTS) return [];
  const rows = summarize(s).filter((r) => r.gamesPlayed > 0);
  const lines: Highlight[] = [];

  /** The players with the top score, unless the score is empty or everyone shares it. */
  const leaders = (score: (r: (typeof rows)[number]) => number, atLeast: number) => {
    const best = Math.max(0, ...rows.map(score));
    if (best < atLeast) return undefined;
    const top = rows.filter((r) => score(r) === best);
    return top.length === rows.length ? undefined : { names: nameList(top.map((r) => r.name)), best };
  };

  if (options.results) {
    const unbeaten = rows.filter((r) => r.wins >= 2 && r.losses === 0);
    // Every recorded game gives one team a loss, so the unbeaten can never be the whole group.
    if (unbeaten.length > 0) {
      lines.push({ key: 'unbeaten', text: `Unbeaten: ${nameList(unbeaten.map((r) => r.name))}` });
    }
  }

  const most = leaders((r) => r.gamesPlayed, 1);
  if (most) lines.push({ key: 'mostGames', text: `Most games: ${most.names}, ${most.best}` });

  const lengths = s.history.map((g) => g.finishedAt - g.startedAt);
  const longest = Math.max(...lengths);
  const shortest = Math.min(...lengths);
  if (longest > shortest) lines.push({ key: 'longest', text: `Longest game: ${formatDuration(longest)}` });

  const mixers = leaders((r) => r.partners.length, 2);
  if (mixers) lines.push({ key: 'partners', text: `Most partners: ${mixers.names}, ${mixers.best} different` });

  if (longest > shortest) lines.push({ key: 'shortest', text: `Shortest game: ${formatDuration(shortest)}` });

  return lines.slice(0, MAX_LINES);
}

/** "1.5 hours", "40 minutes", "under a minute": time in the words a person would say. */
function spokenDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.round(minutes / 30) / 2;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/** "12 games, 3 hours, everyone got at least 3". Empty with no games. The last part is left out if someone sat out. */
export function summaryLine(s: Session): string {
  const stats = sessionStats(s);
  if (stats.games === 0) return '';
  const parts = [plural(stats.games, 'game'), spokenDuration(stats.playingMs)];
  if (stats.minGames >= 1) parts.push(`everyone got at least ${stats.minGames}`);
  return parts.join(', ');
}
