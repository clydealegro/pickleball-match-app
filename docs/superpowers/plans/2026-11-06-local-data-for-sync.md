# Local Data for Sync Implementation Plan (Plan 3B1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every roster change leave a mark that says "this player still has to be pushed online", saved in the same step as the change itself, and make roster writes safe when two tabs of the app are open. Nothing changes on screen and nothing touches the network.

**Architecture:** The roster database moves to version 3 and gains two stores: `outbox` (one mark per player) and `syncMeta` (small values the sync engine keeps). Every write now runs as one transaction over players, photos and the outbox, so a change, its photo and its mark are saved together or not at all, and a read-modify-write can no longer be overwritten by another tab. A new `photoSeq` on each player only ever goes up and will name the photo's file online. A few small functions give the future sync engine what it needs.

**Tech Stack:** TypeScript, `idb` 8 on IndexedDB, Zustand 5, Vitest 3 with `fake-indexeddb`. No new dependency.

**Roadmap:** Plan 3A (the Supabase backend and sign-in) is live. Plan 3B is split in three, as Plan 3 was, so each plan ships something that works and can be tested alone. **Plan 3B1 is this plan:** the local data, with no visible change. **Plan 3B2 (not written yet):** the sync engine: push one player per request, pull with an overlap, merge, photos, the first sign-in, and validating pulled rows. **Plan 3B3 (not written yet):** the screens: the sync status line, the sign-in banner, "Delete all my data", and a message for a blocked upgrade.

**Follow-ups this plan absorbs:** from `docs/superpowers/notes/2026-11-06-follow-ups-and-plan-2-3-prerequisites.md`: the multi-store write for the outbox, the atomic read-modify-write that closes the two-tab race, the monotonic `photoSeq` that matches the database's `photo_seq`, the missing-store guard for a database left by a newer build, and `navigator.storage.persist()`. The rest of that file belongs to 3B2 and 3B3.

---

## Decisions made while planning

1. **The outbox is a mark per player, not a log of changes.** The spec says changes are "appended to the outbox" and pushed "in order". A log would need merging (rename, rename again, delete) and an order that matters. A mark per player says only "this player differs from what was last pushed", and the push reads the player's current state. It always converges, and it cannot get out of order. What does have to go first is a delete before an add of the same name, because the database's unique-name index would reject the add; 3B2 handles that by pushing deleted players first.
2. **A mark carries a revision from one counter that is never reused.** A push reads a mark, pushes, then removes the mark only if its revision is unchanged, so a change made while the push ran is not lost. The first version of this plan gave each mark its own counter, and a test showed the flaw: after a mark was removed, the next change started again at revision 1, so a late acknowledgement from an older push could remove a newer mark. The counter now lives in `syncMeta` under the key `outboxRev`, and is updated in the same transaction as the mark. 3B2 must not use that key for anything else.
3. **One transaction for the change, the photo and the mark.** `run(work)` opens a single read-write transaction over the stores, and rolls everything back if `work` throws. The in-memory fallback does the same with a snapshot. Writes from one tab are still queued one after another (`serial`), and the browser orders transactions between tabs, which closes the race the Plan 2 review described: two tabs setting a photo at once used to both write version 1, and a `markRosterPlayed` in one tab could write back a stale row and undo a photo change from the other. Tested with two copies of the module standing in for two tabs.
4. **`photoSeq` is never reset.** `photoVersion` keeps its Plan 2 meaning (a count that returns to 0 when the photo is removed). `photoSeq` goes up with every saved photo and stays put on removal and on delete, so a removed and re-added photo never reuses a file path online. Players saved before this version have no `photoSeq`; every read fills it in from their `photoVersion`. An earlier draft also rewrote every row during the upgrade. A deliberate breakage showed that rewrite changed nothing, because the read already covers it, so it was cut.
5. **A database left by a newer build is used as it is.** Plan 2 already opens a newer database without upgrading it. This plan's writes now touch up to four stores, so they use the ones that exist: a missing `outbox` or `syncMeta` store means no mark is saved and no sync value is kept, and a missing `photos` store still raises an error when a photo is saved, as it did before.
6. **Names need no change.** The app trims names with JavaScript `trim()`, which removes more than Postgres `btrim` (spaces only). So a name the app stores never has an edge that `btrim` would keep, and a name that is not empty here is not empty there either. What other devices wrote is a 3B2 concern: it normalises pulled names the same way before they are stored.
7. **The browser is asked to keep the roster.** After the first saved player and after a saved photo, the app calls `navigator.storage.persist()`. The Plan 2 review noted that Safari can clear the site data of a browser tab after about a week without a visit, and an outbox that was never pushed would be lost with it. Browsers differ in how they answer: some decide silently and some may ask the user once, which this plan did not check. Where the browser has no such call, nothing happens.
8. **Nothing is pushed yet.** With no sync engine, marks pile up, one per player. That is bounded by the number of players, so it is safe. 3B2 clears them as it pushes.
9. **One existing test is hardened.** "ends the session, shows the summary, and remembers the players for next time" in `App.test.tsx` raced the background write that records who played. It failed once in 7 full runs before this plan, and in 3 of 6 full runs once each write did more work. Reading the revision counter once per transaction brought that back to 0 of 6 without touching the test, and the test now waits for the roster as well, so it no longer depends on timing (0 failures in 8 full runs). This is the same kind of fix as the earlier `waitFor` in Plan 2.

