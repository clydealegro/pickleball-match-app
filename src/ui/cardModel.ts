import * as engine from '../engine';
import type { Session } from '../engine';
import { shortDate } from '../store/attendance';

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
/** More players than this would shrink the avatars past reading, so the rest are counted instead. */
export const MAX_CARD_PLAYERS = 30;

/** The app's own colours, copied from the style sheet so the picture matches the screen the organizer shared from. */
export interface Palette {
  bg: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  accentInk: string;
}

const LIGHT: Palette = { bg: '#fafaf7', ink: '#111111', muted: '#66665f', line: '#e6e5df', accent: '#c8f03c', accentInk: '#111111' };
const DARK: Palette = { bg: '#0f0f0e', ink: '#f4f4ef', muted: '#a0a098', line: '#2c2c29', accent: '#c8f03c', accentInk: '#111111' };

/** Dark gets the dark palette; every other theme, including ones added later, gets the light one. */
export function paletteFor(theme: string | undefined): Palette {
  return theme === 'dark' ? DARK : LIGHT;
}

export interface CardPlayer {
  name: string;
  games: number;
  /** "4W 1L", only when results are switched on and the player has a recorded game. */
  record?: string;
  /** Where to find the photo on this device. */
  rosterId?: string;
}

export interface CardModel {
  title: string;
  date: string;
  /** Where it was played, when the session says. */
  venue?: string;
  facts: string;
  lines: string[];
  players: CardPlayer[];
  /** Players left off the grid because there were more than `MAX_CARD_PLAYERS`. */
  more: number;
  palette: Palette;
}

/** Everything the picture says, as plain data, so it can be tested without a canvas. */
export function buildCardModel(session: Session, options: { results: boolean; theme: string | undefined }): CardModel {
  const stats = engine.sessionStats(session);
  const rows = engine.summarize(session);
  const players = rows.slice(0, MAX_CARD_PLAYERS).map((r): CardPlayer => {
    const record = options.results && r.wins + r.losses > 0 ? `${r.wins}W ${r.losses}L` : undefined;
    return { name: r.name, games: r.gamesPlayed, ...(record ? { record } : {}), ...(r.rosterId ? { rosterId: r.rosterId } : {}) };
  });
  const facts = [engine.plural(stats.games, 'game')];
  if (stats.games > 0) facts.push(engine.formatDuration(stats.playingMs));
  const venue = session.venue?.trim();
  return {
    title: session.name,
    date: shortDate(session.createdAt),
    ...(venue ? { venue } : {}),
    facts: facts.join(' · '),
    lines: engine.highlights(session, { results: options.results }).map((h) => h.text),
    players,
    more: Math.max(0, rows.length - players.length),
    palette: paletteFor(options.theme),
  };
}

/** Columns for the avatar grid: few players get big avatars. */
export function gridColumns(count: number): number {
  if (count <= 6) return 3;
  if (count <= 12) return 4;
  if (count <= 20) return 5;
  return 6;
}
