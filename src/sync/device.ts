import { IDBFactory } from 'fake-indexeddb';
import { vi } from 'vitest';

/**
 * A second copy of the app's local data and sync engine, for tests of two devices. Each device gets its own
 * IndexedDB and its own copy of the modules, so what one device saves is invisible to the other until it syncs.
 */
export async function createDevice() {
  const shared = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  const roster = await import('../store/rosterDb');
  const engine = await import('./engine');
  // Opens the database now, on this device's own IndexedDB.
  await roster.listRoster();
  globalThis.indexedDB = shared;
  return { roster, engine };
}

export type Device = Awaited<ReturnType<typeof createDevice>>;