## Conventions

- Tests first: a task writes its tests, runs them to see them fail, then makes them pass.
- No em dashes in any text you write. Commit messages are plain: no tool names, no co-author lines.
- Run commands from the project root.
- `npm test` runs every test once. Before this plan it reports 283 passing.

## Rollout

This plan changes how the roster is stored on a visitor's device, so the upgrade runs the first time an existing install opens the new version. The upgrade only adds two empty stores; no saved player or photo is rewritten. Task 6 checks it in a real browser with a real version 2 database. The roster code is only reached through the same functions as before, so no screen changes.

## File structure

| File | What changes |
|---|---|
| `src/store/rosterDb.ts` | Rewritten: version 3, the transaction `run`, the outbox, `photoSeq`, sync values |
| `src/store/rosterDb.outbox.test.ts` | New: marks, revisions, `photoSeq`, sync values |
| `src/store/rosterDb.upgrade.test.ts` | New: the upgrade, a newer database, and two tabs |
| `src/store/rosterDb.test.ts` | One assertion gains `photoSeq` |
| `src/store/rosterDb.fallback.test.ts` | Two tests for the in-memory fallback |
| `src/lib/persist.ts`, `src/lib/persist.test.ts` | New: ask the browser to keep the data |
| `src/store/rosterStore.ts`, `src/store/rosterStore.test.ts` | Ask for persistence after an add or a photo |
| `src/ui/App.test.tsx` | One test waits for the roster instead of racing it |
| `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md` | Four lines brought in line with the code |

### Task 1: Write the tests that describe the new behaviour, and watch them fail

These tests describe what the roster database must do after this plan: mark every change, keep a photo number that never goes back, upgrade an existing install, cope with a database from a newer build, and stay correct when two tabs write at once. They fail now because none of it exists yet.

**Files:**
- Create: `src/store/rosterDb.outbox.test.ts`
- Create: `src/store/rosterDb.upgrade.test.ts`
- Modify: `src/store/rosterDb.test.ts`
- Modify: `src/store/rosterDb.fallback.test.ts`

