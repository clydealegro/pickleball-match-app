# Sync Screens Implementation Plan (Plan 3B3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the organizer what the sync engine is doing and give them control of their data: a sync status line, a sign-in banner, "Delete all my data", a way out when another account's players are on the device, and a message when a database upgrade is stuck behind another tab.

**Architecture:** Small, separate pieces. `describe.ts` turns the sign-in and sync states into one sentence. `dataActions.ts` holds the two data actions (delete everything, clear this device), each pausing sync first. The roster database gains `clearRosterData` and a "blocked" flag. The screens only read stores and call those actions.

**Tech Stack:** TypeScript, React 18, Zustand 5, Vitest 3 with Testing Library, `fake-indexeddb` and `@electric-sql/pglite`. No new dependency.

**Roadmap:** Plans 3A, 3B1 and 3B2 are live. **Plan 3B3 is this plan** and finishes Plan 3. What stays outside it is listed under "Known limits" at the end.

**Follow-ups this plan absorbs:** from the end of the Plan 3B2 plan and the review notes: the status line, the banner, "Delete all my data" (files through the Storage API in batches of 1000, then `delete_my_players()`, then clear the device), the exit from the "another account" state, the message for a blocked upgrade, and listing a folder of more than 100 files.

---

## Decisions made while planning

1. **One line, one function.** `syncLine` decides the words, so the Saved players header and Settings can never disagree. The words follow the spec without its em dashes: "Signed out", "Synced", "Syncing…", "Offline, 3 changes waiting", "Can't reach server, will retry". A round that left changes waiting says "Syncing…" because another round follows straight away; so does the moment between sign-in and the first round. A sign-in that was not accepted and a device holding another account's players each get their own sentence.
2. **The banner waits for something to back up.** It shows on Setup only when the organizer is signed out (not while a link is on its way, not while the sign-in is being checked, not without a backend), has at least one saved player, and has not dismissed it. "Not now" is remembered on this device. "Sign in" opens Settings.
3. **Settings gets a "Your data" card.** "Clear saved players on this device" is there whenever the sign-in is not still loading; "Delete all my data" only when signed in. Both ask first with the browser's own confirm box, as removing a single player does. Both are disabled while one runs, say "Working…", and report how it ended.
4. **Delete all my data goes files, rows, device, in that order, with sync paused.** The coordinator's new `pauseSync` stops the runner and waits for a round already running (a round in flight would otherwise push rows back mid-delete). The photo files go first, found by listing the account's folder and then each player's folder, removed in batches of 1000 (the most the Storage API takes). Then the database function deletes the rows. The device is cleared last, so a failure at any point leaves this device's players where they are, and the action can simply be repeated: what was already deleted stays deleted, and the message says so.
5. **Clearing this device is the way out of "another account".** It empties the device only and then asks for a sync straight away. The record of which account the device belongs to goes with it, so the next round adopts the account now signed in and pulls its players. The account whose players were cleared is not touched. Settings says all this when the state arises.
6. **A blocked upgrade is reported by the browser, so no timeout is needed.** The Plan 2 review suggested a five second timer. The browser's own `blocked` event fires when another tab holds the old database open, so the database layer now records it, the roster store exposes `blocked`, and the app shows "Close other tabs of this app to load your saved players" until the other tab lets go.
7. **Listing is paged.** The adapter lists a folder 100 names at a time until a short page comes back, which an account with more than 100 players needs for the purge.
8. **The revision counter survives a clear.** `clearRosterData` removes everything but `outboxRev`, so a revision is still never reused.

## Conventions

- Tests first: a task writes its tests, runs them to see them fail, then makes them pass.
- No em dashes in any text you write. Commit messages are plain: no tool names, no co-author lines.
- Run commands from the project root.
- `npm test` runs every test once. Before this plan it reports 426 passing.

## Rollout

Everything here is on screen, so a visitor sees it. A signed-out visitor with saved players sees the banner once. A signed-in organizer sees the status line. "Delete all my data" cannot be undone, so Task 7 does not run it on a real roster unless you decide to: it is tested end to end against the real database rules and the real client library, and Task 7 checks everything else, including clearing a device and getting its players back from the account.

## File structure

| File | What changes |
|---|---|
| `src/store/rosterDb.ts`, `rosterStore.ts` | `clearRosterData`, the blocked flag and the store's `blocked` |
| `src/store/rosterDb.clear.test.ts`, `rosterDb.blocked.test.ts`, `rosterDb.fallback.test.ts` | Tests for those |
| `src/sync/remote.ts`, `remote.test.ts`, `remote.wire.test.ts` | `deleteAllMyPlayers`, a paged folder listing |
| `src/sync/fakeServer.ts`, `coordinator.test.ts` | The test server and stub learn the new call |
| `src/sync/runner.ts`, `runner.test.ts`, `coordinator.ts` | `idle`, `pauseSync`, `syncNow`, and their tests |
| `src/sync/dataActions.ts`, `dataActions.test.ts` | Delete all my data, clear this device |
| `src/sync/describe.ts`, `describe.test.ts` | The sync sentence |
| `src/ui/SyncStatusLine.tsx`, `SignInBanner.tsx` | New components |
| `src/ui/SavedPlayersScreen.tsx`, `SettingsScreen.tsx`, `App.tsx` | Use them; the "Your data" card; the blocked notice |
| `src/ui/syncUi.test.tsx`, `syncWiring.test.tsx` | Screen tests |
| `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md` | Three spec lines brought in line |

### Task 1: Local data: clear a device, and know when an upgrade is blocked

Two small things the screens need from the roster database. `clearRosterData` empties the device (keeping only the revision counter, so a revision is still never reused). The "blocked" flag records that a database upgrade is waiting for another tab, and the roster store passes it on.

**Files:**
- Create: `src/store/rosterDb.clear.test.ts`, `src/store/rosterDb.blocked.test.ts`
- Modify: `src/store/rosterDb.fallback.test.ts`, `src/store/rosterDb.ts`, `src/store/rosterStore.ts`

- [ ] **Step 1: Tests for clearing a device**

  Create `src/store/rosterDb.clear.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addRosterPlayer,
  clearRosterData,
  getRosterEntry,
  getRosterPhoto,
  getSyncMeta,
  listOutbox,
  listRoster,
  resetRosterDbForTests,
  setRosterPhoto,
  setSyncMeta,
} from './rosterDb';

beforeEach(async () => {
  await resetRosterDbForTests();
});

describe('clearing this device', () => {
  it('removes every player, photo, mark and sync value', async () => {
    const ann = await addRosterPlayer('Ann');
    await setRosterPhoto(ann.id, { type: 'image/jpeg', data: new Uint8Array([1]).buffer });
    await setSyncMeta('syncUser', 'u1');
    await setSyncMeta('syncCursor', 'c1');
    await clearRosterData();
    expect(await listRoster()).toEqual([]);
    expect(await getRosterEntry(ann.id)).toBeUndefined();
    expect(await getRosterPhoto(ann.id)).toBeUndefined();
    expect(await listOutbox()).toEqual([]);
    expect(await getSyncMeta('syncUser')).toBeUndefined();
    expect(await getSyncMeta('syncCursor')).toBeUndefined();
  });

  it('keeps the revision counter, so a revision is still never reused', async () => {
    await addRosterPlayer('Ann');
    await addRosterPlayer('Ben');
    await clearRosterData();
    const cy = await addRosterPlayer('Cy');
    expect(await listOutbox()).toEqual([{ playerId: cy.id, rev: 3 }]);
  });

  it('is fine on an empty database, and the app keeps working after it', async () => {
    await clearRosterData();
    await clearRosterData();
    await addRosterPlayer('Ann');
    expect((await listRoster()).map((p) => p.name)).toEqual(['Ann']);
  });
});
```

- [ ] **Step 2: Tests for a blocked upgrade**

  Create `src/store/rosterDb.blocked.test.ts`:

