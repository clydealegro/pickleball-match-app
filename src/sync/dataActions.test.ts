// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addRosterPlayer,
  getSyncMeta,
  listOutbox,
  listRoster,
  resetRosterDbForTests,
  setRosterPhoto,
  setSyncMeta,
} from '../store/rosterDb';
import { clearHistory, listHistory, resetHistoryDbForTests, saveSessionToHistory } from '../store/historyDb';
import { USER_A, USER_B } from './db/harness';
import { clearThisDevice, deleteAllMyData, removeAllPhotoFiles, type DataActionDeps } from './dataActions';
import { createSession } from '../engine';
import { createFakeServer, type FakeServer } from './fakeServer';
import { RemoteError } from './remote';
import { ATTENDANCE_KEY, useAttendanceStore } from './attendance/store';

let server: FakeServer;
beforeAll(async () => {
  server = await createFakeServer();
});
afterAll(async () => {
  await server.close();
});

const jpeg = { type: 'image/jpeg', data: new Uint8Array([1, 2]).buffer };
const events: string[] = [];
const deps = (remote = server.remote(USER_A), over: Partial<DataActionDeps> = {}): DataActionDeps => ({
  server: () => ({ remote, userId: USER_A }),
  pause: async () => {
    events.push('pause');
    return () => events.push('resume');
  },
  syncNow: () => events.push('syncNow'),
  refresh: () => events.push('refresh'),
  batchSize: 2,
  purgeSession: () => true,
  ...over,
});
const count = async (user: string) =>
  Number(((await server.db.query('select count(*)::int as n from public.players where owner_id = $1', [user])).rows[0] as { n: number }).n);
const filesOf = (user: string) => [...server.files.keys()].filter((p) => p.startsWith(`${user}/`));

beforeEach(async () => {
  await resetRosterDbForTests();
  await resetHistoryDbForTests();
  await server.db.exec('truncate public.players cascade');
  server.files.clear();
  server.calls.length = 0;
  server.offline = false;
  events.length = 0;
  // The signed-in organizer: three players on the server (two with photos), and the same on this device.
  for (const [name, photos] of [['Ann', 2], ['Ben', 1], ['Cy', 0]] as const) {
    const local = await addRosterPlayer(name);
    if (photos > 0) await setRosterPhoto(local.id, jpeg);
    await server.db.query('insert into public.players (owner_id, id, name) values ($1, $2, $3)', [USER_A, local.id, name]);
    for (let seq = 1; seq <= photos; seq++) server.files.set(`${USER_A}/${local.id}/${seq}.jpg`, jpeg);
  }
  // Someone else's data, which must never be touched.
  await server.db.query("insert into public.players (owner_id, id, name) values ($1, 'b0000000-0000-4000-8000-000000000001', 'Zed')", [USER_B]);
  server.files.set(`${USER_B}/b0000000-0000-4000-8000-000000000001/1.jpg`, jpeg);
  await setSyncMeta('syncUser', USER_A);
});
afterEach(() => vi.restoreAllMocks());

const endedSession = () => {
  const ctx = { now: 1000, rng: () => 0.5, newId: () => 'hs1' };
  return { ...createSession({ name: 'Night', mode: 'fairness', courtCount: 1, players: [] }, ctx), endedAt: 2000 };
};

describe('past sessions and the data actions', () => {
  it('delete all my data forgets past sessions too', async () => {
    await saveSessionToHistory(endedSession());
    await deleteAllMyData(deps());
    expect(await listHistory()).toEqual([]);
  });

  it('clearing this device leaves past sessions alone', async () => {
    await saveSessionToHistory(endedSession());
    await clearThisDevice(deps());
    expect(await listHistory()).toHaveLength(1);
    await clearHistory();
  });
});