- [ ] **Step 1: The outbox and photo sequence tests**

  Create `src/store/rosterDb.outbox.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ackOutbox,
  addRosterPlayer,
  deleteRosterPlayer,
  getRosterEntry,
  getSyncMeta,
  listOutbox,
  markRosterPlayed,
  queueAllForSync,
  removeRosterPhoto,
  renameRosterPlayer,
  resetRosterDbForTests,
  setRosterPhoto,
  setSyncMeta,
  type PhotoData,
} from './rosterDb';

const photo = (...bytes: number[]): PhotoData => ({ type: 'image/jpeg', data: new Uint8Array(bytes).buffer });

beforeEach(async () => {
  await resetRosterDbForTests();
});

/** What a push does when it succeeds: read every mark, then remove each one at the revision it read. */
async function pushAll() {
  for (const entry of await listOutbox()) await ackOutbox(entry.playerId, entry.rev);
}

const ids = async () => (await listOutbox()).map((e) => e.playerId);

describe('roster outbox', () => {
  it('marks a new player as having changes to push', async () => {
    const ann = await addRosterPlayer('Ann');
    expect(await listOutbox()).toEqual([{ playerId: ann.id, rev: 1 }]);
  });

  it('keeps one mark per player and gives it a newer revision with every change', async () => {
    const ann = await addRosterPlayer('Ann');
    await renameRosterPlayer(ann.id, 'Annie');
    await setRosterPhoto(ann.id, photo(1));
    await markRosterPlayed([ann.id], 5_000);
    expect(await listOutbox()).toEqual([{ playerId: ann.id, rev: 4 }]);
  });

  it('marks every kind of change', async () => {
    const ann = await addRosterPlayer('Ann');
    await pushAll();
    expect(await listOutbox()).toEqual([]);

    await renameRosterPlayer(ann.id, 'Annie');
    expect(await ids()).toEqual([ann.id]);
    await pushAll();
    await setRosterPhoto(ann.id, photo(1));
    expect(await ids()).toEqual([ann.id]);
    await pushAll();
    await removeRosterPhoto(ann.id);
    expect(await ids()).toEqual([ann.id]);
    await pushAll();
    await markRosterPlayed([ann.id], 9_000);
    expect(await ids()).toEqual([ann.id]);
    await pushAll();
    await deleteRosterPlayer(ann.id);
    expect(await ids()).toEqual([ann.id]);
    expect(await getRosterEntry(ann.id)).toMatchObject({ deletedAt: expect.any(Number) });
  });

  it('marks nothing when nothing changed', async () => {
    const ann = await addRosterPlayer('Ann');
    await pushAll();
    await addRosterPlayer(' ANN '); // the same player
    await renameRosterPlayer(ann.id, 'Ann'); // the same name
    await removeRosterPhoto(ann.id); // no photo to remove
    await markRosterPlayed(['nobody'], 1_000);
    expect(await listOutbox()).toEqual([]);

    await deleteRosterPlayer(ann.id);
    await pushAll();
    await deleteRosterPlayer(ann.id); // already deleted
    await markRosterPlayed([ann.id], 2_000); // deleted players are not played
    expect(await listOutbox()).toEqual([]);
  });

  it('removes a mark only when the player has not changed since it was read', async () => {
    const ann = await addRosterPlayer('Ann');
    const [entry] = await listOutbox();
    await renameRosterPlayer(ann.id, 'Annie'); // changes again while a push is running
    await ackOutbox(ann.id, entry.rev);
    expect(await listOutbox()).toEqual([{ playerId: ann.id, rev: 2 }]);
    await ackOutbox(ann.id, 2);
    expect(await listOutbox()).toEqual([]);
    await ackOutbox(ann.id, 2); // nothing there: no error
    await ackOutbox('nobody', 1);
  });

  it('never gives the same revision twice, so a late acknowledgement cannot remove a newer mark', async () => {
    const ann = await addRosterPlayer('Ann');
    const [first] = await listOutbox();
    await ackOutbox(ann.id, first.rev);
    await renameRosterPlayer(ann.id, 'Annie');
    const [second] = await listOutbox();
    expect(second.rev).not.toBe(first.rev);
    await ackOutbox(ann.id, first.rev); // the first push's acknowledgement, arriving late
    expect(await listOutbox()).toEqual([second]);
  });

  it('saves the change and its mark together, or neither', async () => {
    const ann = await addRosterPlayer('Ann');
    await pushAll();
    const data = new Uint8Array([1, 2, 3]).buffer;
    structuredClone(data, { transfer: [data] }); // detaches the buffer, so it cannot be stored
    await expect(setRosterPhoto(ann.id, { type: 'image/jpeg', data })).rejects.toThrow();
    expect(await listOutbox()).toEqual([]);
    expect(await getRosterEntry(ann.id)).toMatchObject({ photoVersion: 0, photoSeq: 0 });
    await addRosterPlayer('Ben'); // and the counter was not spent by the failed change
    expect((await listOutbox())[0].rev).toBe(2);
  });

  it('marks every saved player, deleted ones included, for the first sign-in', async () => {
    const ann = await addRosterPlayer('Ann');
    const ben = await addRosterPlayer('Ben');
    await deleteRosterPlayer(ben.id);
    await pushAll();
    expect(await queueAllForSync()).toBe(2);
    expect((await ids()).sort()).toEqual([ann.id, ben.id].sort());
  });

  it('lists the marks in a steady order', async () => {
    const a = await addRosterPlayer('Ann');
    const b = await addRosterPlayer('Ben');
    const c = await addRosterPlayer('Cy');
    expect(await ids()).toEqual([a.id, b.id, c.id].sort());
  });
});

describe('photo sequence', () => {
  it('starts at 0 and goes up with every saved photo', async () => {
    const ann = await addRosterPlayer('Ann');
    expect(ann.photoSeq).toBe(0);
    await setRosterPhoto(ann.id, photo(1));
    await setRosterPhoto(ann.id, photo(2));
    expect(await getRosterEntry(ann.id)).toMatchObject({ photoVersion: 2, photoSeq: 2 });
  });

  it('is not reset when the photo is removed, so a re-added photo never reuses a number', async () => {
    const ann = await addRosterPlayer('Ann');
    await setRosterPhoto(ann.id, photo(1));
    await removeRosterPhoto(ann.id);
    expect(await getRosterEntry(ann.id)).toMatchObject({ photoVersion: 0, photoSeq: 1 });
    await setRosterPhoto(ann.id, photo(2));
    expect(await getRosterEntry(ann.id)).toMatchObject({ photoVersion: 1, photoSeq: 2 });
  });

  it('is kept when a player is deleted', async () => {
    const ann = await addRosterPlayer('Ann');
    await setRosterPhoto(ann.id, photo(1));
    await deleteRosterPlayer(ann.id);
    expect(await getRosterEntry(ann.id)).toMatchObject({ photoVersion: 1, photoSeq: 1 });
  });
});

describe('sync meta', () => {
  it('keeps small values between calls, and reads a missing one as undefined', async () => {
    expect(await getSyncMeta('cursor')).toBeUndefined();
    await setSyncMeta('cursor', '2026-11-06T10:00:00.000Z');
    await setSyncMeta('user', { id: 'u1' });
    expect(await getSyncMeta('cursor')).toBe('2026-11-06T10:00:00.000Z');
    expect(await getSyncMeta('user')).toEqual({ id: 'u1' });
  });
});
```

