import type { PulledPlayer, RosterPlayer } from '../store/rosterDb';

/** How a player is sent to the server. `owner_id` is added when it is sent. */
export interface PushRow {
  id: string;
  name: string;
  photo_version: number;
  photo_seq: number;
  last_played_at: string | null;
  deleted_at: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Far longer than any real name. A row above this is not a player this app wrote. */
const MAX_NAME = 200;
const MAX_COUNT = 1_000_000;

/** Names are compared the way the app compares them: edges trimmed, case ignored. */
export const norm = (name: string) => name.trim().toLowerCase();

export function pushRow(player: RosterPlayer): PushRow {
  return {
    id: player.id,
    name: player.name.trim(),
    photo_version: player.photoVersion,
    photo_seq: player.photoSeq,
    last_played_at: player.lastPlayedAt === undefined ? null : new Date(player.lastPlayedAt).toISOString(),
    deleted_at: player.deletedAt === undefined ? null : new Date(player.deletedAt).toISOString(),
  };
}

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT ? value : null;

/** A time as milliseconds, `undefined` for null, and `null` for anything that is not a time. */
function time(value: unknown): number | undefined | null {
  if (value === null) return undefined;
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Checks one row from the server before it can reach the screen, and puts it in the app's units. Returns null for
 * a row this app would not have written (a missing field, a name that is only spaces once trimmed the way
 * JavaScript trims, a number that is not a number). The server's own `btrim` strips fewer characters than
 * JavaScript's `trim()`, so a name is trimmed here too.
 */
export function parsePlayerRow(raw: unknown): PulledPlayer | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || !UUID.test(row.id) || typeof row.name !== 'string') return null;
  const name = row.name.trim();
  if (name === '' || name.length > MAX_NAME) return null;
  const photoVersion = count(row.photo_version);
  const photoSeq = count(row.photo_seq);
  const lastPlayedAt = time(row.last_played_at);
  const deletedAt = time(row.deleted_at);
  const updatedAt = time(row.updated_at);
  if (photoVersion === null || photoSeq === null || lastPlayedAt === null || deletedAt === null) return null;
  if (updatedAt === null || updatedAt === undefined) return null;
  return {
    id: row.id.toLowerCase(),
    name,
    photoVersion,
    photoSeq,
    updatedAt,
    ...(lastPlayedAt === undefined ? {} : { lastPlayedAt }),
    ...(deletedAt === undefined ? {} : { deletedAt }),
  };
}
