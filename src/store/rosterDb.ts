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

interface Backend {
  getAll(): Promise<RosterPlayer[]>;
  get(id: string): Promise<RosterPlayer | undefined>;
  put(player: RosterPlayer): Promise<unknown>;
  close?(): void;
}

/** Serializes read-modify-write operations so overlapping calls cannot interleave. */
let queue: Promise<unknown> = Promise.resolve();

let backendPromise: Promise<Backend> | null = null;
let persistent = true;

function idbBackend(database: IDBPDatabase<RosterSchema>): Backend {
  return {
    getAll: () => database.getAll('players'),
    get: (id) => database.get('players', id),
    put: (player) => database.put('players', player),
    close: () => database.close(),
  };
}

function memoryBackend(): Backend {
  const map = new Map<string, RosterPlayer>();
  return {
    getAll: async () => [...map.values()].map((p) => ({ ...p })),
    get: async (id) => {
      const p = map.get(id);
      return p && { ...p };
    },
    put: async (player) => {
      map.set(player.id, { ...player });
    },
  };
}

async function openBackend(): Promise<Backend> {
  try {
    let database: IDBPDatabase<RosterSchema> | undefined;
    database = await openDB<RosterSchema>(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore('players', { keyPath: 'id' });
      },
      // The browser closed the connection (e.g. iOS Safari when backgrounded): reopen on next use.
      terminated() {
        backendPromise = null;
      },
      // Another tab wants to upgrade or delete the database: step aside and reopen later.
      blocking() {
        database?.close();
        backendPromise = null;
      },
    });
    return idbBackend(database);
  } catch {
    // Private mode or blocked storage: keep working for this visit, without saving.
    persistent = false;
    return memoryBackend();
  }
}

function db(): Promise<Backend> {
  backendPromise ??= openBackend();
  return backendPromise;
}

/** False when IndexedDB is unavailable and saved players only live in memory. */
export function isRosterPersistent(): boolean {
  return persistent;
}

/** Test helper: closes and deletes the database, and clears the fallback state. */
export async function resetRosterDbForTests(): Promise<void> {
  await queue.catch(() => undefined);
  if (backendPromise) (await backendPromise).close?.();
  backendPromise = null;
  persistent = true;
  queue = Promise.resolve();
  await deleteDB(DB_NAME);
}

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(() => fn());
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const norm = (name: string) => name.trim().toLowerCase();

async function liveEntries(): Promise<RosterPlayer[]> {
  return (await (await db()).getAll()).filter((p) => !p.deletedAt);
}

export async function listRoster(): Promise<RosterPlayer[]> {
  return (await liveEntries()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id),
  );
}

/** Adds a player, or returns the existing entry if the name is already saved. */
export async function addRosterPlayer(name: string, now = Date.now()): Promise<RosterPlayer> {
  const clean = name.trim();
  if (!clean) throw new Error('Enter a name for the player.');
  return serial(async () => {
    const existing = (await liveEntries()).find((p) => norm(p.name) === norm(clean));
    if (existing) return existing;
    const player: RosterPlayer = { id: newId(), name: clean, photoVersion: 0, updatedAt: now };
    await (await db()).put(player);
    return player;
  });
}

export async function renameRosterPlayer(id: string, name: string, now = Date.now()): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new Error('Enter a name for the player.');
  return serial(async () => {
    const entries = await liveEntries();
    const current = entries.find((p) => p.id === id);
    if (!current) throw new Error('That player no longer exists.');
    if (current.name === clean) return;
    if (entries.some((p) => p.id !== id && norm(p.name) === norm(clean))) {
      throw new Error(`${clean} is already saved.`);
    }
    await (await db()).put({ ...current, name: clean, updatedAt: now });
  });
}

export function deleteRosterPlayer(id: string, now = Date.now()): Promise<void> {
  return serial(async () => {
    const database = await db();
    const current = await database.get(id);
    if (!current || current.deletedAt) return;
    await database.put({ ...current, deletedAt: now, updatedAt: now });
  });
}

export function markRosterPlayed(ids: string[], at: number): Promise<void> {
  return serial(async () => {
    const database = await db();
    for (const id of new Set(ids)) {
      const current = await database.get(id);
      if (current && !current.deletedAt) {
        await database.put({
          ...current,
          lastPlayedAt: Math.max(current.lastPlayedAt ?? 0, at),
          updatedAt: at,
        });
      }
    }
  });
}

/** The players of the most recent session: everyone sharing the latest lastPlayedAt. */
export function lastSessionIds(roster: RosterPlayer[]): string[] {
  const times = roster.flatMap((p) => (p.lastPlayedAt === undefined ? [] : [p.lastPlayedAt]));
  if (times.length === 0) return [];
  const latest = Math.max(...times);
  return roster.filter((p) => p.lastPlayedAt === latest).map((p) => p.id);
}