- [ ] **Step 2: The upgrade, newer-database and two-tab tests**

  Create `src/store/rosterDb.upgrade.test.ts`:

```ts
import { openDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addRosterPlayer,
  getRosterEntry,
  getRosterPhoto,
  getSyncMeta,
  listOutbox,
  listRoster,
  resetRosterDbForTests,
  setRosterPhoto,
  setSyncMeta,
} from './rosterDb';

const DB_NAME = 'pickleball-roster';

beforeEach(async () => {
  await resetRosterDbForTests();
});

/** Leaves the database as an earlier build would have: players saved, and (from version 2) photos. */
async function seedOldDatabase(version: 1 | 2) {
  const old = await openDB(DB_NAME, version, {
    upgrade(d) {
      d.createObjectStore('players', { keyPath: 'id' });
      if (version >= 2) d.createObjectStore('photos', { keyPath: 'id' });
    },
  });
  await old.put('players', { id: 'p1', name: 'Ann', photoVersion: 0, updatedAt: 1 });
  await old.put('players', { id: 'p2', name: 'Ben', photoVersion: 3, updatedAt: 2 });
  if (version >= 2) await old.put('photos', { id: 'p2', type: 'image/jpeg', data: new Uint8Array([7, 8]).buffer });
  old.close();
}

describe('upgrading to version 3', () => {
  it('keeps a version 2 database as it was and starts each photo sequence at the photo count', async () => {
    await seedOldDatabase(2);
    expect((await listRoster()).map((p) => [p.name, p.photoVersion, p.photoSeq])).toEqual([
      ['Ann', 0, 0],
      ['Ben', 3, 3],
    ]);
    expect(Array.from(new Uint8Array((await getRosterPhoto('p2'))!.data))).toEqual([7, 8]);
    expect(await listOutbox()).toEqual([]);
    await setSyncMeta('cursor', 'x');
    expect(await getSyncMeta('cursor')).toBe('x');
  });

  it('upgrades a version 1 database too', async () => {
    await seedOldDatabase(1);
    expect((await listRoster()).map((p) => p.name)).toEqual(['Ann', 'Ben']);
    await setRosterPhoto('p1', { type: 'image/jpeg', data: new Uint8Array([1]).buffer });
    expect(await getRosterEntry('p1')).toMatchObject({ photoVersion: 1, photoSeq: 1 });
  });

  it('creates the two new stores', async () => {
    await seedOldDatabase(2);
    await listRoster();
    const raw = await openDB(DB_NAME);
    expect(Array.from(raw.objectStoreNames).sort()).toEqual(['outbox', 'photos', 'players', 'syncMeta']);
    expect(raw.version).toBe(3);
    raw.close();
  });
});

describe('a database left by a newer build', () => {
  it('still saves players when it has no outbox, photos or syncMeta store', async () => {
    const seed = await openDB(DB_NAME, 9, {
      upgrade(d) {
        d.createObjectStore('players', { keyPath: 'id' });
      },
    });
    await seed.put('players', { id: 'p1', name: 'Ann', photoVersion: 2, updatedAt: 1 });
    seed.close();

    const ben = await addRosterPlayer('Ben');
    expect((await listRoster()).map((p) => p.name)).toEqual(['Ann', 'Ben']);
    expect((await listRoster())[0].photoSeq).toBe(2); // read as the photo count, since the row has none
    expect(await getRosterEntry(ben.id)).toBeDefined();
    expect(await listOutbox()).toEqual([]);
    expect(await getSyncMeta('cursor')).toBeUndefined();
    await expect(setSyncMeta('cursor', 'x')).resolves.toBeUndefined();
  });

  it('still refuses a photo when it has no photos store, and saves nothing of that change', async () => {
    const seed = await openDB(DB_NAME, 9, {
      upgrade(d) {
        d.createObjectStore('players', { keyPath: 'id' });
      },
    });
    await seed.put('players', { id: 'p1', name: 'Ann', photoVersion: 0, updatedAt: 1 });
    seed.close();

    await expect(setRosterPhoto('p1', { type: 'image/jpeg', data: new Uint8Array([1]).buffer })).rejects.toThrow();
    expect(await getRosterEntry('p1')).toMatchObject({ photoVersion: 0, photoSeq: 0 });
  });
});

describe('two tabs of the app', () => {
  /** A second copy of the module is a second tab: its own connection and its own queue. */
  async function secondTab() {
    vi.resetModules();
    return import('./rosterDb');
  }

  it('do not overwrite each other when both change the same player at once', async () => {
    const ann = await addRosterPlayer('Ann');
    const tabB = await secondTab();
    const photo = (n: number) => ({ type: 'image/jpeg', data: new Uint8Array([n]).buffer });

    await Promise.all([setRosterPhoto(ann.id, photo(1)), tabB.setRosterPhoto(ann.id, photo(2))]);
    await Promise.all([tabB.markRosterPlayed([ann.id], 9_000), setRosterPhoto(ann.id, photo(3))]);

    const entry = await getRosterEntry(ann.id);
    expect(entry).toMatchObject({ photoVersion: 3, photoSeq: 3, lastPlayedAt: 9_000 });
    expect(await listOutbox()).toEqual([{ playerId: ann.id, rev: 5 }]); // added, then four changes
  });

  it('do not create the same name twice when both add it at once', async () => {
    const tabB = await secondTab();
    await Promise.all([addRosterPlayer('Ann'), tabB.addRosterPlayer('ann')]);
    expect(await listRoster()).toHaveLength(1);
  });
});
```

