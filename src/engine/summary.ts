import type { PlayerStatus, Session } from './types';

/** Wins and losses over the games that have a recorded result. Skipped results count for nothing. */
export interface WinLoss {
  wins: number;
  losses: number;
}

export interface PlayerSummary {
  id: string;
  name: string;
  gamesPlayed: number;
  status: PlayerStatus;
  rosterId?: string;
  wins: number;
  losses: number;
  partners: ({ name: string; count: number } & WinLoss)[];
  opponents: { name: string; count: number }[];
}

const none = (): WinLoss => ({ wins: 0, losses: 0 });

/** Each player's record, and each pair's record as partners, from the games with a recorded winner. */
function records(s: Session) {
  const own = new Map<string, WinLoss>();
  const pairs = new Map<string, WinLoss>();
  const bump = (m: Map<string, WinLoss>, key: string, won: boolean) => {
    const r = m.get(key) ?? none();
    if (won) r.wins += 1;
    else r.losses += 1;
    m.set(key, r);
  };
  for (const g of s.history) {
    if (g.winner === undefined) continue;
    for (const [team, won] of [
      [g.team1, g.winner === 1],
      [g.team2, g.winner === 2],
    ] as const) {
      for (const id of team) bump(own, id, won);
      bump(pairs, `${team[0]}|${team[1]}`, won);
      bump(pairs, `${team[1]}|${team[0]}`, won);
    }
  }
  return { own, pairs };
}

function named(counts: Record<string, number>, nameById: Map<string, string>) {
  return Object.entries(counts)
    .flatMap(([id, count]) => {
      const name = nameById.get(id);
      return name ? [{ id, name, count }] : [];
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function summarize(s: Session): PlayerSummary[] {
  const nameById = new Map(s.players.map((p) => [p.id, p.name]));
  const { own, pairs } = records(s);
  return s.players
    .map((p) => ({
      id: p.id,
      name: p.name,
      gamesPlayed: p.gamesPlayed,
      status: p.status,
      rosterId: p.rosterId,
      wins: own.get(p.id)?.wins ?? 0,
      losses: own.get(p.id)?.losses ?? 0,
      partners: named(p.partnerCounts, nameById).map(({ id, name, count }) => ({
        name,
        count,
        wins: pairs.get(`${p.id}|${id}`)?.wins ?? 0,
        losses: pairs.get(`${p.id}|${id}`)?.losses ?? 0,
      })),
      opponents: named(p.opponentCounts, nameById).map(({ name, count }) => ({ name, count })),
    }))
    .sort((a, b) => b.gamesPlayed - a.gamesPlayed || a.name.localeCompare(b.name));
}

/** True when at least one finished game has a recorded winner. */
export function hasResults(s: Session): boolean {
  return s.history.some((g) => g.winner !== undefined);
}

export interface SessionStats {
  games: number;
  players: number;
  /** First game start to last game finish, in ms; 0 with no games. */
  playingMs: number;
  /** Mean game length in ms; 0 with no games. */
  averageGameMs: number;
  minGames: number;
  maxGames: number;
}

export function sessionStats(s: Session): SessionStats {
  const h = s.history;
  const counts = s.players.map((p) => p.gamesPlayed);
  const total = h.reduce((sum, g) => sum + (g.finishedAt - g.startedAt), 0);
  return {
    games: h.length,
    players: s.players.length,
    playingMs: h.length ? Math.max(...h.map((g) => g.finishedAt)) - Math.min(...h.map((g) => g.startedAt)) : 0,
    averageGameMs: h.length ? total / h.length : 0,
    minGames: counts.length ? Math.min(...counts) : 0,
    maxGames: counts.length ? Math.max(...counts) : 0,
  };
}

/** "1h 25m", "45m", or "under 1m". */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under 1m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** One line on how evenly games were shared; empty when nothing was played. */
export function fairnessLine(stats: SessionStats): string {
  if (stats.games === 0) return '';
  if (stats.minGames === stats.maxGames) return `Everyone played ${plural(stats.maxGames, 'game')}`;
  return `Games per player: ${stats.minGames} to ${stats.maxGames}`;
}

export interface GameLogEntry {
  courtNumber: number;
  durationMs: number;
  team1: string[];
  team2: string[];
  winner?: 1 | 2;
  score?: [number, number];
}

/** Finished games in the order they were played, with names instead of ids. */
export function gameLog(s: Session): GameLogEntry[] {
  const nameById = new Map(s.players.map((p) => [p.id, p.name]));
  const names = (ids: string[]) => ids.map((id) => nameById.get(id) ?? 'Unknown');
  return s.history.map((g) => ({
    courtNumber: g.courtNumber,
    durationMs: g.finishedAt - g.startedAt,
    team1: names(g.team1),
    team2: names(g.team2),
    ...(g.winner === undefined ? {} : { winner: g.winner }),
    ...(g.score === undefined ? {} : { score: g.score }),
  }));
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Short text for a group chat: a headline, then one "Name: games" line per player. No partner lists. Win and loss
 * records are left out unless `results` is true, because they can sting in a friendly group.
 */
export function formatSummaryText(s: Session, tzOffsetMinutes = 0, options: { results?: boolean } = {}): string {
  const date = new Date(s.createdAt + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
  const stats = sessionStats(s);
  const facts = [plural(stats.games, 'game') + ' played'];
  if (stats.games > 0) facts.push(formatDuration(stats.playingMs));
  const lines = [`${s.name} — ${date}`, facts.join(' · '), ''];
  for (const row of summarize(s)) {
    const record = options.results && row.wins + row.losses > 0 ? ` · ${row.wins}W ${row.losses}L` : '';
    lines.push(`${row.name}: ${row.gamesPlayed}${record}`);
  }
  return lines.join('\n');
}
