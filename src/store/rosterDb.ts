import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { newId } from '../lib/id';

export interface RosterPlayer {
  id: string;
  name: string;
  /** 0 = no photo. Used by the photos plan. */
  photoVersion: number;
  lastPlayedAt?: number;
  /** Local edit time until synced (sync plan). */
  updatedAt: number;
  /** Soft delete so deletions can sync later. */
  deletedAt?: number;
}

interface RosterSchema extends DBSchema {
  players: { key: string; value: RosterPlayer };
}

const DB_NAME = 'pickleball-roster';
let dbPromise: Promise<IDBPDatabase<RosterSchema>> | null = null;

function db(): Promise<IDBPDatabase<RosterSchema>> {
  dbPromise ??= openDB<RosterSchema>(DB_NAME, 1, {
    upgrade(database) {
      database.createObjectStore('players', { keyPath: 'id' });
    },
  });
  return dbPromise;
}

/** Test helper: closes and deletes the database. */
export async function resetRosterDbForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
  await deleteDB(DB_NAME);
}

const norm = (name: string) => name.trim().toLowerCase();

async function liveEntries(): Promise<RosterPlayer[]> {
  return (await (await db()).getAll('players')).filter((p) => !p.deletedAt);
}

export async function listRoster(): Promise<RosterPlayer[]> {
  return (await liveEntries()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

/** Adds a player, or returns the existing entry if the name is already saved. */
export async function addRosterPlayer(name: string, now = Date.now()): Promise<RosterPlayer> {
  const clean = name.trim();
  if (!clean) throw new Error('Enter a name for the player.');
  const existing = (await liveEntries()).find((p) => norm(p.name) === norm(clean));
  if (existing) return existing;
  const player: RosterPlayer = { id: newId(), name: clean, photoVersion: 0, updatedAt: now };
  await (await db()).put('players', player);
  return player;
}

export async function renameRosterPlayer(id: string, name: string, now = Date.now()): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new Error('Enter a name for the player.');
  const entries = await liveEntries();
  if (entries.some((p) => p.id !== id && norm(p.name) === norm(clean))) {
    throw new Error(`${clean} is already saved.`);
  }
  const current = entries.find((p) => p.id === id);
  if (!current) throw new Error('That player no longer exists.');
  await (await db()).put('players', { ...current, name: clean, updatedAt: now });
}

export async function deleteRosterPlayer(id: string, now = Date.now()): Promise<void> {
  const database = await db();
  const current = await database.get('players', id);
  if (!current || current.deletedAt) return;
  await database.put('players', { ...current, deletedAt: now, updatedAt: now });
}

export async function markRosterPlayed(ids: string[], at: number): Promise<void> {
  const database = await db();
  for (const id of ids) {
    const current = await database.get('players', id);
    if (current && !current.deletedAt) {
      await database.put('players', { ...current, lastPlayedAt: at, updatedAt: at });
    }
  }
}

/** The players of the most recent session: everyone sharing the latest lastPlayedAt. */
export function lastSessionIds(roster: RosterPlayer[]): string[] {
  const times = roster.flatMap((p) => (p.lastPlayedAt === undefined ? [] : [p.lastPlayedAt]));
  if (times.length === 0) return [];
  const latest = Math.max(...times);
  return roster.filter((p) => p.lastPlayedAt === latest).map((p) => p.id);
}