- [ ] **Step 3: One existing assertion gains the new field**

  In `src/store/rosterDb.test.ts`, replace:

```ts
expect(p).toMatchObject({ name: 'Ann', photoVersion: 0, updatedAt: 1_234 });
```

  with:

```ts
expect(p).toMatchObject({ name: 'Ann', photoVersion: 0, photoSeq: 0, updatedAt: 1_234 });
```

- [ ] **Step 4: The in-memory fallback imports the new functions**

  In `src/store/rosterDb.fallback.test.ts`, replace:

```ts
import {
  addRosterPlayer,
  deleteRosterPlayer,
  getRosterPhoto,
```

  with:

```ts
import {
  ackOutbox,
  addRosterPlayer,
  getRosterEntry,
  getSyncMeta,
  listOutbox,
  queueAllForSync,
  setSyncMeta,
  deleteRosterPlayer,
  getRosterPhoto,
```

- [ ] **Step 5: Two tests for the in-memory fallback**

  In `src/store/rosterDb.fallback.test.ts`, replace:

```ts
  it('starts fresh after a reset'
```

  with:

```ts
  it('keeps the outbox, the photo sequence and the sync values in memory too', async () => {
    const ann = await addRosterPlayer('Ann');
    expect(await listOutbox()).toEqual([{ playerId: ann.id, rev: 1 }]);
    await setRosterPhoto(ann.id, { type: 'image/jpeg', data: new Uint8Array([7]).buffer });
    await removeRosterPhoto(ann.id);
    expect(await getRosterEntry(ann.id)).toMatchObject({ photoVersion: 0, photoSeq: 1 });
    const [entry] = await listOutbox();
    expect(entry.rev).toBe(3);
    await ackOutbox(ann.id, 1); // stale: keeps the newer mark
    expect(await listOutbox()).toHaveLength(1);
    await ackOutbox(ann.id, entry.rev);
    expect(await listOutbox()).toEqual([]);
    expect(await queueAllForSync()).toBe(1);
    await setSyncMeta('cursor', 'c1');
    expect(await getSyncMeta('cursor')).toBe('c1');
  });

  it('puts the outbox back too when a change fails', async () => {
    const ann = await addRosterPlayer('Ann');
    await ackOutbox(ann.id, 1);
    const data = new Uint8Array([1]).buffer;
    structuredClone(data, { transfer: [data] });
    await expect(setRosterPhoto(ann.id, { type: 'image/jpeg', data })).rejects.toThrow();
    expect(await listOutbox()).toEqual([]);
    await addRosterPlayer('Ben');
    expect((await listOutbox())[0].rev).toBe(2); // the failed change did not use up a revision
  });

  it('starts fresh after a reset'
```

- [ ] **Step 6: Run them and see them fail**

  Run:

```bash
npx vitest run src/store/rosterDb.outbox.test.ts src/store/rosterDb.upgrade.test.ts src/store/rosterDb.fallback.test.ts src/store/rosterDb.test.ts
```

  Expected: many failures, with messages such as `TypeError: (0 , listOutbox) is not a function` and `AssertionError: expected undefined to be +0` (the new `photoSeq`). The summary reads `Tests  23 failed | 21 passed (44)`. The upgrade file may also report `Hook timed out in 10000ms`; that comes from the missing code too and goes away with it. Do not fix anything yet.


### Task 2: Rewrite the roster database: version 3, one transaction per change, the outbox and the photo sequence

This is the whole change. `run(work)` opens one read-write transaction over players, photos and the outbox and rolls everything back if `work` throws; every roster function now goes through it. That is what puts a change and its mark together, and what stops two tabs from overwriting each other, because the read and the write are now in the same transaction. The in-memory fallback copies the same shape and restores a snapshot on failure. Each mark gets a revision from one counter kept in `syncMeta`, so a revision is never reused. `setRosterPhoto` writes the photo last on purpose: if the bytes cannot be stored, the player and mark written just before are rolled back, which is what the "saves nothing at all" tests check. The new exports at the bottom are what Plan 3B2 builds on. One existing app test is hardened in the same task: when a session ends, `LiveScreen` tells the roster who played without waiting for the answer, and the test "ends the session, shows the summary, and remembers the players for next time" tapped "Same as last session" without waiting for it. It failed once in seven full runs before this plan, and more often once each write did more work (3 of 6 runs, until the revision counter was read once per transaction instead of once per player). The test now waits for the roster to record the five players.