```ts
import { openDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isRosterBlocked,
  listRoster,
  resetRosterDbForTests,
  subscribeRosterBlocked,
} from './rosterDb';
import { useRosterStore } from './rosterStore';

const DB_NAME = 'pickleball-roster';

beforeEach(async () => {
  await resetRosterDbForTests();
});

describe('an upgrade that waits for another tab', () => {
  it('says so while the old tab holds on, and stops saying so when it lets go', async () => {
    // An old tab (version 2) that does not close its connection when asked.
    const oldTab = await openDB(DB_NAME, 2, {
      upgrade(d) {
        d.createObjectStore('players', { keyPath: 'id' });
        d.createObjectStore('photos', { keyPath: 'id' });
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const heard = vi.fn();
    const stop = subscribeRosterBlocked(heard);

    expect(isRosterBlocked()).toBe(false);
    const loading = listRoster();
    await vi.waitFor(() => expect(isRosterBlocked()).toBe(true));
    expect(heard).toHaveBeenCalledTimes(1);

    oldTab.close();
    expect(await loading).toEqual([]);
    expect(isRosterBlocked()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);

    stop();
    warn.mockRestore();
  });

  it('is not blocked in the ordinary case, and tells no one when nothing changed', async () => {
    const heard = vi.fn();
    const stop = subscribeRosterBlocked(heard);
    await listRoster();
    expect(isRosterBlocked()).toBe(false);
    expect(heard).not.toHaveBeenCalled();
    stop();
  });

  it('reaches the roster store, so the app can tell the organizer', async () => {
    const oldTab = await openDB(DB_NAME, 2, {
      upgrade(d) {
        d.createObjectStore('players', { keyPath: 'id' });
        d.createObjectStore('photos', { keyPath: 'id' });
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(useRosterStore.getState().blocked).toBe(false);
    const loading = useRosterStore.getState().load();
    await vi.waitFor(() => expect(useRosterStore.getState().blocked).toBe(true));
    oldTab.close();
    await loading;
    expect(useRosterStore.getState().blocked).toBe(false);
    warn.mockRestore();
  });
});
```

- [ ] **Step 3: The fallback tests import the new function**

  In `src/store/rosterDb.fallback.test.ts`, replace:

```ts
  addRosterPlayer,
  getRosterEntry,
```

  with:

```ts
  addRosterPlayer,
  clearRosterData,
  getRosterEntry,
```

- [ ] **Step 4: A test that the fallback clears too**

  In `src/store/rosterDb.fallback.test.ts`, replace:

```ts
  it('starts fresh after a reset'
```

  with:

```ts
  it('clears everything in memory too', async () => {
    await addRosterPlayer('Ann');
    await setSyncMeta('syncUser', 'u1');
    await clearRosterData();
    expect(await listRoster()).toEqual([]);
    expect(await listOutbox()).toEqual([]);
    expect(await getSyncMeta('syncUser')).toBeUndefined();
  });

  it('starts fresh after a reset'
```

- [ ] **Step 5: Watch them fail**

  Run:

```bash
npx vitest run src/store/rosterDb.clear.test.ts src/store/rosterDb.blocked.test.ts src/store/rosterDb.fallback.test.ts
```

  Expected: The summary reads `Tests  7 failed | 8 passed (15)`. The new tests fail because `clearRosterData`, `isRosterBlocked` and the store's `blocked` do not exist yet.

- [ ] **Step 6: The storage interface can clear everything**

  In `src/store/rosterDb.ts`, replace:

```ts
  setMeta(key: string, value: unknown): Promise<void>;
  close?(): void;
}
```

  with:

```ts
  setMeta(key: string, value: unknown): Promise<void>;
  /** Removes every player, photo, mark and sync value, keeping only the revision counter. */
  clear(): Promise<void>;
  close?(): void;
}
```

- [ ] **Step 7: Clear the database**

  In `src/store/rosterDb.ts`, replace:

```ts
    async setMeta(key, value) {
      if (database.objectStoreNames.contains('syncMeta')) await database.put('syncMeta', value, key);
    },
    close: () => database.close(),
```

  with:

```ts
    async setMeta(key, value) {
      if (database.objectStoreNames.contains('syncMeta')) await database.put('syncMeta', value, key);
    },
    async clear() {
      const names = STORES.filter((name) => database.objectStoreNames.contains(name));
      const tx = database.transaction(names, 'readwrite');
      // The revision counter stays, so a revision is still never reused.
      const rev = names.includes('syncMeta') ? await tx.objectStore('syncMeta').get(REV_KEY) : undefined;
      for (const name of names) await tx.objectStore(name).clear();
      if (rev !== undefined) await tx.objectStore('syncMeta').put(rev, REV_KEY);
      await tx.done;
    },
    close: () => database.close(),
```

- [ ] **Step 8: Clear the in-memory fallback**

  In `src/store/rosterDb.ts`, replace:

```ts
    setMeta: async (key, value) => {
      meta.set(key, value);
    },
  };
}
```

  with:

```ts
    setMeta: async (key, value) => {
      meta.set(key, value);
    },
    clear: async () => {
      map.clear();
      photos.clear();
      outbox.clear();
      meta.clear();
    },
  };
}
```

- [ ] **Step 9: Remember whether an upgrade is waiting for another tab**

  In `src/store/rosterDb.ts`, replace:

```ts
let backendPromise: Promise<Backend> | null = null;
let persistent = true;
```

  with:

```ts
let backendPromise: Promise<Backend> | null = null;
let persistent = true;
let upgradeBlocked = false;
const blockedListeners = new Set<() => void>();

function setBlocked(value: boolean) {
  if (upgradeBlocked === value) return;
  upgradeBlocked = value;
  blockedListeners.forEach((listener) => listener());
}

/** True while a database upgrade waits for another tab of this app to let go, so saved players cannot load yet. */
export function isRosterBlocked(): boolean {
  return upgradeBlocked;
}

/** Calls `listener` when `isRosterBlocked` changes. Returns a function that stops listening. */
export function subscribeRosterBlocked(listener: () => void): () => void {
  blockedListeners.add(listener);
  return () => {
    blockedListeners.delete(listener);
  };
}
```

- [ ] **Step 10: Say so when the upgrade is blocked**

  In `src/store/rosterDb.ts`, replace:

```ts
    blocked() {
      console.warn('Saved players are waiting for another tab of this app to close its connection.');
    },
```

  with:

```ts
    blocked() {
      console.warn('Saved players are waiting for another tab of this app to close its connection.');
      setBlocked(true);
    },
```

- [ ] **Step 11: ...and when it is not any more**

  In `src/store/rosterDb.ts`, replace:

```ts
    return idbBackend(database);
  } catch {
    // Private mode or blocked storage: keep working for this visit, without saving.
    persistent = false;
```

  with:

```ts
    setBlocked(false);
    return idbBackend(database);
  } catch {
    // Private mode or blocked storage: keep working for this visit, without saving.
    setBlocked(false);
    persistent = false;
```

- [ ] **Step 12: A test reset clears it**

  In `src/store/rosterDb.ts`, replace:

```ts
  persistent = true;
  queue = Promise.resolve();
  await deleteDB(DB_NAME);
```

  with:

```ts
  persistent = true;
  upgradeBlocked = false;
  queue = Promise.resolve();
  await deleteDB(DB_NAME);
```

- [ ] **Step 13: Let the sync actions clear this device**

  In `src/store/rosterDb.ts`, replace:

```ts
export function setSyncMeta(key: string, value: unknown): Promise<void> {
  return serial(async () => (await db()).setMeta(key, value));
}
```

  with:

```ts
export function setSyncMeta(key: string, value: unknown): Promise<void> {
  return serial(async () => (await db()).setMeta(key, value));
}

/**
 * Removes every saved player, photo, mark and sync value from this device. Nothing is pushed, so an account the
 * players were backed up to is untouched. Only the revision counter is kept.
 */
export function clearRosterData(): Promise<void> {
  return serial(async () => (await db()).clear());
}
```

- [ ] **Step 14: The roster store learns about a blocked upgrade (import)**

  In `src/store/rosterStore.ts`, replace:

```ts
  isRosterPersistent,
  listRoster,
```

  with:

```ts
  isRosterBlocked,
  isRosterPersistent,
  listRoster,
  subscribeRosterBlocked,
```

- [ ] **Step 15: ...its state**

  In `src/store/rosterStore.ts`, replace:

```ts
  persistent: boolean;
  load: () => Promise<void>;
```

  with:

```ts
  persistent: boolean;
  /** True while another tab of the app keeps saved players from loading (a database upgrade is waiting for it). */
  blocked: boolean;
  load: () => Promise<void>;
```

- [ ] **Step 16: ...and its wiring**

  In `src/store/rosterStore.ts`, replace:

```ts
    set({ players, loaded: true, persistent: isRosterPersistent() });
  };
  return {
    players: [],
    loaded: false,
    persistent: true,
```

  with:

```ts
    set({ players, loaded: true, persistent: isRosterPersistent() });
  };
  subscribeRosterBlocked(() => set({ blocked: isRosterBlocked() }));
  return {
    players: [],
    loaded: false,
    persistent: true,
    blocked: false,
```

- [ ] **Step 17: Run them again**

  Run:

```bash
npx vitest run src/store
```

  Expected: every test in `src/store` passes. The summary reads `Tests  105 passed (105)`.

- [ ] **Step 18: Typecheck**

  Run:

```bash
npm run typecheck
```

  Expected: nothing is printed after the `tsc --noEmit` line.

- [ ] **Step 19: Commit**

