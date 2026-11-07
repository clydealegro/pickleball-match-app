import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Session } from '../engine';

/** How many finished sessions are kept. Older ones are dropped when a new one is saved. */
export const HISTORY_LIMIT = 100;

/** A finished session as kept for the Past sessions list. The whole session is kept, because the summary screen reads it. */
export interface HistoryEntry {
  id: string;
  name: string;
  createdAt: number;
  endedAt: number;
  /** How many games were finished, so the list does not need to open the session. */
  games: number;
  session: Session;
}

interface HistorySchema extends DBSchema {
  sessions: { key: string; value: HistoryEntry };
}

// A database of its own, so history can never get in the way of the saved players: their upgrade, their sync and
// their clear-this-device all stay exactly as they were.
const DB_NAME = 'pickleball-history';
const DB_VERSION = 1;

interface Backend {
  put(entry: HistoryEntry): Promise<void>;
  all(): Promise<unknown[]>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  close?(): void;
}

function idbBackend(database: IDBPDatabase<HistorySchema>): Backend {
  return {
    put: async (entry) => void (await database.put('sessions', entry)),
    all: () => database.getAll('sessions'),
    delete: (id) => database.delete('sessions', id),
    clear: () => database.clear('sessions'),
    close: () => database.close(),
  };
}

function memoryBackend(): Backend {
  const map = new Map<string, HistoryEntry>();
  return {
    put: async (entry) => void map.set(entry.id, entry),
    all: async () => [...map.values()],
    delete: async (id) => void map.delete(id),
    clear: async () => map.clear(),
  };
}

let backendPromise: Promise<Backend> | null = null;
let persistent = true;
let queue: Promise<unknown> = Promise.resolve();

async function openBackend(): Promise<Backend> {
  try {
    const database = await openDB<HistorySchema>(DB_NAME, DB_VERSION, {
      upgrade(d) {
        d.createObjectStore('sessions', { keyPath: 'id' });
      },
      // The browser closed the connection (for example iOS Safari when backgrounded): reopen on next use.
      terminated() {
        backendPromise = null;
      },
      blocking() {
        backendPromise = null;
      },
    });
    return idbBackend(database);
  } catch {
    // Private mode or blocked storage: history still works for this visit, but nothing is kept.
    persistent = false;
    return memoryBackend();
  }
}

function backend(): Promise<Backend> {
  backendPromise ??= openBackend();
  return backendPromise;
}

/** Runs one change at a time, so two saves can never trim each other's sessions. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** False once opening IndexedDB has failed: history then only lives in memory. */
export function isHistoryPersistent(): boolean {
  return persistent;
}

/** Test helper: closes and deletes the database, and clears the fallback state. */
export async function resetHistoryDbForTests(): Promise<void> {
  await queue.catch(() => undefined);
  if (backendPromise) (await backendPromise).close?.();
  backendPromise = null;
  persistent = true;
  queue = Promise.resolve();
  await deleteDB(DB_NAME);
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Anything stored that is not shaped like an entry (a bad write, a future format) is left out of the list. */
function isEntry(x: unknown): x is HistoryEntry {
  if (typeof x !== 'object' || x === null) return false;
  const e = x as Record<string, unknown>;
  const s = e.session as Record<string, unknown> | undefined;
  return (
    typeof e.id === 'string' &&
    typeof e.name === 'string' &&
    isNum(e.createdAt) &&
    isNum(e.endedAt) &&
    isNum(e.games) &&
    typeof s === 'object' &&
    s !== null &&
    Array.isArray(s.players) &&
    Array.isArray(s.history)
  );
}

/** The kept sessions, newest first. */
export async function listHistory(): Promise<HistoryEntry[]> {
  const rows = await serial(async () => (await backend()).all());
  return rows.filter(isEntry).sort((a, b) => b.endedAt - a.endedAt);
}

/**
 * Keeps a finished session. Returns true when it was written to storage that survives a restart, and false when it is
 * only in memory or the write failed. A session that has not ended is refused. The oldest sessions beyond the limit are
 * dropped.
 */
export function saveSessionToHistory(session: Session): Promise<boolean> {
  if (session.endedAt === undefined) return Promise.reject(new Error('Only a finished session can be kept.'));
  const entry: HistoryEntry = {
    id: session.id,
    name: session.name,
    createdAt: session.createdAt,
    endedAt: session.endedAt,
    games: session.history.length,
    session,
  };
  return serial(async () => {
    try {
      const b = await backend();
      await b.put(entry);
      const entries = (await b.all()).filter(isEntry).sort((a, c) => c.endedAt - a.endedAt);
      for (const old of entries.slice(HISTORY_LIMIT)) await b.delete(old.id);
      return persistent;
    } catch {
      return false;
    }
  });
}

/** Forgets every kept session. */
export function clearHistory(): Promise<void> {
  return serial(async () => (await backend()).clear());
}