**Files:**
- Modify: `src/store/rosterDb.ts` (replaced)
- Modify: `src/ui/App.test.tsx`

- [ ] **Step 1: Replace the file**

  Replace the whole contents of `src/store/rosterDb.ts` with:

```ts
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
```

- [ ] **Step 2: Run the roster tests**

  Run:

```bash
npx vitest run src/store
```

  Expected: every roster test passes, old and new. The summary reads `Tests  82 passed (82)`.

- [ ] **Step 3: Typecheck**

  Run:

```bash
npm run typecheck
```

  Expected: no output after the command line.

- [ ] **Step 4: Make one app test wait for the roster, instead of racing it**

  In `src/ui/App.test.tsx`, replace:

```ts
    expect(screen.getByRole('table')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start new session' }));
```

  with:

```ts
    expect(screen.getByRole('table')).toBeInTheDocument();
    // The roster is told who played in the background, so wait for that before asking for "Same as last session".
    await waitFor(() => expect(useRosterStore.getState().players.filter((p) => p.lastPlayedAt !== undefined)).toHaveLength(5));

    await user.click(screen.getByRole('button', { name: 'Start new session' }));
```

- [ ] **Step 5: Commit**

```bash
git add src/store/rosterDb.ts src/store/rosterDb.outbox.test.ts src/store/rosterDb.upgrade.test.ts src/store/rosterDb.test.ts src/store/rosterDb.fallback.test.ts src/ui/App.test.tsx
git commit -m "feat: roster database version 3 with an outbox, one transaction per change and a photo sequence"
```


### Task 3: Ask the browser to keep the saved players

Safari can clear the site data of a browser tab after about a week without a visit. Once players or photos are saved, and especially once there are changes not yet pushed, losing them would hurt, so the app asks the browser to protect its storage. The call is cheap, repeats safely, never throws, and does nothing where the browser has no such call.

**Files:**
- Create: `src/lib/persist.ts`
- Create: `src/lib/persist.test.ts`
- Modify: `src/store/rosterStore.ts`
- Modify: `src/store/rosterStore.test.ts`

