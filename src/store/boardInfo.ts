import type { Court, Player, Session } from '../engine';

export interface CourtView {
  id: string;
  number: number;
  state: 'playing' | 'ready' | 'open';
  closing: boolean;
  /** The game clock, only while a game is playing. */
  clock?: string;
  teamA: Player[];
  teamB: Player[];
}

/** The players for these ids, in the same order. An id that is not in the session is dropped. */
function resolve(byId: Map<string, Player>, ids: readonly string[]): Player[] {
  return ids.flatMap((id) => {
    const p = byId.get(id);
    return p ? [p] : [];
  });
}

function view(court: Court, byId: Map<string, Player>, nowMs: number): CourtView {
  const base = { id: court.id, number: court.number, closing: court.closing };
  if (court.status === 'playing' && court.game) {
    const { team1, team2, startedAt } = court.game;
    return { ...base, state: 'playing', clock: gameClock(startedAt, nowMs), teamA: resolve(byId, team1), teamB: resolve(byId, team2) };
  }
  if (court.status === 'ready' && court.lineup) {
    const { team1, team2 } = court.lineup;
    return { ...base, state: 'ready', teamA: resolve(byId, team1), teamB: resolve(byId, team2) };
  }
  return { ...base, state: 'open', teamA: [], teamB: [] };
}

/** Every court as the board shows it, in court-number order. */
export function courtViews(session: Session, nowMs: number): CourtView[] {
  const byId = new Map(session.players.map((p) => [p.id, p]));
  return [...session.courts].sort((a, b) => a.number - b.number).map((c) => view(c, byId, nowMs));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Time since a game started: "0:09", "12:41", then "1:02:03" from one hour. Never negative. */
export function gameClock(startedAt: number, nowMs: number): string {
  const total = Math.max(0, Math.floor((nowMs - startedAt) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const words = (name: string) => name.trim().split(/\s+/).filter(Boolean);

/** The first name, plus the last initial ("Ana R.") when someone else on the board has the same first name. */
export function boardName(player: Player, everyone: Player[]): string {
  const [first = '', ...rest] = words(player.name);
  const clash = everyone.some((o) => o.id !== player.id && (words(o.name)[0] ?? '').toLowerCase() === first.toLowerCase());
  if (!clash || rest.length === 0) return first;
  return `${first} ${Array.from(rest[rest.length - 1])[0].toUpperCase()}.`;
}

export interface BoardGrid {
  columns: number;
  rows: number;
  /** How many courts fit on the board. */
  shown: number;
  /** How many courts are left off, named in the header. */
  hidden: number;
}

const MAX_SHOWN = 6;

/** Columns and rows for this many courts. At most six show; the rest are counted in the header. */
export function gridFor(courtCount: number, landscape: boolean): BoardGrid {
  const shown = Math.min(courtCount, MAX_SHOWN);
  const hidden = courtCount - shown;
  if (shown === 0) return { columns: 1, rows: 1, shown, hidden };
  if (landscape) {
    if (shown <= 3) return { columns: shown, rows: 1, shown, hidden };
    if (shown === 4) return { columns: 2, rows: 2, shown, hidden };
    return { columns: 3, rows: 2, shown, hidden };
  }
  if (shown <= 4) return { columns: 1, rows: shown, shown, hidden };
  return { columns: 2, rows: 3, shown, hidden };
}

/**
 * How many waiting players to draw in a strip. When everyone fits, everyone shows. When not, one slot is kept for
 * the "+N" circle. Someone always shows when someone waits.
 */
export function waitingCapacity(stripWidth: number, itemWidth: number, gap: number, total: number): number {
  if (total <= 0) return 0;
  const fit = Math.floor((stripWidth + gap) / (itemWidth + gap));
  if (total <= fit) return total;
  return Math.max(1, fit - 1);
}

/** A hue from 0 to 359 for this name, the same every time. */
export function nameHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (Math.imul(h, 31) + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h % 360;
}
