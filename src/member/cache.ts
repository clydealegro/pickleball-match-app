import type { AttendanceViewData } from '../sync/attendance/types';

export const CACHE_KEY = 'pikl.member.cache.v1';

const MAX_CODES = 5;
const CODE = /^[A-Za-z0-9_-]+$/;
const STATUSES = ['in', 'maybe', 'out'];

export interface Cached {
  view: AttendanceViewData;
  /** When the view was fetched, in ms. */
  at: number;
}

export interface CacheData {
  version: 1;
  /** The last good view by link code. Oldest first. */
  entries: Record<string, Cached>;
}

const empty = (): CacheData => ({ version: 1, entries: {} });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isNumberOrNull = (v: unknown): v is number | null => v === null || isNumber(v);

/** A view rebuilt from only the fields the page reads, or null when any of them is wrong. */
function asView(raw: unknown): AttendanceViewData | null {
  if (!isObject(raw)) return null;
  const { title, weekday, venue, start_min, end_min, courts, play_date, cancelled, players, answers, friends } = raw;
  if (typeof title !== 'string' || !isNumber(weekday) || !isStringOrNull(venue)) return null;
  if (!isNumberOrNull(start_min) || !isNumberOrNull(end_min) || !isNumberOrNull(courts)) return null;
  if (typeof play_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(play_date) || !isNumber(friends)) return null;
  if (cancelled !== null && !(isObject(cancelled) && isStringOrNull(cancelled.reason))) return null;
  if (!Array.isArray(players) || !Array.isArray(answers)) return null;
  const goodPlayers = players.every(
    (p) =>
      isObject(p) && typeof p.id === 'string' && typeof p.first_name === 'string' && isStringOrNull(p.last_initial) && typeof p.has_photo === 'boolean' && isNumber(p.photo_seq),
  );
  const goodAnswers = answers.every(
    (a) => isObject(a) && typeof a.player_id === 'string' && typeof a.status === 'string' && STATUSES.includes(a.status) && typeof a.late === 'boolean',
  );
  if (!goodPlayers || !goodAnswers) return null;
  return {
    title,
    weekday,
    venue,
    start_min,
    end_min,
    courts,
    play_date,
    cancelled: cancelled === null ? null : { reason: (cancelled as { reason: string | null }).reason },
    players: (players as AttendanceViewData['players']).map((p) => ({
      id: p.id,
      first_name: p.first_name,
      last_initial: p.last_initial,
      has_photo: p.has_photo,
      photo_seq: p.photo_seq,
    })),
    answers: (answers as AttendanceViewData['answers']).map((a) => ({ player_id: a.player_id, status: a.status, late: a.late })),
    friends,
  };
}

/** Defaults for anything missing or malformed. Drops bad entries and keeps the newest 5 codes. */
export function parseCache(raw: string | null): CacheData {
  if (!raw) return empty();
  try {
    const data: unknown = JSON.parse(raw);
    if (!isObject(data) || data.version !== 1 || !isObject(data.entries)) return empty();
    const kept: [string, Cached][] = [];
    for (const [code, entry] of Object.entries(data.entries)) {
      if (!CODE.test(code) || !isObject(entry) || !isNumber(entry.at)) continue;
      const view = asView(entry.view);
      if (view) kept.push([code, { view, at: entry.at }]);
    }
    return { version: 1, entries: Object.fromEntries(kept.slice(-MAX_CODES)) };
  } catch {
    return empty();
  }
}

function load(): CacheData {
  try {
    return parseCache(localStorage.getItem(CACHE_KEY));
  } catch {
    return empty();
  }
}

export const readCached = (code: string): Cached | null => load().entries[code] ?? null;

/** Keeps the last good view for a code. A code written again counts as new, so the oldest codes go first. */
export function writeCached(code: string, view: AttendanceViewData, at: number): void {
  const data = load();
  delete data.entries[code];
  data.entries[code] = { view, at };
  data.entries = Object.fromEntries(Object.entries(data.entries).slice(-MAX_CODES));
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // Storage is blocked or full: the page works without an offline copy.
  }
}