- [ ] **Step 1: The tests for the helper**

  Create `src/lib/persist.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPersistentStorage } from './persist';

function stubStorage(storage: unknown) {
  vi.stubGlobal('navigator', { ...navigator, storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestPersistentStorage', () => {
  it('asks the browser to protect storage, and says whether it did', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    stubStorage({ persisted: vi.fn().mockResolvedValue(false), persist });
    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('does not ask again when storage is already protected', async () => {
    const persist = vi.fn();
    stubStorage({ persisted: vi.fn().mockResolvedValue(true), persist });
    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('reports false when the browser says no', async () => {
    stubStorage({ persisted: vi.fn().mockResolvedValue(false), persist: vi.fn().mockResolvedValue(false) });
    expect(await requestPersistentStorage()).toBe(false);
  });

  it('does nothing where the browser has no such call', async () => {
    stubStorage(undefined);
    expect(await requestPersistentStorage()).toBe(false);
    stubStorage({});
    expect(await requestPersistentStorage()).toBe(false);
  });

  it('never throws', async () => {
    stubStorage({ persisted: vi.fn().mockRejectedValue(new Error('boom')), persist: vi.fn() });
    expect(await requestPersistentStorage()).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

  Run:

```bash
npx vitest run src/lib/persist.test.ts
```

  Expected: the file fails to load with `Failed to resolve import "./persist" from "src/lib/persist.test.ts". Does the file exist?`

- [ ] **Step 3: The helper**

  Create `src/lib/persist.ts`:

```ts
/**
 * Asks the browser not to clear saved players and photos when it needs space. A browser tab on Safari can lose site data
 * after about a week without a visit. Returns whether storage is now protected. Never throws, and does nothing where
 * the browser has no such call.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (!storage?.persist) return false;
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run them again**

  Run:

```bash
npx vitest run src/lib/persist.test.ts
```

  Expected: The summary reads `Tests  5 passed (5)`.

- [ ] **Step 5: A test that the store asks after an add and after a photo (imports)**

  In `src/store/rosterStore.test.ts`, replace:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
```

  with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
```

- [ ] **Step 6: A test that the store asks after an add and after a photo**

  In `src/store/rosterStore.test.ts`, replace:

```ts
describe('rosterStore', () => {
```

  with:

```ts
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rosterStore', () => {
  it('asks the browser to keep the saved players once there is one, and again for a photo', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('navigator', { ...navigator, storage: { persisted: vi.fn().mockResolvedValue(false), persist } });
    expect(persist).not.toHaveBeenCalled();
    const ann = await useRosterStore.getState().add('Ann');
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
    await useRosterStore.getState().setPhoto(ann.id, { type: 'image/jpeg', data: new Uint8Array([1]).buffer });
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2));
  });

```

- [ ] **Step 7: Run it and see it fail**

  Run:

```bash
npx vitest run src/store/rosterStore.test.ts
```

  Expected: the new test fails with `expected "spy" to be called 1 times, but got 0 times`. The summary reads `Tests  1 failed | 6 passed (7)`.

- [ ] **Step 8: Call the helper from the store (import)**

  In `src/store/rosterStore.ts`, replace:

```ts
import { create } from 'zustand';
```

  with:

```ts
import { create } from 'zustand';
import { requestPersistentStorage } from '../lib/persist';
```

- [ ] **Step 9: Call the helper after an add**

  In `src/store/rosterStore.ts`, replace:

```ts
      const player = await addRosterPlayer(name);
      await refresh();
      return player;
```

  with:

```ts
      const player = await addRosterPlayer(name);
      void requestPersistentStorage(); // once there is something worth keeping
      await refresh();
      return player;
```

- [ ] **Step 10: Call the helper after a photo**

  In `src/store/rosterStore.ts`, replace:

```ts
      await setRosterPhoto(id, photo);
      await refresh();
```

  with:

```ts
      await setRosterPhoto(id, photo);
      void requestPersistentStorage();
      await refresh();
```

- [ ] **Step 11: Run the store tests**

  Run:

```bash
npx vitest run src/store/rosterStore.test.ts src/lib/persist.test.ts
```

  Expected: all pass. The summary reads `Tests  12 passed (12)`.

- [ ] **Step 12: Commit**

```bash
git add src/lib/persist.ts src/lib/persist.test.ts src/store/rosterStore.ts src/store/rosterStore.test.ts
git commit -m "feat: ask the browser to keep the saved players once there are some"
```


### Task 4: Bring the design spec in line with the code

The spec still says sign-in is an emailed code, that changes are "appended" to the outbox, and has no `photoSeq` on the roster player. Fixing five lines now keeps it the source of truth for Plans 3B2 and 3B3.

**Files:**
- Modify: `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md`

- [ ] **Step 1: Fix the summary line**

  In `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md`, replace:

```markdown
When the organizer is signed in (email code, no password), they sync
```

  with:

```markdown
When the organizer is signed in (an emailed link, no password), they sync
```

- [ ] **Step 2: Fix the RosterPlayer shape**

  In `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md`, replace:

```markdown
  photoVersion: number,  // 0 = no photo; increments each time the photo changes
```

  with:

```markdown
  photoVersion: number,  // 0 = no photo; increments each time the photo changes, back to 0 on removal
  photoSeq: number,      // only ever goes up, even on removal; names the photo's file online
```

- [ ] **Step 3: Fix the list of stores**

  In `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md`, replace:

```markdown
`outbox` (changes not yet pushed), `syncMeta` (last pull cursor, signed-in user).
```

  with:

```markdown
`outbox` (one mark per player with changes not yet pushed, each with a revision that is never reused), `syncMeta` (last pull cursor, signed-in user, and the last outbox revision).
```

- [ ] **Step 4: Fix the sign-in method**

  In `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md`, replace:

```markdown
**Auth.** Supabase Auth email one-time code (6 digits, no password). The session persists on the device.
```

  with:

```markdown
**Auth.** Supabase Auth emailed magic link (no password). The link brings the organizer back to the app, which picks the session up from the page address. The session persists on the device.
```

- [ ] **Step 5: Fix the first sync step**

  In `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md`, replace:

```markdown
is written to IndexedDB and appended to the `outbox` immediately.
```

  with:

```markdown
is written to IndexedDB, and the player is marked in the `outbox`, in one transaction. A mark says only that the player has changes not yet pushed; the push reads the player's current state.
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md
git commit -m "docs: spec now says magic link, a mark per player in the outbox, and photoSeq"
```


### Task 5: Run everything

A last check of the whole suite, the typecheck and the production build, to see that the new code did not disturb anything.

**Files:**
- No files change.

- [ ] **Step 1: Run the full suite**

  Run:

```bash
npm test
```

  Expected: every test passes, The summary reads `Tests  311 passed (311)`. The count was 283 before this plan.

- [ ] **Step 2: Typecheck and build**

  Run:

```bash
npm run build
```

  Expected: the build finishes and prints the precache size. With the two Supabase settings unset it is about 215 KiB.


### Task 6: Check the upgrade in a real browser, with a real version 2 database

The unit tests use a fake IndexedDB. This task proves the upgrade on a real engine, with players and a photo that an earlier build saved. It takes about ten minutes on a laptop. It was run once while this plan was written, in the built-in browser of the Claude desktop app, and every result below was observed there. That run fed the photo picker a small generated JPEG by script, because a script cannot open the system file dialog; you pick a real photo by hand. The revision numbers are only examples: they depend on what you did before, and they only ever go up.

**Files:**
- No files change.

- [ ] **Step 1: Save data with the old build**

  Build and serve the commit this plan started from, so the browser creates a version 2 database:
  
  ```bash
  git worktree add /tmp/pikl-old 3903c5c
  cd /tmp/pikl-old && npm ci && npm run build && npx vite preview --port 4173 --strictPort
  ```
  
  Open `http://localhost:4173/`. On the Setup screen, type `Ann`, `Ben` and `Cy` into **Add players** (one per line) and tap **Add**. Then open **Manage saved players**, tap Ann's avatar and give her a photo (**Choose from library**, then **Use photo**). In DevTools, Application, IndexedDB, `pickleball-roster`: the version is `2`, there are `players` and `photos` stores, and one record in `photos`. Stop the server with Ctrl+C.

- [ ] **Step 2: Open the same address with the new build**

  From this plan's working tree, on the same port, so the browser keeps the same site data:
  
  ```bash
  npm run build && npx vite preview --port 4173 --strictPort
  ```
  
  Reload `http://localhost:4173/`. (If the old build's service worker is still active, the app offers **Reload now**; tap it.) Check:
  
  - [ ] **Manage saved players** lists `Ann`, `Ben` and `Cy`, and Ann still shows her photo.
  - [ ] DevTools shows the database at version `3` with the stores `outbox`, `photos`, `players` and `syncMeta`.
  - [ ] `outbox` is empty and `syncMeta` is empty: nothing has changed yet. The stored players have no `photoSeq` yet; that is expected, because it is filled in when a player is read.
  - [ ] Rename `Cy` to `Cyrus`. `outbox` has one record for that player (revision 1 on a fresh run), and `syncMeta` now has the key `outboxRev`.
  - [ ] Change Ann's photo. Her `photoVersion` is `2` and her `photoSeq` is `2` (the old photo count of 1, plus one). She has a second `outbox` record with a higher revision.
  - [ ] Remove Ann's photo: `photoVersion` is `0`, `photoSeq` stays `2`, and `photos` is empty. Add a photo again: `photoVersion` is `1` and `photoSeq` is `3`.
  - [ ] Open the app in a second tab, go to **Manage saved players**, and rename Ann to `Annie` there. Go back to the first tab, which still shows `Ann`, and change her photo from there. Afterwards she is still `Annie` (the first tab did not bring back the old name), `photoVersion` is `2`, `photoSeq` is `4`, and her revision is higher than the one the rename in the second tab got, because both tabs share one counter.
  
  Then stop the server and clean up: `git worktree remove /tmp/pikl-old`.


---

## Self-review

**Spec coverage** (spec sections "Saved roster (local-first)" and "Sync and backend", the local half only):

| Spec requirement | Where |
|---|---|
| IndexedDB stores `players`, `photos`, `outbox`, `syncMeta` | Task 2 (version 3) |
| Every roster change is written to IndexedDB and marked in the outbox "immediately" | Task 2: one transaction per change; tested in Task 1 |
| A device keeps working with no signal | Nothing here touches the network |
| `photo_seq` locally, so a re-added photo never reuses a path | Task 2 (`photoSeq`); tests in Task 1 |
| A device that cannot use IndexedDB still works | Task 2 (memory fallback with rollback); tests in Task 1 |
| The upgrade keeps saved players and photos | Task 2; tested in Task 1 and checked in a real browser in Task 6 |
| Two tabs cannot overwrite each other (Plan 2 review) | Task 2; tested in Task 1 |
| Storage eviction (Plan 2 review) | Task 3 |

Not in this plan on purpose: pushing, pulling, merging, validating pulled rows, uploading photos, the first sign-in, "Delete all my data", the status line and the banner. These are Plans 3B2 and 3B3.

**Placeholder scan:** none. Every step has the exact text to write or the exact command to run.

**Type consistency:** `OutboxEntry` (`playerId`, `rev`) is defined in Task 2 and used unchanged by `listOutbox`, `ackOutbox` and the tests. `RosterPlayer.photoSeq` is required, and every read fills it in, so no caller sees it missing. `getRosterEntry`, `listOutbox`, `ackOutbox`, `queueAllForSync`, `getSyncMeta` and `setSyncMeta` are the only new exports of `rosterDb.ts`, and Plan 3B2 builds on exactly these. `requestPersistentStorage` is the only export of `persist.ts`.

**What Plan 3B2 can rely on:** a mark for every changed player with a revision that is never reused; `ackOutbox(playerId, rev)` to clear a mark safely; `getRosterEntry` to read a player including a deleted one; `queueAllForSync()` for the first sign-in; `getSyncMeta` and `setSyncMeta` for the cursor and the signed-in user (not the key `outboxRev`); and `photoSeq` to name photo files.

**Known limits, carried to 3B2 and 3B3:**
- A blocked upgrade (another tab that never lets go) still waits with only a console warning. The message for it belongs to the screens plan.
- If another account signs in on the same device, the marks and the cursor belong to the first account. 3B2 must record which user the local data was last synced with, and decide what to do when it differs.
- The two-tab test uses two copies of the module in one browser engine, which proves the code reads and writes in one transaction. It does not prove how two real tabs interleave on a phone.