```bash
git add src/store/rosterDb.ts src/store/rosterStore.ts src/store/rosterDb.clear.test.ts src/store/rosterDb.blocked.test.ts src/store/rosterDb.fallback.test.ts
git commit -m "feat: clear this device, and know when a database upgrade waits for another tab"
```


### Task 2: The server adapter can delete everything and list long folders

"Delete all my data" needs the database function `delete_my_players()` (Plan 3A) and a way to list every player folder of the account, which can be more than the 100 names one request returns. The stand-in server and the coordinator test's stub learn the new call too.

**Files:**
- Modify: `src/sync/remote.test.ts`, `src/sync/remote.wire.test.ts`, `src/sync/fakeServer.ts`, `src/sync/coordinator.test.ts`
- Modify: `src/sync/remote.ts`

- [ ] **Step 1: The fake client can answer a function call**

  In `src/sync/remote.test.ts`, replace:

```ts
function fakeClient(replies: { table?: (ops: string[]) => Reply; storage?: Record<string, Reply | (() => Reply)> }) {
```

  with:

```ts
function fakeClient(replies: {
  table?: (ops: string[]) => Reply;
  storage?: Record<string, Reply | (() => Reply)>;
  rpc?: Reply;
}) {
```

- [ ] **Step 2: ...and records it**

  In `src/sync/remote.test.ts`, replace:

```ts
  return { client: { from, storage } as unknown as SupabaseClient, calls, storageCalls };
```

  with:

```ts
  const rpc = vi.fn(async (name: string) => {
    calls.push(`rpc(${name})`);
    return { data: replies.rpc?.data ?? null, error: replies.rpc?.error ?? null, status: replies.rpc?.status ?? 200 };
  });
  return { client: { from, storage, rpc } as unknown as SupabaseClient, calls, storageCalls };
```

- [ ] **Step 3: A listing is read a page at a time**

  In `src/sync/remote.test.ts`, replace:

```ts
    expect(storageCalls[0].args).toEqual([`${OWNER}/p1`, { limit: 100 }]);
    const bad = fakeClient({ storage: { list: { error: { status: 500, message: 'x' } } } });
    expect(await kind(supabaseRemote(bad.client, OWNER).listPhotoFiles('x'))).toBe('server');
  });
```

  with:

```ts
    expect(storageCalls[0].args).toEqual([`${OWNER}/p1`, { limit: 100, offset: 0 }]);
    const bad = fakeClient({ storage: { list: { error: { status: 500, message: 'x' } } } });
    expect(await kind(supabaseRemote(bad.client, OWNER).listPhotoFiles('x'))).toBe('server');
  });

  it('keeps listing while a page is full, so a long folder is read whole', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ name: `${i}.jpg` }));
    let page = 0;
    const { client, storageCalls } = fakeClient({ storage: { list: () => ({ data: page++ === 0 ? full : [{ name: 'last.jpg' }] }) } });
    expect(await supabaseRemote(client, OWNER).listPhotoFiles('x')).toHaveLength(101);
    expect(storageCalls.map((c) => (c.args[1] as { offset: number }).offset)).toEqual([0, 100]);
  });

  it('deletes all players by calling the database function', async () => {
    const { client, calls } = fakeClient({});
    await supabaseRemote(client, OWNER).deleteAllMyPlayers();
    expect(calls).toEqual(['rpc(delete_my_players)']);
    const bad = fakeClient({ rpc: { error: { message: 'boom' }, status: 500 } });
    expect(await kind(supabaseRemote(bad.client, OWNER).deleteAllMyPlayers())).toBe('server');
    const offline = fakeClient({ rpc: { error: { message: 'Failed to fetch' }, status: 0 } });
    expect(await kind(supabaseRemote(offline.client, OWNER).deleteAllMyPlayers())).toBe('offline');
  });
```

- [ ] **Step 4: The fake server lists a folder like the real one: its direct children**

  In `src/sync/fakeServer.ts`, replace:

```ts
          return [...server.files.keys()].filter((p) => p.startsWith(`${folder}/`)).map((p) => p.slice(folder.length + 1));
```

  with:

```ts
          const children = [...server.files.keys()].filter((p) => p.startsWith(`${folder}/`)).map((p) => p.slice(folder.length + 1).split('/')[0]);
          return [...new Set(children)];
```

- [ ] **Step 5: ...and deletes all players through the real function**

  In `src/sync/fakeServer.ts`, replace:

```ts
        async removePhotoFiles(paths) {
          guard(`removePhotoFiles:${paths.length}`);
          for (const path of paths) server.files.delete(path);
        },
```

  with:

```ts
        async removePhotoFiles(paths) {
          guard(`removePhotoFiles:${paths.length}`);
          for (const path of paths) server.files.delete(path);
        },
        async deleteAllMyPlayers() {
          guard('deleteAllMyPlayers');
          await run(db, { user }, 'select public.delete_my_players()');
        },
```

- [ ] **Step 6: The coordinator test server can delete all players**

  In `src/sync/coordinator.test.ts`, replace:

```ts
    removePhotoFiles: async () => undefined,
  };
```

  with:

```ts
    removePhotoFiles: async () => undefined,
    deleteAllMyPlayers: async () => undefined,
  };
```

- [ ] **Step 7: The real client sends the folder listing page and the delete-all call**

  In `src/sync/remote.wire.test.ts`, replace:

```ts
    expect(JSON.parse(seen[0].body as string)).toMatchObject({ prefix: 'x/y', limit: 100 });
```

  with:

```ts
    expect(JSON.parse(seen[0].body as string)).toMatchObject({ prefix: 'x/y', limit: 100, offset: 0 });
```

- [ ] **Step 8: ...and deletes all players with a database function call**

  In `src/sync/remote.wire.test.ts`, replace:

```ts
  it('turns a dropped connection into an offline error', async () => {
```

  with:

```ts
  it('deletes all players by calling the database function', async () => {
    reply = () => json(200, 3);
    await realClient().deleteAllMyPlayers();
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url.pathname).toBe('/rest/v1/rpc/delete_my_players');
  });

  it('turns a dropped connection into an offline error', async () => {
```

- [ ] **Step 9: Watch them fail**

  Run:

```bash
npx vitest run src/sync/remote.test.ts src/sync/remote.wire.test.ts
```

  Expected: The summary reads `Tests  4 failed | 23 passed (27)`. The new tests for `deleteAllMyPlayers` and for the paged listing fail.

- [ ] **Step 10: The server can delete all of an organizer's players**

  In `src/sync/remote.ts`, replace:

```ts
  removePhotoFiles(paths: string[]): Promise<void>;
}
```

  with:

```ts
  removePhotoFiles(paths: string[]): Promise<void>;
  /** Deletes every one of this organizer's players, deleted ones included. Photo files are removed separately. */
  deleteAllMyPlayers(): Promise<void>;
}
```

- [ ] **Step 11: A folder can hold more files than one request lists**

  In `src/sync/remote.ts`, replace:

```ts
const PAGE = 500;
```

  with:

```ts
const PAGE = 500;
/** A file listing is read this many names at a time. */
const LIST_PAGE = 100;
```

- [ ] **Step 12: Read a whole folder**

  In `src/sync/remote.ts`, replace:

```ts
    async listPhotoFiles(folder) {
      const { data, error } = await bucket().list(folder, { limit: 100 });
      if (error) fail(error as Failure);
      return data.map((file) => file.name);
    },
```

  with:

```ts
    async listPhotoFiles(folder) {
      const names: string[] = [];
      for (let offset = 0; ; offset += LIST_PAGE) {
        const { data, error } = await bucket().list(folder, { limit: LIST_PAGE, offset });
        if (error) fail(error as Failure);
        names.push(...data.map((file) => file.name));
        if (data.length < LIST_PAGE) return names;
      }
    },
```

- [ ] **Step 13: Delete all players through the database function**

  In `src/sync/remote.ts`, replace:

```ts
      const { error } = await bucket().remove(paths);
      if (error) fail(error as Failure);
    },
  };
```

  with:

```ts
      const { error } = await bucket().remove(paths);
      if (error) fail(error as Failure);
    },
    async deleteAllMyPlayers() {
      // The function deletes only the caller's own rows (see the migration).
      const { error, status } = await client.rpc('delete_my_players');
      if (error) fail(error, status);
    },
  };
```

- [ ] **Step 14: Run the sync tests**

  Run:

```bash
npx vitest run src/sync
```

  Expected: every test in `src/sync` passes. The summary reads `Tests  171 passed (171)`.

- [ ] **Step 15: Typecheck**

  Run:

```bash
npm run typecheck
```

  Expected: nothing is printed after the `tsc --noEmit` line.

- [ ] **Step 16: Commit**

