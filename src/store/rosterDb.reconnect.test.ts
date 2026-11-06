import type { OpenDBCallbacks } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { opened } = vi.hoisted(() => ({
  opened: [] as Array<OpenDBCallbacks<never>>,
}));

vi.mock('idb', async (importOriginal) => {
  const real = await importOriginal<typeof import('idb')>();
  return {
    ...real,
    openDB: vi.fn((name: string, version: number, callbacks: OpenDBCallbacks<never>) => {
      opened.push(callbacks);
      return real.openDB(name, version, callbacks as never);
    }),
  };
});

import {
  addRosterPlayer,
  isRosterPersistent,
  listRoster,
  resetRosterDbForTests,
} from './rosterDb';

beforeEach(async () => {
  await resetRosterDbForTests();
  opened.length = 0;
});

describe('roster db connection recovery', () => {
  it('reuses one connection while it stays open', async () => {
    await addRosterPlayer('Ann');
    await listRoster();
    expect(opened).toHaveLength(1);
  });

  it('reopens after the browser terminates the connection', async () => {
    await addRosterPlayer('Ann');
    opened[0].terminated!();
    expect((await listRoster()).map((p) => p.name)).toEqual(['Ann']);
    await addRosterPlayer('Ben');
    expect(opened).toHaveLength(2);
    expect(isRosterPersistent()).toBe(true);
  });

  it('closes and reopens when another tab needs the database', async () => {
    await addRosterPlayer('Ann');
    opened[0].blocking!(1, null, new Event('versionchange') as never);
    expect((await listRoster()).map((p) => p.name)).toEqual(['Ann']);
    expect(opened).toHaveLength(2);
  });
});
