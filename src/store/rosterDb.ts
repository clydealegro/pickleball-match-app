import { deleteDB, openDB, type DBSchema, type IDBPDatabase, type OpenDBCallbacks } from 'idb';
import { newId } from '../lib/id';

export interface RosterPlayer {
  id: string;
  name: string;
  /** 0 = no photo; raised each time the photo changes. */
  photoVersion: number;
  lastPlayedAt?: number;
  /** Local edit time until synced (sync plan). */
  updatedAt: number;
  /** Soft delete so deletions can sync later. */
  deletedAt?: number;
}

/** A processed photo as raw bytes. Plain bytes (not a Blob) keep the storage layer simple and testable. */
export interface PhotoData {
  type: string;
  data: ArrayBuffer;
}

interface PhotoRecord extends PhotoData {
  /** The roster player's id. */
  id: string;
}

interface RosterSchema extends DBSchema {
  players: { key: string; value: RosterPlayer };
  photos: { key: string; value: PhotoRecord };
}

const DB_NAME = 'pickleball-roster';

interface Backend {
  getAll(): Promise<RosterPlayer[]>;
  get(id: string): Promise<RosterPlayer | undefined>;
  put(player: RosterPlayer): Promise<unknown>;
  getPhoto(id: string): Promise<PhotoData | undefined>;
  /** Saves a player and their photo (or removes the photo when `photo` is null) in one transaction. */
  putWithPhoto(player: RosterPlayer, photo: PhotoData | null): Promise<unknown>;
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
    async getPhoto(id) {
      const record = await database.get('photos', id);
      return record && { type: record.type, data: record.data };
    },
    async putWithPhoto(player, photo) {
      const tx = database.transaction(['players', 'photos'], 'readwrite');
      // Taken first, so aborting below cannot leave an unhandled rejection behind.
      const done = tx.done.catch(() => undefined);
      try {
        // The photo request goes first: a request that throws on the spot (such as a detached
        // buffer) does not abort the transaction, so nothing else may be written before it.
        await Promise.all([
          photo
            ? tx.objectStore('photos').put({ id: player.id, type: photo.type, data: photo.data })
            : tx.objectStore('photos').delete(player.id),
          tx.objectStore('players').put(player),
          tx.done,
        ]);
      } catch (error) {
        try {
          tx.abort();
        } catch {
          // The transaction had already finished.
        }
        await done;
        throw error;
      }
    },
    close: () => database.close(),
  };
}

function memoryBackend(): Backend {
  const map = new Map<string, RosterPlayer>();
  const photos = new Map<string, PhotoData>();
  return {
    getAll: async () => [...map.values()].map((p) => ({ ...p })),
    get: async (id) => {
      const p = map.get(id);
      return p && { ...p };
    },
    put: async (player) => {
      map.set(player.id, { ...player });
    },
    getPhoto: async (id) => {
      const p = photos.get(id);
      return p && { type: p.type, data: p.data.slice(0) };
    },
    putWithPhoto: async (player, photo) => {
      map.set(player.id, { ...player });
      if (photo) photos.set(player.id, { type: photo.type, data: photo.data.slice(0) });
      else photos.delete(player.id);
    },
  };
}

/** The schema version this build writes. Bump it, and branch on `oldVersion` in `upgrade`, to change the schema. */
const DB_VERSION = 2;

/** True when the database on disk is newer than the version this build asked for. */
function isVersionError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'VersionError';
}

async function openBackend(): Promise<Backend> {
  let database: IDBPDatabase<RosterSchema> | undefined;
  const callbacks: OpenDBCallbacks<RosterSchema> = {
    // Each step runs only for databases older than it, so upgrades work from any earlier version.
    upgrade(d, oldVersion) {
      if (oldVersion < 1) d.createObjectStore('players', { keyPath: 'id' });
      if (oldVersion < 2) d.createObjectStore('photos', { keyPath: 'id' });
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
    // An older tab still holds the database open. The upgrade waits until that tab steps aside.
    blocked() {
      console.warn('Saved players are waiting for another tab of this app to close its connection.');
    },
  };
  try {
    try {
      database = await openDB<RosterSchema>(DB_NAME, DB_VERSION, callbacks);
    } catch (error) {
      if (!isVersionError(error)) throw error;
      // A newer build already upgraded the database (a stale tab, or a rolled-back deploy).
      // Open it as it is; the newer schema only adds to the old one.
      database = await openDB<RosterSchema>(DB_NAME, undefined, callbacks);
    }
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
    await database.putWithPhoto({ ...current, deletedAt: now, updatedAt: now }, null);
  });
}

/** The saved photo for a player, or undefined when they have none on this device. */
export async function getRosterPhoto(id: string): Promise<PhotoData | undefined> {
  return (await db()).getPhoto(id);
}

/** Saves a photo for a player and raises their photo version. */
export function setRosterPhoto(id: string, photo: PhotoData, now = Date.now()): Promise<void> {
  return serial(async () => {
    const database = await db();
    const current = await database.get(id);
    if (!current || current.deletedAt) throw new Error('That player no longer exists.');
    await database.putWithPhoto({ ...current, photoVersion: current.photoVersion + 1, updatedAt: now }, photo);
  });
}

/** Removes a player's photo and sets their photo version back to 0. */
export function removeRosterPhoto(id: string, now = Date.now()): Promise<void> {
  return serial(async () => {
    const database = await db();
    const current = await database.get(id);
    if (!current || current.deletedAt || current.photoVersion === 0) return;
    await database.putWithPhoto({ ...current, photoVersion: 0, updatedAt: now }, null);
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