```bash
git add src/sync/remote.ts src/sync/remote.test.ts src/sync/remote.wire.test.ts src/sync/fakeServer.ts src/sync/coordinator.test.ts
git commit -m "feat: the server adapter can delete all players and list long folders"
```


### Task 3: Pause sync while the data is deleted

Deleting while a round pushes would put rows back. The runner can now say when its round has finished (`idle`), and the coordinator offers `pauseSync` (stop, wait for the round in flight, give back a way to resume) and `syncNow`.

**Files:**
- Modify: `src/sync/runner.test.ts`, `src/sync/coordinator.test.ts`
- Modify: `src/sync/runner.ts`, `src/sync/coordinator.ts`

- [ ] **Step 1: The runner reports when its round has finished**

  In `src/sync/runner.test.ts`, replace:

```ts
  it('cancels a round that was planned but has not started when it stops', async () => {
```

  with:

```ts
  it('says when the round in flight has finished, even after a stop', async () => {
    const { runner, release } = setup([ok()], { hold: true });
    await runner.idle(); // nothing running yet
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.stop();
    let finished = false;
    void runner.idle().then(() => (finished = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(false);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(true);
  });

  it('cancels a round that was planned but has not started when it stops', async () => {
```

- [ ] **Step 2: The coordinator test imports what it now offers**

  In `src/sync/coordinator.test.ts`, replace:

```ts
import { startSyncCoordinator, type CoordinatorDeps } from './coordinator';
```

  with:

```ts
import { pauseSync, startSyncCoordinator, syncNow, type CoordinatorDeps } from './coordinator';
```

- [ ] **Step 3: Tests for pausing and nudging**

  In `src/sync/coordinator.test.ts`, replace:

```ts
  it('takes back every listener it added when it is stopped', () => {
```

  with:

```ts
  it('can be paused, waits for a round in flight, and starts again when resumed', async () => {
    signIn('u1');
    start();
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
    let finishRound: (() => void) | undefined;
    stub.remote.pull = () => new Promise<unknown[]>((resolve) => (finishRound = () => resolve([])));
    syncNow();
    await vi.waitFor(() => expect(finishRound).toBeDefined());

    let paused = false;
    const resume = await Promise.race([
      pauseSync().then((r) => {
        paused = true;
        return r;
      }),
      new Promise<undefined>((r) => setTimeout(() => r(undefined), 30)),
    ]);
    expect(resume).toBeUndefined(); // still waiting for the round
    expect(paused).toBe(false);
    finishRound?.();
    await vi.waitFor(() => expect(paused).toBe(true));
    expect(useSyncStore.getState().status).toBe('off');

    const pullsBefore = stub.pulls();
    await addRosterPlayer('Zed');
    signIn('u1'); // a sign-in change while paused does not start anything
    await new Promise((r) => setTimeout(r, 40));
    expect(stub.pulls()).toBe(pullsBefore);
    expect(stub.upserts).not.toContain('Zed');

    stub.remote.pull = async () => [];
    const again = await pauseSync(); // pausing twice is harmless
    again();
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
    expect(stub.upserts).toContain('Zed');
  });

  it('does nothing to pause, resume or nudge when it is not running, even after it has run', async () => {
    const resume = await pauseSync();
    resume();
    syncNow();
    expect(useSyncStore.getState().status).toBe('off');

    start();
    stop?.();
    stop = undefined;
    signIn('u1');
    (await pauseSync())();
    syncNow();
    await new Promise((r) => setTimeout(r, 40));
    expect(makeRemote).not.toHaveBeenCalled();
    expect(useSyncStore.getState().status).toBe('off');
  });

  it('takes back every listener it added when it is stopped', () => {
```

- [ ] **Step 4: Watch them fail**

  Run:

```bash
npx vitest run src/sync/runner.test.ts src/sync/coordinator.test.ts
```

  Expected: The summary reads `Tests  3 failed | 25 passed (28)`. The new tests for `idle`, `pauseSync` and `syncNow` fail.

- [ ] **Step 5: The runner can say when its round has finished**

  In `src/sync/runner.ts`, replace:

```ts
  /** Asks for a round soon: after `delayMs`, and straight away when the connection comes back. */
  poke(delayMs?: number): void;
}
```

  with:

```ts
  /** Asks for a round soon: after `delayMs`, and straight away when the connection comes back. */
  poke(delayMs?: number): void;
  /** Resolves when no round is running, straight away if none is. A stopped runner's last round still finishes. */
  idle(): Promise<void>;
}
```

- [ ] **Step 6: ...by remembering the round in flight**

  In `src/sync/runner.ts`, replace:

```ts
  let generation = 0;
```

  with:

```ts
  let generation = 0;
  let inFlight: Promise<void> = Promise.resolve();
```

- [ ] **Step 7: ...when it starts one**

  In `src/sync/runner.ts`, replace:

```ts
    try {
      result = await run();
    } catch (error) {
```

  with:

```ts
    try {
      const call = run();
      inFlight = call.then(
        () => undefined,
        () => undefined,
      );
      result = await call;
    } catch (error) {
```

- [ ] **Step 8: ...and reporting it**

  In `src/sync/runner.ts`, replace:

```ts
    poke(delayMs = debounceMs) {
      if (!active) return;
      if (running) again = true;
      else schedule(delayMs);
    },
  };
```

  with:

```ts
    poke(delayMs = debounceMs) {
      if (!active) return;
      if (running) again = true;
      else schedule(delayMs);
    },
    idle: () => inFlight,
  };
```

- [ ] **Step 9: The coordinator can be paused and nudged**

  In `src/sync/coordinator.ts`, replace:

```ts
/**
 * Keeps one sync runner going while an organizer is signed in, and none otherwise.
```

  with:

```ts
/** What the running coordinator offers the rest of the app. Null when none is running. */
let control: { pause(): Promise<void>; resume(): void; syncNow(): void } | null = null;

/**
 * Stops syncing and waits for a round already running to finish, so nothing is pushed or pulled while something else
 * (deleting all data) changes the account or the device. Call the function it returns to start syncing again.
 */
export async function pauseSync(): Promise<() => void> {
  const current = control;
  if (!current) return () => undefined;
  await current.pause();
  return () => current.resume();
}

/** Asks for a round straight away (after the device was cleared, say). Does nothing when not signed in. */
export function syncNow(): void {
  control?.syncNow();
}

/**
 * Keeps one sync runner going while an organizer is signed in, and none otherwise.
```

- [ ] **Step 10: ...and not follow the sign-in store while paused**

  In `src/sync/coordinator.ts`, replace:

```ts
  let lastRoundAt = 0;

  function follow() {
    const { status, userId } = deps.auth.getState();
```

  with:

```ts
  let lastRoundAt = 0;
  let paused = false;

  function follow() {
    if (paused) return;
    const { status, userId } = deps.auth.getState();
```

- [ ] **Step 11: ...and register what it offers**

  In `src/sync/coordinator.ts`, replace:

```ts
  const stopFollowing = deps.auth.subscribe(follow);
```

  with:

```ts
  control = {
    async pause() {
      paused = true;
      const stopping = runner;
      stopping?.stop();
      runner = null;
      runnerUser = null;
      useSyncStore.setState({ status: 'off', pending: 0 });
      await stopping?.idle();
    },
    resume() {
      paused = false;
      follow();
    },
    syncNow: () => runner?.poke(0),
  };
  const stopFollowing = deps.auth.subscribe(follow);
```

- [ ] **Step 12: ...and withdraw it when stopped**

  In `src/sync/coordinator.ts`, replace:

```ts
  return () => {
    stopFollowing();
```

  with:

```ts
  return () => {
    control = null;
    stopFollowing();
```

- [ ] **Step 13: Run them again**

  Run:

```bash
npx vitest run src/sync/runner.test.ts src/sync/coordinator.test.ts
```

  Expected: every test passes. The summary reads `Tests  28 passed (28)`.

- [ ] **Step 14: Typecheck**

  Run:

```bash
npm run typecheck
```

  Expected: nothing is printed after the `tsc --noEmit` line.

- [ ] **Step 15: Commit**

```bash
git add src/sync/runner.ts src/sync/runner.test.ts src/sync/coordinator.ts src/sync/coordinator.test.ts
git commit -m "feat: pause sync while data is deleted"
```


### Task 4: The two data actions, and the sync sentence

`dataActions.ts` is the logic behind the two buttons, tested against the real database rules and a second organizer whose data must not be touched. `describe.ts` is the one place that decides the words of the sync line.

**Files:**
- Create: `src/sync/dataActions.ts`, `src/sync/dataActions.test.ts`
- Create: `src/sync/describe.ts`, `src/sync/describe.test.ts`

- [ ] **Step 1: Tests for the data actions**

  Create `src/sync/dataActions.test.ts`:

