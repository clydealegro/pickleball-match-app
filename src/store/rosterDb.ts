import { deleteDB, openDB, type DBSchema, type IDBPDatabase, type OpenDBCallbacks } from 'idb';
import { newId } from '../lib/id';

export interface RosterPlayer {
  id: string;
  name: string;
  /** 0 = no photo; raised each time the photo changes, and set back to 0 when it is removed. */
  photoVersion: number;
  /** Only ever goes up, even when the photo is removed. It names the photo's file online, so a path is never reused. */
  photoSeq: number;
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

/**
 * A mark that one player has changes not yet pushed online. There is at most one per player. `rev` comes from one
 * counter shared by all players and never reused, so a push can tell whether the player changed while it ran, and a
 * late acknowledgement can never remove a newer mark.
 */
export interface OutboxEntry {
  playerId: string;
  rev: number;
}

interface RosterSchema extends DBSchema {
  players: { key: string; value: RosterPlayer };
  photos: { key: string; value: PhotoRecord };
  outbox: { key: string; value: OutboxEntry };
  syncMeta: { key: string; value: unknown };
}

const DB_NAME = 'pickleball-roster';
const STORES = ['players', 'photos', 'outbox', 'syncMeta'] as const;
/** The syncMeta key that holds the last outbox revision handed out. */
const REV_KEY = 'outboxRev';

/** What a write can do. Every call belongs to one transaction: all of it is saved, or none of it. */
interface RosterTx {
  getAll(): Promise<RosterPlayer[]>;
  get(id: string): Promise<RosterPlayer | undefined>;
  put(player: RosterPlayer): Promise<void>;
  putPhoto(id: string, photo: PhotoData): Promise<void>;
  deletePhoto(id: string): Promise<void>;
  /** Marks the player as having changes to push. */
  markDirty(id: string): Promise<void>;
}

interface Backend {
  getAll(): Promise<RosterPlayer[]>;
  get(id: string): Promise<RosterPlayer | undefined>;
  getPhoto(id: string): Promise<PhotoData | undefined>;
  /**
   * Runs `work` as one transaction over the players, their photos and the outbox. `work` must only wait on the
   * calls of its `RosterTx` (the browser closes a transaction that waits on anything else). If it throws, nothing is saved.
   */
  run<T>(work: (tx: RosterTx) => Promise<T>): Promise<T>;
  getOutbox(): Promise<OutboxEntry[]>;
  /** Removes the player's outbox mark, but only if it is still at `rev`. */
  ackOutbox(playerId: string, rev: number): Promise<void>;
  getMeta(key: string): Promise<unknown>;
  setMeta(key: string, value: unknown): Promise<void>;
  close?(): void;
}

/** Orders calls from this tab, so overlapping calls cannot interleave. The database orders them between tabs. */
let queue: Promise<unknown> = Promise.resolve();

let backendPromise: Promise<Backend> | null = null;
let persistent = true;

/** Rows saved before `photoSeq` existed (or by an older build) have none. Their photo count is a safe start. */
function withSeq(player: RosterPlayer): RosterPlayer {
  return typeof player.photoSeq === 'number' ? player : { ...player, photoSeq: player.photoVersion };
}

function idbBackend(database: IDBPDatabase<RosterSchema>): Backend {
  return {
    async getAll() {
      return (await database.getAll('players')).map(withSeq);
    },
    async get(id) {
      const player = await database.get('players', id);
      return player && withSeq(player);
    },
    async getPhoto(id) {
      const record = await database.get('photos', id);
      return record && { type: record.type, data: record.data };
    },
    async run(work) {
      // A database left by a newer build might lack a store this build knows about; use the ones that exist.
      const names = STORES.filter((name) => database.objectStoreNames.contains(name));
      const has = (name: (typeof STORES)[number]) => names.includes(name);
      const tx = database.transaction(names, 'readwrite');
      // Created first, so aborting below does not leave this promise rejecting with nobody listening.
      const done = tx.done.catch(() => undefined);
      let lastRev: number | undefined; // the counter is read once per transaction, then kept here
      const view: RosterTx = {
        async getAll() {
          return (await tx.objectStore('players').getAll()).map(withSeq);
        },
        async get(id) {
          const player = await tx.objectStore('players').get(id);
          return player && withSeq(player);
        },
        async put(player) {
          await tx.objectStore('players').put(player);
        },
        async putPhoto(id, photo) {
          await tx.objectStore('photos').put({ id, type: photo.type, data: photo.data });
        },
        async deletePhoto(id) {
          if (has('photos')) await tx.objectStore('photos').delete(id);
        },
        async markDirty(id) {
          if (!has('outbox')) return;
          // The counter lives beside the marks, so handing out a revision and saving the mark are one step.
          lastRev ??= has('syncMeta') ? (((await tx.objectStore('syncMeta').get(REV_KEY)) as number | undefined) ?? 0) : 0;
          lastRev += 1;
          await tx.objectStore('outbox').put({ playerId: id, rev: lastRev });
          if (has('syncMeta')) await tx.objectStore('syncMeta').put(lastRev, REV_KEY);
        },
      };
      try {
        const result = await work(view);
        await tx.done;
        return result;
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
    async getOutbox() {
      return database.objectStoreNames.contains('outbox') ? database.getAll('outbox') : [];
    },
    async ackOutbox(playerId, rev) {
      if (!database.objectStoreNames.contains('outbox')) return;
      const tx = database.transaction('outbox', 'readwrite');
      const current = await tx.store.get(playerId);
      if (current && current.rev === rev) await tx.store.delete(playerId);
      await tx.done;
    },
    async getMeta(key) {
      return database.objectStoreNames.contains('syncMeta') ? database.get('syncMeta', key) : undefined;
    },
    async setMeta(key, value) {
      if (database.objectStoreNames.contains('syncMeta')) await database.put('syncMeta', value, key);
    },
    close: () => database.close(),
  };
}

function memoryBackend(): Backend {
  const map = new Map<string, RosterPlayer>();
  const photos = new Map<string, PhotoData>();
  const outbox = new Map<string, OutboxEntry>();
  const meta = new Map<string, unknown>();
  let lastRev = 0;
  return {
    getAll: async () => [...map.values()].map((p) => withSeq({ ...p })),
    get: async (id) => {
      const p = map.get(id);
      return p && withSeq({ ...p });
    },
    getPhoto: async (id) => {
      const p = photos.get(id);
      return p && { type: p.type, data: p.data.slice(0) };
    },
    async run(work) {
      const before = { map: new Map(map), photos: new Map(photos), outbox: new Map(outbox), lastRev };
      const view: RosterTx = {
        getAll: async () => [...map.values()].map((p) => withSeq({ ...p })),
        get: async (id) => {
          const p = map.get(id);
          return p && withSeq({ ...p });
        },
        put: async (player) => {
          map.set(player.id, { ...player });
        },
        putPhoto: async (id, photo) => {
          photos.set(id, { type: photo.type, data: photo.data.slice(0) });
        },
        deletePhoto: async (id) => {
          photos.delete(id);
        },
        markDirty: async (id) => {
          lastRev += 1;
          outbox.set(id, { playerId: id, rev: lastRev });
        },
      };
      try {
        return await work(view);
      } catch (error) {
        // Put everything back, as the database would.
        map.clear();
        before.map.forEach((v, k) => map.set(k, v));
        photos.clear();
        before.photos.forEach((v, k) => photos.set(k, v));
        outbox.clear();
        before.outbox.forEach((v, k) => outbox.set(k, v));
        lastRev = before.lastRev;
        throw error;
      }
    },
    getOutbox: async () => [...outbox.values()].map((e) => ({ ...e })),
    ackOutbox: async (playerId, rev) => {
      if (outbox.get(playerId)?.rev === rev) outbox.delete(playerId);
    },
    getMeta: async (key) => meta.get(key),
    setMeta: async (key, value) => {
      meta.set(key, value);
    },
  };
}

/** The schema version this build writes. Bump it, and branch on `oldVersion` in `upgrade`, to change the schema. */
const DB_VERSION = 3;

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
      if (oldVersion < 3) {
        d.createObjectStore('outbox', { keyPath: 'playerId' });
        d.createObjectStore('syncMeta');
        // Players saved before this version have no `photoSeq`. Every read fills it in from their photo count, so
        // nothing needs rewriting here.
      }
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

/** Runs a change as one transaction, after the earlier calls from this tab. */
function write<T>(work: (tx: RosterTx) => Promise<T>): Promise<T> {
  return serial(async () => (await db()).run(work));
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
  return write(async (tx) => {
    const existing = (await tx.getAll()).find((p) => !p.deletedAt && norm(p.name) === norm(clean));
    if (existing) return existing;
    const player: RosterPlayer = { id: newId(), name: clean, photoVersion: 0, photoSeq: 0, updatedAt: now };
    await tx.put(player);
    await tx.markDirty(player.id);
    return player;
  });
}

export async function renameRosterPlayer(id: string, name: string, now = Date.now()): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new Error('Enter a name for the player.');
  return write(async (tx) => {
    const entries = (await tx.getAll()).filter((p) => !p.deletedAt);
    const current = entries.find((p) => p.id === id);
    if (!current) throw new Error('That player no longer exists.');
    if (current.name === clean) return;
    if (entries.some((p) => p.id !== id && norm(p.name) === norm(clean))) {
      throw new Error(`${clean} is already saved.`);
    }
    await tx.put({ ...current, name: clean, updatedAt: now });
    await tx.markDirty(id);
  });
}

export function deleteRosterPlayer(id: string, now = Date.now()): Promise<void> {
  return write(async (tx) => {
    const current = await tx.get(id);
    if (!current || current.deletedAt) return;
    await tx.put({ ...current, deletedAt: now, updatedAt: now });
    await tx.deletePhoto(id);
    await tx.markDirty(id);
  });
}

/** The saved photo for a player, or undefined when they have none on this device. */
export async function getRosterPhoto(id: string): Promise<PhotoData | undefined> {
  return (await db()).getPhoto(id);
}

/** Saves a photo for a player, and raises their photo version and photo sequence. */
export function setRosterPhoto(id: string, photo: PhotoData, now = Date.now()): Promise<void> {
  return write(async (tx) => {
    const current = await tx.get(id);
    if (!current || current.deletedAt) throw new Error('That player no longer exists.');
    await tx.put({ ...current, photoVersion: current.photoVersion + 1, photoSeq: current.photoSeq + 1, updatedAt: now });
    await tx.markDirty(id);
    // Last, on purpose: if the bytes cannot be stored, the player and the mark written above are rolled back.
    await tx.putPhoto(id, photo);
  });
}

/** Removes a player's photo and sets their photo version back to 0. The photo sequence stays where it is. */
export function removeRosterPhoto(id: string, now = Date.now()): Promise<void> {
  return write(async (tx) => {
    const current = await tx.get(id);
    if (!current || current.deletedAt || current.photoVersion === 0) return;
    await tx.deletePhoto(id);
    await tx.put({ ...current, photoVersion: 0, updatedAt: now });
    await tx.markDirty(id);
  });
}

export function markRosterPlayed(ids: string[], at: number): Promise<void> {
  return write(async (tx) => {
    for (const id of new Set(ids)) {
      const current = await tx.get(id);
      if (current && !current.deletedAt) {
        await tx.put({
          ...current,
          lastPlayedAt: Math.max(current.lastPlayedAt ?? 0, at),
          updatedAt: at,
        });
        await tx.markDirty(id);
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

// ---------------------------------------------------------------- for the sync engine

/** One player as stored, deleted or not. The list functions above hide deleted players. */
export async function getRosterEntry(id: string): Promise<RosterPlayer | undefined> {
  return (await db()).get(id);
}

/** The players with changes not yet pushed, in no particular order. */
export async function listOutbox(): Promise<OutboxEntry[]> {
  return (await (await db()).getOutbox()).sort((a, b) => a.playerId.localeCompare(b.playerId));
}

/** Call after pushing a player. The mark is removed only if the player has not changed since `rev` was read. */
export function ackOutbox(playerId: string, rev: number): Promise<void> {
  return serial(async () => (await db()).ackOutbox(playerId, rev));
}

/**
 * Marks every saved player, deleted ones too, as needing a push. For the first sign-in on a device, when
 * everything saved here has to reach the account. Returns how many players were marked.
 */
export function queueAllForSync(): Promise<number> {
  return write(async (tx) => {
    const all = await tx.getAll();
    for (const player of all) await tx.markDirty(player.id);
    return all.length;
  });
}

/** Small values the sync engine keeps between visits, such as the last pull time. */
export async function getSyncMeta(key: string): Promise<unknown> {
  return (await db()).getMeta(key);
}

export function setSyncMeta(key: string, value: unknown): Promise<void> {
  return serial(async () => (await db()).setMeta(key, value));
}
