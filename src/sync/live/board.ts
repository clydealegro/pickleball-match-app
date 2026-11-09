import { previewNext } from '../../engine/preview';
import { orderedWaiting } from '../../engine/pool';
import type { Court, Session } from '../../engine/types';

/**
 * What the public live page is allowed to know about a running session. It is built from the session but never copies
 * it: no ratings, no scores or results, no history, no partner counts, and no full names. The database refuses a copy
 * that carries any of those keys, so this shape is also the list of what can ever leave the organizer's phone.
 */
export interface LivePlayer {
  /** First name. */
  f: string;
  /** Last initial, to tell two players with the same first name apart. */
  l: string | null;
  /** The saved player's id, which is how the page finds their face. Null for a player who is not saved. */
  r: string | null;
}

export interface LiveCourt {
  n: number;
  status: 'empty' | 'ready' | 'playing';
  closing: boolean;
  /** When the game on this court started. Only for a playing court. */
  startedAt?: number;
  /** The two teams. For a playing court, who is on it. For a ready court, who is up next on it. */
  teams?: [[string, string], [string, string]];
}

export interface LiveBoard {
  /** The title the page shows, like "Tuesday open play". */
  title: string;
  venue?: string;
  startMin?: number;
  endMin?: number;
  courts: LiveCourt[];
  players: Record<string, LivePlayer>;
  /** Everyone waiting, in the order they would play. */
  waiting: string[];
  onBreak: string[];
  /** The four most likely to play next and the court most likely to free up. It is a preview, not a promise. */
  next?: { court: number; ids: string[] };
  /** The average length of the games finished so far, in ms. Absent until a game has finished. */
  avgGameMs?: number;
}

export interface BoardFacts {
  title: string;
  venue?: string;
  startMin?: number;
  endMin?: number;
}

/** "Ana Reyes" is first name "Ana" and last initial "R". One word has no initial. */
export function nameParts(full: string): { f: string; l: string | null } {
  const words = full.trim().split(/\s+/).filter(Boolean);
  const f = words[0] ?? '?';
  const rest = words.slice(1).join(' ');
  return { f, l: rest ? rest[0].toUpperCase() : null };
}

function teamsOf(court: Court): LiveCourt['teams'] {
  const t = court.game ?? court.lineup;
  return t ? [[...t.team1], [...t.team2]] : undefined;
}

/** The public copy of a session. Players who have left the session are not in it. */
export function buildBoard(s: Session, facts: BoardFacts): LiveBoard {
  const courts: LiveCourt[] = [...s.courts]
    .sort((a, b) => a.number - b.number)
    .map((c) => {
      const teams = c.status === 'empty' ? undefined : teamsOf(c);
      return {
        n: c.number,
        status: c.status,
        closing: c.closing,
        ...(c.status === 'playing' && c.game ? { startedAt: c.game.startedAt } : {}),
        ...(teams ? { teams } : {}),
      };
    });
  const waiting = orderedWaiting(s).map((p) => p.id);
  const onBreak = s.players.filter((p) => p.status === 'break').map((p) => p.id);
  const shown = new Set<string>([...waiting, ...onBreak, ...courts.flatMap((c) => c.teams?.flat() ?? [])]);
  const players: Record<string, LivePlayer> = {};
  for (const p of s.players) {
    if (!shown.has(p.id)) continue;
    players[p.id] = { ...nameParts(p.name), r: p.rosterId ?? null };
  }
  const next = previewNext(s);
  const lengths = s.history.map((g) => g.finishedAt - g.startedAt).filter((ms) => ms > 0);
  return {
    title: facts.title,
    ...(facts.venue ? { venue: facts.venue } : {}),
    ...(facts.startMin !== undefined ? { startMin: facts.startMin } : {}),
    ...(facts.endMin !== undefined ? { endMin: facts.endMin } : {}),
    courts,
    players,
    waiting,
    onBreak,
    ...(next ? { next: { court: next.courtNumber, ids: next.playerIds } } : {}),
    ...(lengths.length > 0 ? { avgGameMs: Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) } : {}),
  };
}