```ts
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
import { USER_A, USER_B } from './db/harness';
import { clearThisDevice, deleteAllMyData, removeAllPhotoFiles, type DataActionDeps } from './dataActions';
import { createFakeServer, type FakeServer } from './fakeServer';
import { RemoteError } from './remote';

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
  ...over,
});
const count = async (user: string) =>
  Number(((await server.db.query('select count(*)::int as n from public.players where owner_id = $1', [user])).rows[0] as { n: number }).n);
const filesOf = (user: string) => [...server.files.keys()].filter((p) => p.startsWith(`${user}/`));

beforeEach(async () => {
  await resetRosterDbForTests();
  await server.db.exec('truncate public.players');
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
```

- [ ] **Step 2: Tests for the sync sentence**

  Create `src/sync/describe.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { syncLine } from './describe';

const at = (status: Parameters<typeof syncLine>[1]['status'], pending = 0) => ({ status, pending });

describe('the sync line', () => {
  it('says nothing without a backend or while the sign-in is being checked', () => {
    expect(syncLine('unconfigured', at('off'))).toBeNull();
    expect(syncLine('loading', at('off'))).toBeNull();
  });

  it('says signed out, and that the sign-in could not be checked', () => {
    expect(syncLine('signedOut', at('off'))).toBe('Signed out');
    expect(syncLine('linkSent', at('off'))).toBe('Signed out');
    expect(syncLine('unknown', at('off'))).toBe("Can't check sign-in without a connection");
  });

  it('says syncing before the first round has finished, and during one', () => {
    expect(syncLine('signedIn', at('off'))).toBe('Syncing…');
    expect(syncLine('signedIn', at('syncing'))).toBe('Syncing…');
  });

  it('says synced only when nothing is left to send', () => {
    expect(syncLine('signedIn', at('synced', 0))).toBe('Synced');
    expect(syncLine('signedIn', at('synced', 2))).toBe('Syncing…');
  });

  it('counts the changes waiting while offline, in the singular and the plural', () => {
    expect(syncLine('signedIn', at('offline', 0))).toBe('Offline');
    expect(syncLine('signedIn', at('offline', 1))).toBe('Offline, 1 change waiting');
    expect(syncLine('signedIn', at('offline', 3))).toBe('Offline, 3 changes waiting');
  });

  it('says the server cannot be reached, and that it will retry', () => {
    expect(syncLine('signedIn', at('error', 0))).toBe("Can't reach server, will retry");
    expect(syncLine('signedIn', at('error', 2))).toBe("Can't reach server, will retry. 2 changes waiting");
  });

  it('tells a rejected session and another account\'s players apart', () => {
    expect(syncLine('signedIn', at('auth'))).toMatch(/sign out and sign in again/i);
    expect(syncLine('signedIn', at('otherAccount'))).toMatch(/another account/i);
  });

  it('uses no em dash', () => {
    for (const status of ['off', 'syncing', 'synced', 'offline', 'error', 'auth', 'otherAccount'] as const) {
      expect(syncLine('signedIn', at(status, 2)) ?? '').not.toContain('—');
    }
  });
});
```

- [ ] **Step 3: Watch them fail**

  Run:

```bash
npx vitest run src/sync/dataActions.test.ts src/sync/describe.test.ts
```

  Expected: both files fail to load, with `Failed to resolve import "./dataActions"` or `"./describe"`.

- [ ] **Step 4: The data actions**

  Create `src/sync/dataActions.ts`:

```ts
import { clearRosterData } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useAuthStore } from './auth';
import { getSupabase } from './client';
import { pauseSync, syncNow } from './coordinator';
import { isRemoteError, photoFolder, supabaseRemote, type Remote } from './remote';
import { useSyncStore } from './syncStore';

/** The Storage API removes at most this many files in one call. */
const REMOVE_BATCH = 1000;

export interface DataActionDeps {
  /** The server for the signed-in organizer and their id, or null when there is no backend or nobody is signed in. */
  server(): { remote: Remote; userId: string } | null;
  /** Stops syncing and waits for a round in flight. Returns the function that starts it again. */
  pause(): Promise<() => void>;
  syncNow(): void;
  /** Called when this device's players changed, so the screens read them again. */
  refresh(): void;
  batchSize?: number;
}

const defaultDeps: DataActionDeps = {
  server() {
    const client = getSupabase();
    const { status, userId } = useAuthStore.getState();
    return client && status === 'signedIn' && userId ? { remote: supabaseRemote(client, userId), userId } : null;
  },
  pause: pauseSync,
  syncNow,
  refresh() {
    useRosterStore.getState().load().catch(() => {});
  },
};

export type DataResult = { ok: true } | { ok: false; message: string };

/** Removes every photo file of the account, a player's folder at a time and in batches the Storage API accepts. */
export async function removeAllPhotoFiles(remote: Remote, userId: string, batchSize = REMOVE_BATCH): Promise<void> {
  const owner = userId.toLowerCase();
  const paths: string[] = [];
  for (const player of await remote.listPhotoFiles(owner)) {
    const folder = photoFolder(owner, player);
    for (const file of await remote.listPhotoFiles(folder)) paths.push(`${folder}/${file}`);
  }
  for (let from = 0; from < paths.length; from += batchSize) {
    await remote.removePhotoFiles(paths.slice(from, from + batchSize));
  }
}

/**
 * Deletes every player and photo from the signed-in account, then from this device. The device is cleared last, so a
 * failure leaves this device's players where they are, and trying again is safe. Syncing is paused throughout.
 */
export async function deleteAllMyData(deps: DataActionDeps = defaultDeps): Promise<DataResult> {
  const server = deps.server();
  if (!server) return { ok: false, message: 'Sign in to delete the data in your account.' };
  const resume = await deps.pause();
  try {
    await removeAllPhotoFiles(server.remote, server.userId, deps.batchSize);
    await server.remote.deleteAllMyPlayers();
    await clearRosterData();
    useSyncStore.setState({ pending: 0, lastSyncedAt: null });
    deps.refresh();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        isRemoteError(error) && error.kind === 'offline'
          ? 'No connection. Try again when you are online. Nothing on this device was removed.'
          : "Couldn't finish deleting. Nothing on this device was removed. Try again: what was already deleted stays deleted.",
    };
  } finally {
    resume();
  }
}

/**
 * Removes the saved players, photos and sync records from this device only. An account they were backed up to is
 * not touched. If someone is signed in, they come back from the account on the next sync.
 */
export async function clearThisDevice(deps: DataActionDeps = defaultDeps): Promise<DataResult> {
  const resume = await deps.pause();
  try {
    await clearRosterData();
    useSyncStore.setState({ pending: 0, lastSyncedAt: null });
    deps.refresh();
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't clear this device. Try again." };
  } finally {
    resume();
    deps.syncNow();
  }
}
```

- [ ] **Step 5: The sync sentence**

  Create `src/sync/describe.ts`:

```ts
import type { AuthStatus } from './auth';
import type { SyncState } from './syncStore';

const changes = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'} waiting`;

/**
 * The one line that says where backing up stands, for the Saved players and Settings screens. Null when there is
 * nothing to say (no backend, or still checking the sign-in).
 */
export function syncLine(auth: AuthStatus, sync: Pick<SyncState, 'status' | 'pending'>): string | null {
  switch (auth) {
    case 'unconfigured':
    case 'loading':
      return null;
    case 'unknown':
      return "Can't check sign-in without a connection";
    case 'signedOut':
    case 'linkSent':
      return 'Signed out';
    case 'signedIn':
      break;
  }
  switch (sync.status) {
    case 'synced':
      // A round that left changes waiting is followed by another straight away.
      return sync.pending > 0 ? 'Syncing…' : 'Synced';
    case 'offline':
      return sync.pending > 0 ? `Offline, ${changes(sync.pending)}` : 'Offline';
    case 'error':
      return sync.pending > 0 ? `Can't reach server, will retry. ${changes(sync.pending)}` : "Can't reach server, will retry";
    case 'auth':
      return 'Your sign-in was not accepted. Sign out and sign in again.';
    case 'otherAccount':
      return "This device holds another account's players, so nothing is synced. See Settings.";
    case 'off':
    case 'syncing':
      return 'Syncing…';
  }
}
```

- [ ] **Step 6: Run them again**

  Run:

```bash
npx vitest run src/sync/dataActions.test.ts src/sync/describe.test.ts
```

  Expected: every test passes. The summary reads `Tests  19 passed (19)`.

- [ ] **Step 7: Typecheck**

  Run:

```bash
npm run typecheck
```

  Expected: nothing is printed after the `tsc --noEmit` line.

- [ ] **Step 8: Commit**

```bash
git add src/sync/dataActions.ts src/sync/dataActions.test.ts src/sync/describe.ts src/sync/describe.test.ts
git commit -m "feat: delete all my data, clear this device, and the sync sentence"
```


### Task 5: The screens

The sync line on Saved players and Settings, the sign-in banner on Setup, the "Your data" card in Settings, the another-account message, and the blocked-upgrade notice. The screen tests go through the real app with a fake Supabase client and a stand-in for the data actions.

**Files:**
- Create: `src/ui/syncUi.test.tsx`, `src/ui/SyncStatusLine.tsx`, `src/ui/SignInBanner.tsx`
- Modify: `src/ui/syncWiring.test.tsx`, `src/ui/SavedPlayersScreen.tsx`, `src/ui/SettingsScreen.tsx`, `src/ui/App.tsx`

- [ ] **Step 1: Tests for the screens**

  Create `src/ui/syncUi.test.tsx`:

```tsx
import type { Session } from '@supabase/supabase-js';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncState } from '../sync/syncStore';