describe('deleting all my data', () => {
  it('removes every photo file and player from the account, then clears this device, and touches nobody else', async () => {
    expect(await deleteAllMyData(deps())).toEqual({ ok: true });
    expect(filesOf(USER_A)).toEqual([]);
    expect(await count(USER_A)).toBe(0);
    expect(filesOf(USER_B)).toHaveLength(1);
    expect(await count(USER_B)).toBe(1);
    expect(await listRoster()).toEqual([]);
    expect(await listOutbox()).toEqual([]);
    expect(await getSyncMeta('syncUser')).toBeUndefined();
  });

  it('pauses syncing first, tells the screens, and starts syncing again at the end', async () => {
    await deleteAllMyData(deps());
    expect(events).toEqual(['pause', 'refresh', 'resume']);
  });

  it('removes photo files in batches the Storage API accepts', async () => {
    await deleteAllMyData(deps());
    const removals = server.calls.filter((c) => c.startsWith('removePhotoFiles:')).map((c) => Number(c.split(':')[1]));
    expect(removals).toEqual([2, 1]); // three files, batches of two
  });

  it('removes files before the players, and the device last', async () => {
    await deleteAllMyData(deps());
    const order = server.calls.filter((c) => c.startsWith('removePhotoFiles') || c === 'deleteAllMyPlayers');
    expect(order.at(-1)).toBe('deleteAllMyPlayers');
  });

  it('keeps this device as it was, and says so, when there is no connection', async () => {
    server.offline = true;
    const result = await deleteAllMyData(deps());
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/no connection/i) });
    expect(await listRoster()).toHaveLength(3);
    expect(await getSyncMeta('syncUser')).toBe(USER_A);
    expect(events).toEqual(['pause', 'resume']);
  });

  it('keeps this device as it was when the server fails partway, and syncing starts again', async () => {
    const remote = { ...server.remote(USER_A), deleteAllMyPlayers: async () => Promise.reject(new RemoteError('server')) };
    const result = await deleteAllMyData(deps(remote));
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/couldn't finish deleting/i) });
    expect(await listRoster()).toHaveLength(3);
    expect(filesOf(USER_A)).toEqual([]); // already deleted, and the message says so
    expect(events).toEqual(['pause', 'resume']);
  });

  it('does nothing when nobody is signed in', async () => {
    const result = await deleteAllMyData(deps(undefined, { server: () => null }));
    expect(result).toMatchObject({ ok: false });
    expect(events).toEqual([]);
    expect(await listRoster()).toHaveLength(3);
  });

  it('lists a long list of players and folders without losing any', async () => {
    for (let i = 0; i < 205; i++) server.files.set(`${USER_A}/00000000-0000-4000-8000-${String(i).padStart(12, '0')}/1.jpg`, jpeg);
    await removeAllPhotoFiles(server.remote(USER_A), USER_A, 100);
    expect(filesOf(USER_A)).toEqual([]);
    expect(filesOf(USER_B)).toHaveLength(1);
  });
});

describe('clearing this device', () => {
  it('empties this device only, and asks for a sync afterwards', async () => {
    expect(await clearThisDevice(deps())).toEqual({ ok: true });
    expect(await listRoster()).toEqual([]);
    expect(await getSyncMeta('syncUser')).toBeUndefined();
    expect(await count(USER_A)).toBe(3);
    expect(filesOf(USER_A)).toHaveLength(3);
    expect(events).toEqual(['pause', 'refresh', 'resume', 'syncNow']);
  });

  it('works with nobody signed in', async () => {
    expect(await clearThisDevice(deps(undefined, { server: () => null }))).toEqual({ ok: true });
    expect(await listRoster()).toEqual([]);
  });

  it('says so, and starts syncing again, when the device cannot be cleared', async () => {
    const result = await clearThisDevice(
      deps(undefined, {
        refresh: () => {
          throw new Error('x');
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(events).toEqual(['pause', 'resume', 'syncNow']);
  });
});

describe('the attendance cache', () => {
  const memory = new Map<string, string>();
  beforeEach(() => {
    memory.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    });
    useAttendanceStore.setState({
      ownerId: USER_A,
      links: { tue: { code: 'abc' } },
      summaries: {},
      lastChange: {},
      lastError: {},
      pendingClose: [{ slotId: 'tue', date: '2026-11-10' }],
    });
    memory.set(ATTENDANCE_KEY, '{"version":1}');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useAttendanceStore.getState().clear();
  });
  const cleared = () => useAttendanceStore.getState().ownerId === null && Object.keys(useAttendanceStore.getState().links).length === 0;

  it('is cleared, with its queue, by delete all my data', async () => {
    expect(await deleteAllMyData(deps())).toEqual({ ok: true });
    expect(cleared()).toBe(true);
    expect(useAttendanceStore.getState().pendingClose).toEqual([]);
    expect(memory.has(ATTENDANCE_KEY)).toBe(false);
  });

  it('is cleared by clearing this device', async () => {
    expect(await clearThisDevice(deps())).toEqual({ ok: true });
    expect(cleared()).toBe(true);
    expect(useAttendanceStore.getState().pendingClose).toEqual([]);
    expect(memory.has(ATTENDANCE_KEY)).toBe(false);
  });

  it('is kept when delete all my data fails, because nothing on the device was removed', async () => {
    server.offline = true;
    await deleteAllMyData(deps());
    expect(cleared()).toBe(false);
    expect(memory.has(ATTENDANCE_KEY)).toBe(true);
  });
});

it('reports partial local deletion when history clearing fails', async () => {
  const result = await deleteAllMyData(deps(undefined, { clearPastSessions: async () => { throw new Error('storage failure'); } }));
  expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/Some data on this device/) });
  expect(await listRoster()).toEqual([]);
});