const backend = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../sync/client', () => ({ getSupabase: () => backend.client }));
const actions = vi.hoisted(() => ({ deleteAllMyData: vi.fn(), clearThisDevice: vi.fn() }));
vi.mock('../sync/dataActions', () => actions);

const session = { user: { email: 'ann@example.com', id: 'user-1' } } as unknown as Session;
function fakeClient(signedIn: boolean) {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: signedIn ? session : null }, error: null }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    // The sync coordinator asks for tables only once a round runs; these tests never let one start.
    from: vi.fn(),
    storage: { from: vi.fn() },
  };
}

/** A fresh copy of the app and its stores, so every test starts clean. */
async function startApp(options: { client: ReturnType<typeof fakeClient> | null }) {
  vi.resetModules();
  backend.client = options.client;
  const { default: App } = await import('./App');
  const { useAuthStore } = await import('../sync/auth');
  const { useSyncStore } = await import('../sync/syncStore');
  const { useRosterStore } = await import('../store/rosterStore');
  render(<App />);
  return { user: userEvent.setup(), auth: useAuthStore, sync: useSyncStore, roster: useRosterStore };
}

const openSaved = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /manage saved players/i }));
const openSettings = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Settings' }));

beforeEach(() => {
  localStorage.clear();
  actions.deleteAllMyData.mockReset();
  actions.clearThisDevice.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the sync line on Saved players', () => {
  it('says signed out when nobody is signed in', async () => {
    const { user } = await startApp({ client: fakeClient(false) });
    await openSaved(user);
    expect(await screen.findByText('Signed out')).toBeInTheDocument();
  });

  it('follows where syncing stands', async () => {
    const { user, auth, sync } = await startApp({ client: fakeClient(true) });
    await openSaved(user);
    await screen.findByText(/signed in as ann@example.com/i);
    const lines: [Partial<SyncState>, string][] = [
      [{ status: 'synced', pending: 0 }, 'Synced'],
      [{ status: 'syncing', pending: 0 }, 'Syncing…'],
      [{ status: 'offline', pending: 2 }, 'Offline, 2 changes waiting'],
      [{ status: 'error', pending: 0 }, "Can't reach server, will retry"],
    ];
    for (const [state, text] of lines) {
      act(() => sync.setState(state));
      expect(await screen.findByText(text)).toBeInTheDocument();
    }
    expect(auth.getState().status).toBe('signedIn');
  });

  it('shows nothing extra when the build has no backend', async () => {
    const { user } = await startApp({ client: null });
    await openSaved(user);
    expect(screen.queryByText('Signed out')).not.toBeInTheDocument();
    expect(screen.queryByText('Synced')).not.toBeInTheDocument();
  });
});

describe('the sign-in banner', () => {
  const banner = () => screen.queryByText(/sign in to back up and sync your players/i);

  it('waits until there is something to back up', async () => {
    const { roster } = await startApp({ client: fakeClient(false) });
    await vi.waitFor(() => expect(roster.getState().loaded).toBe(true));
    expect(banner()).not.toBeInTheDocument();
    await act(async () => {
      await roster.getState().add('Ann');
    });
    expect(banner()).toBeInTheDocument();
  });

  it('takes the organizer to Settings', async () => {
    const { user, roster } = await startApp({ client: fakeClient(false) });
    await act(async () => {
      await roster.getState().add('Ann');
    });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('goes away for good when dismissed', async () => {
    const { user, roster } = await startApp({ client: fakeClient(false) });
    await act(async () => {
      await roster.getState().add('Ann');
    });
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(banner()).not.toBeInTheDocument();
    cleanup();
    const again = await startApp({ client: fakeClient(false) });
    await vi.waitFor(() => expect(again.roster.getState().loaded).toBe(true));
    expect(banner()).not.toBeInTheDocument();
  });

  it('stays hidden when signed in, while a link is on its way, and with no backend', async () => {
    const signedIn = await startApp({ client: fakeClient(true) });
    await act(async () => {
      await signedIn.roster.getState().add('Ann');
    });
    expect(banner()).not.toBeInTheDocument();
    cleanup();
    const none = await startApp({ client: null });
    await act(async () => {
      await none.roster.getState().add('Ann');
    });
    expect(banner()).not.toBeInTheDocument();
    cleanup();
    const sent = await startApp({ client: fakeClient(false) });
    await act(async () => {
      await sent.roster.getState().add('Ann');
    });
    act(() => sent.auth.setState({ status: 'linkSent', email: 'a@b.co' }));
    expect(banner()).not.toBeInTheDocument();
  });
});

describe('a blocked upgrade', () => {
  it('tells the organizer to close other tabs, and stops when it is no longer blocked', async () => {
    const { roster } = await startApp({ client: null });
    const notice = () => screen.queryByText(/close other tabs of this app/i);
    expect(notice()).not.toBeInTheDocument();
    act(() => roster.setState({ blocked: true }));
    expect(notice()).toBeInTheDocument();
    act(() => roster.setState({ blocked: false }));
    expect(notice()).not.toBeInTheDocument();
  });
});

describe('Settings: your data', () => {
  it('can clear this device after asking, and says it did', async () => {
    actions.clearThisDevice.mockResolvedValue({ ok: true });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const { user } = await startApp({ client: fakeClient(false) });
    await openSettings(user);
    const button = await screen.findByRole('button', { name: /clear saved players on this device/i });
    await user.click(button);
    expect(actions.clearThisDevice).not.toHaveBeenCalled();
    await user.click(button);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(actions.clearThisDevice).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/cleared\. this device has no saved players/i)).toBeInTheDocument();
  });

  it('offers to delete everything only to someone who is signed in', async () => {
    const out = await startApp({ client: fakeClient(false) });
    await openSettings(out.user);
    await screen.findByRole('button', { name: /clear saved players/i });
    expect(screen.queryByRole('button', { name: /delete all my data/i })).not.toBeInTheDocument();
    cleanup();
    const inn = await startApp({ client: fakeClient(true) });
    await openSettings(inn.user);
    expect(await screen.findByRole('button', { name: /delete all my data/i })).toBeInTheDocument();
  });

  it('deletes everything after asking, and says it did', async () => {
    actions.deleteAllMyData.mockResolvedValue({ ok: true });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const { user } = await startApp({ client: fakeClient(true) });
    await openSettings(user);
    const button = await screen.findByRole('button', { name: /delete all my data/i });
    await user.click(button);
    expect(actions.deleteAllMyData).not.toHaveBeenCalled();
    await user.click(button);
    expect(confirm.mock.calls[1][0]).toMatch(/cannot be undone/i);
    expect(actions.deleteAllMyData).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/deleted\. your account and this device have no saved players/i)).toBeInTheDocument();
  });

  it('shows why a deletion failed, and keeps the buttons usable afterwards', async () => {
    actions.deleteAllMyData.mockResolvedValue({ ok: false, message: 'No connection. Nothing on this device was removed.' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user } = await startApp({ client: fakeClient(true) });
    await openSettings(user);
    await user.click(await screen.findByRole('button', { name: /delete all my data/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no connection/i);
    expect(screen.getByRole('button', { name: /delete all my data/i })).toBeEnabled();
  });

  it('disables both buttons and says it is working while an action runs', async () => {
    let finish: (value: { ok: true }) => void = () => undefined;
    actions.deleteAllMyData.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user } = await startApp({ client: fakeClient(true) });
    await openSettings(user);
    await user.click(await screen.findByRole('button', { name: /delete all my data/i }));
    expect(screen.getByText('Working…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete all my data/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /clear saved players/i })).toBeDisabled();
    await act(async () => finish({ ok: true }));
    expect(screen.queryByText('Working…')).not.toBeInTheDocument();
  });

  it('explains the another-account state and points at the way out', async () => {
    const { user, sync } = await startApp({ client: fakeClient(true) });
    await openSettings(user);
    await screen.findByText('ann@example.com');
    act(() => sync.setState({ status: 'otherAccount' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/different account/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear saved players on this device/i })).toBeInTheDocument();
  });

  it('shows the sync line under the signed-in email', async () => {
    const { user, sync } = await startApp({ client: fakeClient(true) });
    await openSettings(user);
    await screen.findByText('ann@example.com');
    act(() => sync.setState({ status: 'synced', pending: 0 }));
    expect(await screen.findByText('Synced')).toBeInTheDocument();
  });

  it('is not shown while the sign-in is being checked', async () => {
    const client = fakeClient(true);
    client.auth.getSession.mockReturnValue(new Promise(() => undefined));
    const { user } = await startApp({ client });
    await openSettings(user);
    expect(screen.queryByRole('heading', { name: 'Your data' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: The wiring test's stand-in coordinator offers what the data actions import**

  In `src/ui/syncWiring.test.tsx`, replace:

```ts
vi.mock('../sync/coordinator', () => ({ startSyncCoordinator: () => start() }));
```

  with:

```ts
vi.mock('../sync/coordinator', () => ({
  startSyncCoordinator: () => start(),
  pauseSync: async () => () => undefined,
  syncNow: () => undefined,
}));
```

- [ ] **Step 3: Watch them fail**

  Run:

```bash
npx vitest run src/ui/syncUi.test.tsx
```

  Expected: The summary reads `Tests  12 failed | 4 passed (16)`. The screens do not show any of this yet.

- [ ] **Step 4: The sync line**

  Create `src/ui/SyncStatusLine.tsx`:

```tsx
import { useAuthStore } from '../sync/auth';
import { syncLine } from '../sync/describe';
import { useSyncStore } from '../sync/syncStore';

/** One line saying where backing up stands. Shows nothing when there is nothing to say. */
export function SyncStatusLine() {
  const auth = useAuthStore((s) => s.status);
  const status = useSyncStore((s) => s.status);
  const pending = useSyncStore((s) => s.pending);
  const line = syncLine(auth, { status, pending });
  return line ? (
    <p className="muted" role="status">
      {line}
    </p>
  ) : null;
}
```

- [ ] **Step 5: The sign-in banner**

  Create `src/ui/SignInBanner.tsx`:

```tsx
import { useState } from 'react';
import { useAuthStore } from '../sync/auth';
import { useRosterStore } from '../store/rosterStore';

const KEY = 'pikl.signInBannerDismissed';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Offers to sign in once there is something to back up. Shown only to someone who is signed out (not while a sign-in
 * is in progress, not without a backend), and not again once dismissed.
 */
export function SignInBanner({ onSignIn }: { onSignIn: () => void }) {
  const status = useAuthStore((s) => s.status);
  const hasPlayers = useRosterStore((s) => s.players.length > 0);
  const [dismissed, setDismissed] = useState(wasDismissed);
  if (status !== 'signedOut' || !hasPlayers || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // Without storage it comes back next visit, which is fine.
    }
  }

  return (
    <p className="notice">
      Sign in to back up and sync your players.{' '}
      <button type="button" className="btn btn-small btn-primary" onClick={onSignIn}>
        Sign in
      </button>{' '}
      <button type="button" className="btn btn-small btn-ghost" onClick={dismiss}>
        Not now
      </button>
    </p>
  );
}
```

- [ ] **Step 6: Saved players shows the sync line (import)**

  In `src/ui/SavedPlayersScreen.tsx`, replace:

```ts
import { PlayerAvatar } from './PlayerAvatar';
```

  with:

```ts
import { PlayerAvatar } from './PlayerAvatar';
import { SyncStatusLine } from './SyncStatusLine';
```

- [ ] **Step 7: ...in place of the plain "Signed out" line**

  In `src/ui/SavedPlayersScreen.tsx`, replace:

```ts
      {authStatus === 'signedIn' && (
        <p className="muted" style={{ overflowWrap: 'anywhere' }}>
          Signed in as {authEmail}
        </p>
      )}
      {(authStatus === 'signedOut' || authStatus === 'linkSent') && <p className="muted">Signed out</p>}
```

  with:

```ts
      {authStatus === 'signedIn' && (
        <p className="muted" style={{ overflowWrap: 'anywhere' }}>
          Signed in as {authEmail}
        </p>
      )}
      <SyncStatusLine />
```

- [ ] **Step 8: Settings: imports**

  In `src/ui/SettingsScreen.tsx`, replace:

```ts
import { useAuthStore } from '../sync/auth';
```

  with:

```ts
import { useAuthStore } from '../sync/auth';
import { clearThisDevice, deleteAllMyData, type DataResult } from '../sync/dataActions';
import { useSyncStore } from '../sync/syncStore';
import { SyncStatusLine } from './SyncStatusLine';
```

- [ ] **Step 9: Settings: state for the data actions**

  In `src/ui/SettingsScreen.tsx`, replace:

```ts
  const [emailInput, setEmailInput] = useState('');
```

  with:

```ts
  const [emailInput, setEmailInput] = useState('');
  const syncStatus = useSyncStore((s) => s.status);
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<{ result: DataResult; done: string } | null>(null);

  /** Asks first, then runs one of the data actions and says how it went. */
  async function runDataAction(question: string, action: () => Promise<DataResult>, done: string) {
    if (working || !window.confirm(question)) return;
    setWorking(true);
    setOutcome(null);
    try {
      setOutcome({ result: await action(), done });
    } finally {
      setWorking(false);
    }
  }
```

- [ ] **Step 10: Settings: the sync line and the another-account message**

  In `src/ui/SettingsScreen.tsx`, replace:

```ts
            <button type="button" className="btn" disabled={busy} onClick={() => void signOut()}>
              Sign out
            </button>
          </>
        )}
```

  with:

```ts
            <SyncStatusLine />
            {syncStatus === 'otherAccount' && (
              <p className="error" role="alert">
                This device holds saved players from a different account, so nothing is synced. Clear the saved players on this
                device below to start syncing this account, or sign out.
              </p>
            )}
            <button type="button" className="btn" disabled={busy} onClick={() => void signOut()}>
              Sign out
            </button>
          </>
        )}
```

- [ ] **Step 11: Settings: a card for the data on this device and in the account**

  In `src/ui/SettingsScreen.tsx`, replace:

```ts
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
```

  with:

```ts
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      {status !== 'loading' && (
        <section className="card stack" aria-labelledby="data-title">
          <h2 id="data-title" className="section-title">
            Your data
          </h2>
          <button
            type="button"
            className="btn"
            disabled={working}
            onClick={() =>
              void runDataAction(
                'Clear the saved players and photos on this device? Anything backed up to an account stays there.',
                clearThisDevice,
                'Cleared. This device has no saved players now.',
              )
            }
          >
            Clear saved players on this device
          </button>
          <p className="muted">
            Removes them from this device only.{' '}
            {status === 'signedIn'
              ? 'They come back from your account the next time this device syncs.'
              : 'If you backed them up, they are still in your account.'}
          </p>
          {status === 'signedIn' && (
            <>
              <button
                type="button"
                className="btn btn-danger"
                disabled={working}
                onClick={() =>
                  void runDataAction(
                    'Delete all your saved players and photos from your account and from this device? This cannot be undone.',
                    deleteAllMyData,
                    'Deleted. Your account and this device have no saved players now.',
                  )
                }
              >
                Delete all my data
              </button>
              <p className="muted">Deletes every saved player and photo from your account and from this device. This cannot be undone.</p>
            </>
          )}
          {working && (
            <p className="muted" role="status">
              Working…
            </p>
          )}
          {outcome &&
            (outcome.result.ok ? (
              <p role="status">{outcome.done}</p>
            ) : (
              <p className="error" role="alert">
                {outcome.result.message}
              </p>
            ))}
        </section>
      )}
    </div>
```

- [ ] **Step 12: App: imports**

  In `src/ui/App.tsx`, replace:

```ts
import { ErrorBoundary } from './ErrorBoundary';
```

  with:

```ts
import { ErrorBoundary } from './ErrorBoundary';
import { SignInBanner } from './SignInBanner';
```

- [ ] **Step 13: App: the blocked-upgrade state**

  In `src/ui/App.tsx`, replace:

```ts
  const rosterPersistent = useRosterStore((s) => s.persistent);
```

  with:

```ts
  const rosterPersistent = useRosterStore((s) => s.persistent);
  const rosterBlocked = useRosterStore((s) => s.blocked);
```

- [ ] **Step 14: App: the sign-in banner above Setup**

  In `src/ui/App.tsx`, replace:

```ts
        <div hidden={view !== 'setup'}>
          <SetupScreen
```

  with:

```ts
        <div hidden={view !== 'setup'}>
          <SignInBanner onSignIn={() => setView('settings')} />
          <SetupScreen
```

- [ ] **Step 15: App: tell the organizer to close other tabs**

  In `src/ui/App.tsx`, replace:

```ts
      {!rosterPersistent && (
```

  with:

```ts
      {rosterBlocked && (
        <p className="notice" role="status">
          Close other tabs of this app to load your saved players.
        </p>
      )}
      {!rosterPersistent && (
```

- [ ] **Step 16: Run them again**

  Run:

```bash
npx vitest run src/ui/syncUi.test.tsx src/ui/syncWiring.test.tsx src/ui/settings.test.tsx
```

  Expected: every test passes. The summary reads `Tests  28 passed (28)`.

- [ ] **Step 17: Run everything**

  Run:

```bash
npm test
```

  Expected: every test passes. The summary reads `Tests  474 passed (474)`. The count was 426 before this plan.

- [ ] **Step 18: Typecheck and build**

  Run:

```bash
npm run build
```

  Expected: the build finishes and prints the precache size, about 231 KiB with the two Supabase settings unset. With them set it is about 454 KiB.

- [ ] **Step 19: Commit**

```bash
git add src/ui/SyncStatusLine.tsx src/ui/SignInBanner.tsx src/ui/SavedPlayersScreen.tsx src/ui/SettingsScreen.tsx src/ui/App.tsx src/ui/syncUi.test.tsx src/ui/syncWiring.test.tsx
git commit -m "feat: sync status line, sign-in banner, your-data settings and a blocked-upgrade notice"
```


### Task 6: Bring the spec in line

Three spec lines change: when the banner appears, the status line as built, and what Delete all my data and Clear saved players on this device do.

**Files:**
- Modify: `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md`

- [ ] **Step 1: The sign-in banner says when it appears**

  In `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md`, replace:

```md
a small banner offers "Sign in to back up and sync your players".
```

  with:

```md
once there is a saved player, a small banner on Setup offers "Sign in to back up and sync your players" until it is dismissed.
```

- [ ] **Step 2: The sync status line, as built**

  In `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md`, replace:

```md
**Sync status** is always visible in the roster screen header as one of: *Signed out*, *Synced*, *Syncing…*, *Offline — N changes waiting*, or *Can't reach server — will retry*.
```

  with:

```md
**Sync status** is always visible in the Saved players header (and in Settings under the signed-in email) as one of: *Signed out*, *Synced*, *Syncing…*, *Offline, N changes waiting*, or *Can't reach server, will retry*. Two more cover a sign-in that was not accepted and a device that holds another account's players (Settings explains the way out). A saved session that could not be checked says so and nothing syncs.
```

- [ ] **Step 3: Delete all my data, and clearing a device**

  In `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md`, replace:

```md
- Settings has **Delete all my data**: purges all players and photos from Supabase and from this device after confirmation.
```

  with:

```md
- Settings has **Delete all my data** (signed in only): after confirmation it pauses syncing, removes every photo file, deletes every player row, and only then clears this device, so a failure leaves the device as it was and the action can be repeated. It also has **Clear saved players on this device**, which empties this device only; whatever was backed up stays in the account and comes back on the next sync. That is also the way out of the state where another account's players are on the device.
- If a database upgrade is waiting for another tab of the app to let go, the app says so ("Close other tabs of this app to load your saved players") until it does.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md
git commit -m "docs: spec now describes the sync line, the banner and the data actions"
```


### Task 7: Check it on the real project and devices

The tests use stand-ins for the server and a fake client for sign-in. This task looks at the real app after the plan is merged to production and Vercel has deployed. It takes about fifteen minutes with a laptop and a phone. "Delete all my data" is optional and last, because it empties your real roster.

**Files:**
- No files change.

- [ ] **Step 1: The sync line and the Your data card**

  Open https://piklmatch.vercel.app on the laptop, signed in. If the app offers **Reload now**, tap it. Open **Manage saved players**:
  
  - [ ] Under the title it says `Signed in as` your email, and a line that reads `Synced` within a few seconds.
  - [ ] Open **Settings**: the same `Synced` line sits under your email, and a **Your data** card has **Clear saved players on this device** and **Delete all my data**.
  - [ ] Tap each button and choose Cancel in the box that appears. Nothing changes and nothing is deleted.

- [ ] **Step 2: Offline, on the phone**

  On the phone turn on airplane mode, rename a player, and open **Manage saved players**.
  
  - [ ] The line reads `Offline, 1 change waiting`. (If it still says `Synced`, wait a few seconds: the page learns it is offline when a round fails.)
  - [ ] Turn airplane mode off. Within about a minute the line reads `Synced`, and the laptop shows the new name after you bring it forward.

- [ ] **Step 3: Clear a device and get everything back**

  On the phone open **Settings**, tap **Clear saved players on this device**, and confirm.
  
  - [ ] The message says the device has no saved players, and **Manage saved players** is empty.
  - [ ] Within about a minute the players come back, with their photos, and the line reads `Synced`.
  - [ ] In the Supabase SQL editor `select count(*) from public.players where deleted_at is null;` still shows your players: clearing a device never touches the account.

- [ ] **Step 4: The banner**

  Sign out on the phone (**Settings**, **Sign out**) and go back to **Setup**.
  
  - [ ] A box says `Sign in to back up and sync your players.` with **Sign in** and **Not now**. **Sign in** opens Settings.
  - [ ] Sign in again with the emailed link. The banner does not come back.
  - [ ] Sign out once more and tap **Not now**: the banner goes, and stays gone after a reload.

- [ ] **Step 5: Optional and last: delete everything**

  This empties your real roster and cannot be undone. Only do it if you want to start over, or after you have taken any copy you want.
  
  On the laptop, **Settings**, **Delete all my data**, confirm.
  
  - [ ] The message says your account and this device have no saved players.
  - [ ] In the SQL editor `select count(*) from public.players;` is `0`, and `select count(*) from storage.objects where bucket_id = 'player-photos';` is `0`.
  - [ ] The phone is not emptied by this: the rows are gone from the server, so there is nothing for it to pull that says "delete". Its players stay until you clear that device too (**Clear saved players on this device**). If you leave them, the next change to any of them pushes it back to the account.


---

## Self-review

**Spec coverage** (the screens and privacy parts of "Sync and backend", and "Manage players"):

| Spec requirement | Where |
|---|---|
| Sync status always visible in the roster header, in five states | Tasks 4 and 5 |
| A banner offers sign-in | Task 5 |
| Settings has Delete all my data: server, then device, after confirmation | Tasks 2 and 4 (logic), 5 (screen) |
| Deleting removes photo files through the Storage API, in batches | Tasks 2 and 4 |
| A saved session that could not be checked does not sync or clear | Plan 3B2; the line says so (Task 4) |
| The way out of "another account on this device" (Plan 3B2 limit) | Tasks 1, 4, 5 |
| A message for a blocked upgrade (Plan 2 review) | Tasks 1 and 5 |

**Placeholder scan:** none. Every step has the exact text to write or the exact command to run.

**Type consistency:** `DataResult` and `DataActionDeps` (Task 4) are used unchanged by the Settings screen and the tests. `Runner.idle`, `pauseSync` and `syncNow` (Task 3) are the only coordinator additions `dataActions.ts` imports. `Remote.deleteAllMyPlayers` (Task 2) is implemented by the adapter, the test server and the coordinator test's stub. `useRosterStore.blocked` (Task 1) is the only new field the app reads from the roster store. `syncLine` takes `AuthStatus` and the `status` and `pending` of `SyncState`, nothing else.

**Known limits, for later:**
- Two devices that each give the same player a photo before either has synced pick the same file name; the first to upload wins and the other keeps its own picture until that photo changes (carried from Plan 3B2).
- A player merged away during first sign-in disappears from the roster while a session that names them is running (carried from Plan 3B2).
- "Delete all my data" removes the players and photos, not the sign-in itself: the account stays, and signing in again starts an empty roster. Deleting the account is a Supabase dashboard action.
- "Delete all my data" empties the account and the device it is run on, not the account's other devices: the deleted rows leave nothing behind to pull, so each other device keeps its players until it is cleared too (or until a change to one of them pushes it back).
- The confirm boxes are the browser's own plain ones, as for removing a player. A styled dialog is a later polish.
- No "last synced at" time is shown, and the sync line is not on the Setup screen.
- Focus and screen-reader follow-ups from the Plan 3A and Plan 2 reviews (focus after a step changes, field-level hints, the sheet's hidden inputs) are still open; they are listed in `docs/superpowers/notes/2026-11-06-follow-ups-and-plan-2-3-prerequisites.md`.
- The Supabase client is still loaded up front: with the two settings set, the service worker precaches about 454 KiB (about 231 KiB without them).
