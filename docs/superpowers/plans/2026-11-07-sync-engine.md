# Sync Engine Implementation Plan (Plan 3B2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While an organizer is signed in, back up the saved players and their photos to their Supabase account, and bring back what changed on another device, in the background. Nothing new appears on screen except one sentence in Settings; the sync status line, the sign-in banner and "Delete all my data" are Plan 3B3.

**Architecture:** The engine is plain functions over two small interfaces: the roster database (Plan 3B1) and a `Remote` (the server). `syncOnce` pushes every player marked in the outbox, then pulls what changed on the server. A runner schedules rounds, and a coordinator starts it when someone signs in and stops it when they do not. The engine is tested against the real database rules (the migrations, run in an in-memory Postgres) and two simulated devices, and the Supabase adapter is tested against the real client library with the network stubbed.

**Tech Stack:** TypeScript, `@supabase/supabase-js` 2.118 (already installed), Zustand 5, Vitest 3 with `fake-indexeddb` and `@electric-sql/pglite` (added in Plan 3A). No new dependency.

**Roadmap:** Plan 3A (Supabase backend and sign-in) and Plan 3B1 (local data for sync) are live. **Plan 3B2 is this plan:** the sync engine. **Plan 3B3 (not written yet):** the screens: the sync status line, the sign-in banner, "Delete all my data", a way out of the "another account" state, and a message for a blocked database upgrade.

**Follow-ups this plan absorbs:** from `docs/superpowers/notes/2026-11-06-follow-ups-and-plan-2-3-prerequisites.md` and the end of the Plan 3A plan: push one row per request; pull with an overlap; make the merge safe to repeat; normalise names the way the database does; upload with `contentType: 'image/jpeg'` and `upsert: false` and the owner id in lower case; validate every pulled row; treat the `unknown` sign-in state as "do not sync, do not clear"; start sync outside the sign-in listener; remember which account the local data was last synced with; the first-sign-in union by name. Left for later: loading the Supabase client on demand (the app still loads it up front), and every screen item named above.

---

## Decisions made while planning

1. **Push first, then pull, one player per request.** The server's unique name rule refuses a whole batch with one error that cannot say which row clashed, so each player is its own request. Deleted players go first, because a deleted player's name is free again and a new player may want it. A marked player is read as it is now, not as it was when it was marked, so the push always converges.
2. **A name clash is either a duplicate or a queue.** When the server refuses a name, the engine looks up who holds it. If that holder has its own rename or deletion still waiting in the outbox, the push waits and goes again after the others (up to six passes). If the holder is unknown here, or has nothing waiting, it is the same person saved twice: merge. If every waiting player is blocked by another (a rename swap: Ann becomes Bob while Bob becomes Ann), one is pushed under a temporary name (`Ann #1a2b3c4d`) so the rest can go, and the real name follows in the next pass. Nobody is parked while another player was refused outright, because that player may be the holder and waiting is then right (checking the tests by breaking the code on purpose found that the first version got this wrong).
3. **A merge keeps the server's player.** The other entry stays on this device as a deleted entry that is not pushed (so nothing breaks if a running session still names it), the kept player adopts its photo when they have none and its later `lastPlayedAt`, and whatever the kept player gains is marked for a push. The pulled copy is saved before the other entry is retired, so a crash halfway repeats the merge instead of losing the player. The spec said the local photo is adopted; this adds the played time too, because "Same as last session" depends on it.
4. **The picture goes up before the row that points at it.** The spec listed the row first. That would let another device pull a row whose picture is not there yet and, because it never asks again, show initials for good. Uploading first means a failed push can leave a stray file, which the next push of that player removes: it lists the player's folder and deletes every file except the current one (every file, for a deleted player or one with no photo). A player who never had a photo costs no extra request.
5. **Pull with an overlap, and move the cursor last.** Rows are asked for from two minutes before the cursor, oldest write first, because a write that started earlier can commit after the cursor passed it. Saving a row that has not changed is a no-op, so repeating is safe. The cursor moves only after every row is saved, so a download that fails halfway is simply read again.
6. **A change still waiting always wins over a pulled row.** `applyPulledPlayer` leaves a marked player alone; the change is pushed in the next round and then pulled back as the server's truth. Pulled changes are saved without a mark, so syncing never marks anything for syncing.
7. **Every pulled row is checked.** A row is skipped (and counted) when its id is not a uuid, its name is empty after trimming, a number is not a whole number in range, or a time is not a time. Names are trimmed the way JavaScript trims, which strips more than the database's `btrim`, so a name that is only a tab is skipped and one ending in a no-break space is cleaned.
8. **A photo that cannot be found is shown as no photo.** If the server row says there is a photo and the file is gone, the player is saved without one. A download that fails because the network is down stops the pull instead, so it is retried whole.
9. **One account per device.** The first sync records the account in `syncMeta` (`syncUser`) and marks every saved player for a push, which is the first-sign-in union: names the account already has are merged when each player is pushed. Another account signing in on the same device is refused (`otherAccount`) and nothing is touched, so one person's players and photos are never copied into another person's account. The way out (sign out and clear this device) belongs to Plan 3B3.
10. **Rounds run one at a time, on a schedule.** After a good round the next waits for a change (two seconds, so a burst of changes is one round) or five minutes. No connection retries after 30 seconds and when the browser says it is back online; a refused session after a minute; a failing server waits 5, 10, 20 seconds and so on up to five minutes; "another account" does not retry. Coming back to the app syncs again unless a round ended less than 30 seconds ago.
11. **Sync starts outside the sign-in listener, and only for a signed-in account.** The coordinator watches the sign-in store (not the Supabase listener), and the runner begins on a timer. A session that could not be checked (`unknown`), no backend, and signed out all mean no sync, and nothing is cleared.
12. **The Settings sentence changes.** It said backing up "comes in a later update". It now says signed-in players and photos are backed up and shared between devices. There is still no status line, so the only ways to see sync are the other device and the Supabase tables (Task 7).

## Conventions

- Tests first: a task writes its tests, runs them to see them fail, then makes them pass.
- No em dashes in any text you write. Commit messages are plain: no tool names, no co-author lines.
- Run commands from the project root.
- `npm test` runs every test once. Before this plan it reports 311 passing.

## Rollout

This plan turns on backing up for anyone who is signed in, as soon as it is on production. Everything it does to the server is an insert or an update of that organizer's own rows and files, and the server's rules (row-level security, no hard deletes) apply as in Plan 3A. On the device it only adds or updates players from the server, and deletes a player only when the server says that player is deleted (which only this app writes) or when it merges a duplicate into the player the server already has. Merging the plan changes nothing for a visitor who is not signed in, except one sentence in Settings. Task 7 checks it end to end on the real project after deploying; if something is wrong, revert the merge: the rows already on the server are harmless.

## File structure

| File | What changes |
|---|---|
| `src/store/rosterDb.ts` | Adds `applyPulledPlayer`, `mergeLocalInto`, `subscribeRosterChanges` and three transaction helpers |
| `src/store/rosterDb.sync.test.ts` | New: tests for those |
| `src/sync/rows.ts`, `rows.test.ts` | New: check a row from the server, make a row to send |
| `src/sync/remote.ts`, `remote.test.ts`, `remote.wire.test.ts` | New: the `Remote` interface and the Supabase adapter, tested with a fake client and with the real client library over a stubbed network |
| `src/sync/fakeServer.ts`, `src/sync/device.ts` | New: test helpers, a server with the real database rules and a second simulated device |
| `src/sync/engine.ts`, `engine.test.ts` | New: `syncOnce`, push and pull |
| `src/sync/auth.ts`, `auth.test.ts` | The sign-in store keeps the account id |
| `src/sync/runner.ts`, `runner.test.ts` | New: schedules rounds |
| `src/sync/syncStore.ts` | New: the status the screens will show |
| `src/sync/coordinator.ts`, `coordinator.test.ts` | New: starts and stops the runner |
| `src/ui/App.tsx`, `src/ui/SettingsScreen.tsx`, `src/ui/syncWiring.test.tsx` | Start the coordinator; one sentence changes |
| `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md` | Five spec lines brought in line |

### Task 1: Local data: save a pulled row, merge two entries, hear about changes

The sync engine needs three things from the roster database that Plan 3B1 did not give it: to save a row pulled from the server without marking the player for a push, to merge two entries that are really one player, and a way for the app to hear that a change was made on this device. This task adds them with their tests.

**Files:**
- Create: `src/store/rosterDb.sync.test.ts`
- Modify: `src/store/rosterDb.ts`

- [ ] **Step 1: Write the tests**

  Create `src/store/rosterDb.sync.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addRosterPlayer,
  applyPulledPlayer,
  deleteRosterPlayer,
  getRosterEntry,
  getRosterPhoto,
  listOutbox,
  markRosterPlayed,
  mergeLocalInto,
  removeRosterPhoto,
  renameRosterPlayer,
  resetRosterDbForTests,
  setRosterPhoto,
  setSyncMeta,
  subscribeRosterChanges,
  ackOutbox,
  type PhotoData,
  type PulledPlayer,
} from './rosterDb';

beforeEach(async () => {
  await resetRosterDbForTests();
});

const jpeg = (...bytes: number[]): PhotoData => ({ type: 'image/jpeg', data: new Uint8Array(bytes).buffer });
const bytesOf = (photo: PhotoData | undefined) => (photo ? [...new Uint8Array(photo.data)] : undefined);
const row = (over: Partial<PulledPlayer> = {}): PulledPlayer => ({
  id: 'p1',
  name: 'Ann',
  photoVersion: 0,
  photoSeq: 0,
  updatedAt: 5_000,
  ...over,
});

describe('saving a pulled row', () => {
  it('adds a player this device did not have, without marking them for a push', async () => {
    expect(await applyPulledPlayer(row({ lastPlayedAt: 4_000 }), undefined)).toBe('applied');
    expect(await getRosterEntry('p1')).toEqual({
      id: 'p1',
      name: 'Ann',
      photoVersion: 0,
      photoSeq: 0,
      lastPlayedAt: 4_000,
      updatedAt: 5_000,
    });
    expect(await listOutbox()).toEqual([]);
  });

  it('leaves a player alone while they have a change waiting to be pushed', async () => {
    const ann = await addRosterPlayer('Ann');
    expect(await applyPulledPlayer(row({ id: ann.id, name: 'Annie' }), undefined)).toBe('pending');
    expect(await getRosterEntry(ann.id)).toMatchObject({ name: 'Ann' });
  });

  it('changes a player that has nothing waiting, and says unchanged when it would change nothing', async () => {
    await applyPulledPlayer(row(), undefined);
    expect(await applyPulledPlayer(row({ name: 'Annie', updatedAt: 6_000 }), undefined)).toBe('applied');
    expect(await getRosterEntry('p1')).toMatchObject({ name: 'Annie', updatedAt: 6_000 });
    expect(await applyPulledPlayer(row({ name: 'Annie', updatedAt: 7_000 }), undefined)).toBe('unchanged');
    expect(await getRosterEntry('p1')).toMatchObject({ updatedAt: 6_000 });
  });

  it('stores a downloaded photo with the row, and keeps the photo already here when told nothing', async () => {
    await applyPulledPlayer(row({ photoVersion: 1, photoSeq: 1 }), jpeg(1, 2));
    expect(bytesOf(await getRosterPhoto('p1'))).toEqual([1, 2]);
    expect(await applyPulledPlayer(row({ name: 'Annie', photoVersion: 1, photoSeq: 1 }), undefined)).toBe('applied');
    expect(bytesOf(await getRosterPhoto('p1'))).toEqual([1, 2]);
    expect(await getRosterEntry('p1')).toMatchObject({ photoVersion: 1, photoSeq: 1 });
  });

  it('removes the photo when the row has none, and when its picture could not be found', async () => {
    await applyPulledPlayer(row({ photoVersion: 1, photoSeq: 1 }), jpeg(1));
    await applyPulledPlayer(row({ photoVersion: 0, photoSeq: 1, updatedAt: 6_000 }), undefined);
    expect(await getRosterPhoto('p1')).toBeUndefined();
    expect(await getRosterEntry('p1')).toMatchObject({ photoVersion: 0, photoSeq: 1 });

    await applyPulledPlayer(row({ photoVersion: 2, photoSeq: 2, updatedAt: 7_000 }), jpeg(2));
    await applyPulledPlayer(row({ photoVersion: 3, photoSeq: 3, updatedAt: 8_000 }), null);
    expect(await getRosterPhoto('p1')).toBeUndefined();
    expect(await getRosterEntry('p1')).toMatchObject({ photoVersion: 0, photoSeq: 3 });
  });

  it('never lowers the photo sequence', async () => {
    await applyPulledPlayer(row({ photoVersion: 1, photoSeq: 5 }), jpeg(1));
    await applyPulledPlayer(row({ photoVersion: 0, photoSeq: 2, updatedAt: 6_000 }), undefined);
    expect(await getRosterEntry('p1')).toMatchObject({ photoSeq: 5 });
  });

  it('deletes a player the server deleted, with their photo, and ignores one it never had', async () => {
    await applyPulledPlayer(row({ photoVersion: 1, photoSeq: 1 }), jpeg(1));
    expect(await applyPulledPlayer(row({ deletedAt: 9_000, updatedAt: 9_000, photoVersion: 1, photoSeq: 1 }), undefined)).toBe('applied');
    expect(await getRosterEntry('p1')).toMatchObject({ deletedAt: 9_000 });
    expect(await getRosterPhoto('p1')).toBeUndefined();
    expect(await applyPulledPlayer(row({ deletedAt: 9_000, updatedAt: 9_000 }), undefined)).toBe('unchanged');
    expect(await applyPulledPlayer(row({ id: 'other', deletedAt: 9_000 }), undefined)).toBe('unchanged');
    expect(await getRosterEntry('other')).toBeUndefined();
    expect(await listOutbox()).toEqual([]);
  });

  it('does not tell the app about it, so syncing does not set off another sync', async () => {
    const listener = vi.fn();
    subscribeRosterChanges(listener);
    await applyPulledPlayer(row(), undefined);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('merging two entries for one player', () => {
  async function pair() {
    await applyPulledPlayer(row({ id: 'kept', name: 'Ann' }), undefined);
    return addRosterPlayer('Ann2'); // a different local entry, with a mark
  }

  it('retires the local entry for good and clears its mark', async () => {
    const local = await pair();
    await mergeLocalInto(local.id, 'kept', 10_000);
    expect(await getRosterEntry(local.id)).toMatchObject({ deletedAt: 10_000 });
    expect(await listOutbox()).toEqual([]);
  });

  it('gives the kept player the local photo when they have none', async () => {
    const local = await pair();
    await setRosterPhoto(local.id, jpeg(7));
    await mergeLocalInto(local.id, 'kept', 10_000);
    expect(await getRosterEntry('kept')).toMatchObject({ photoVersion: 1, photoSeq: 1, updatedAt: 10_000 });
    expect(bytesOf(await getRosterPhoto('kept'))).toEqual([7]);
    expect(await getRosterPhoto(local.id)).toBeUndefined();
    expect((await listOutbox()).map((e) => e.playerId)).toEqual(['kept']);
  });

  it('keeps the photo the kept player has, and takes the later played time', async () => {
    const local = await pair();
    await applyPulledPlayer(row({ id: 'kept', photoVersion: 1, photoSeq: 4, lastPlayedAt: 2_000, updatedAt: 6_000 }), jpeg(1));
    await setRosterPhoto(local.id, jpeg(7));
    await markRosterPlayed([local.id], 3_000);
    await mergeLocalInto(local.id, 'kept', 10_000);
    expect(bytesOf(await getRosterPhoto('kept'))).toEqual([1]);
    expect(await getRosterEntry('kept')).toMatchObject({ photoSeq: 4, lastPlayedAt: 3_000 });
    expect((await listOutbox()).map((e) => e.playerId)).toEqual(['kept']);
  });

  it('marks nothing when the kept player gains nothing', async () => {
    const local = await pair();
    await mergeLocalInto(local.id, 'kept', 10_000);
    expect(await listOutbox()).toEqual([]);
    expect(await getRosterEntry('kept')).toMatchObject({ updatedAt: 5_000 });
  });

  it('refuses when either player is missing', async () => {
    const local = await pair();
    await expect(mergeLocalInto('nobody', 'kept')).rejects.toThrow();
    await expect(mergeLocalInto(local.id, 'nobody')).rejects.toThrow();
    await expect(mergeLocalInto('kept', 'kept')).rejects.toThrow();
    expect(await getRosterEntry(local.id)).toMatchObject({ name: 'Ann2' });
  });
});

describe('hearing about changes made on this device', () => {
  it('is told after every kind of change, and stops when asked to', async () => {
    const listener = vi.fn();
    const stop = subscribeRosterChanges(listener);
    const ann = await addRosterPlayer('Ann');
    await renameRosterPlayer(ann.id, 'Annie');
    await setRosterPhoto(ann.id, jpeg(1));
    await removeRosterPhoto(ann.id);
    await markRosterPlayed([ann.id], 1_000);
    await deleteRosterPlayer(ann.id);
    expect(listener).toHaveBeenCalledTimes(6);
    stop();
    await addRosterPlayer('Ben');
    expect(listener).toHaveBeenCalledTimes(6);
  });

  it('is not told about a change that failed, or about the sync engine bookkeeping', async () => {
    const listener = vi.fn();
    subscribeRosterChanges(listener);
    await expect(renameRosterPlayer('nobody', 'X')).rejects.toThrow();
    await ackOutbox('nobody', 1);
    await setSyncMeta('k', 1);
    expect(listener).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Watch them fail**

  Run:

```bash
npx vitest run src/store/rosterDb.sync.test.ts
```

  Expected: The summary reads `Tests  15 failed (15)`. Every test fails because the new functions do not exist yet (for example `applyPulledPlayer is not a function`).

- [ ] **Step 3: A transaction can read a photo and a mark, and clear a mark**

  In `src/store/rosterDb.ts`, replace:

```ts
  /** Marks the player as having changes to push. */
  markDirty(id: string): Promise<void>;
}
```

  with:

```ts
  /** Marks the player as having changes to push. */
  markDirty(id: string): Promise<void>;
  getPhoto(id: string): Promise<PhotoData | undefined>;
  /** The player's outbox mark, if there is one. */
  getMark(id: string): Promise<OutboxEntry | undefined>;
  /** Removes the player's mark whatever its revision. */
  clearMark(id: string): Promise<void>;
}
```

- [ ] **Step 4: Implement them for the database**

  In `src/store/rosterDb.ts`, replace:

```ts
          if (has('syncMeta')) await tx.objectStore('syncMeta').put(lastRev, REV_KEY);
        },
      };
```

  with:

```ts
          if (has('syncMeta')) await tx.objectStore('syncMeta').put(lastRev, REV_KEY);
        },
        async getPhoto(id) {
          if (!has('photos')) return undefined;
          const record = await tx.objectStore('photos').get(id);
          return record && { type: record.type, data: record.data };
        },
        async getMark(id) {
          return has('outbox') ? tx.objectStore('outbox').get(id) : undefined;
        },
        async clearMark(id) {
          if (has('outbox')) await tx.objectStore('outbox').delete(id);
        },
      };
```

- [ ] **Step 5: Implement them for the in-memory fallback**

  In `src/store/rosterDb.ts`, replace:

```ts
        markDirty: async (id) => {
          lastRev += 1;
          outbox.set(id, { playerId: id, rev: lastRev });
        },
      };
```

  with:

```ts
        markDirty: async (id) => {
          lastRev += 1;
          outbox.set(id, { playerId: id, rev: lastRev });
        },
        getPhoto: async (id) => {
          const p = photos.get(id);
          return p && { type: p.type, data: p.data.slice(0) };
        },
        getMark: async (id) => {
          const entry = outbox.get(id);
          return entry && { ...entry };
        },
        clearMark: async (id) => {
          outbox.delete(id);
        },
      };
```

- [ ] **Step 6: Let the app hear about changes made on this device**

  In `src/store/rosterDb.ts`, replace:

```ts
/** Runs a change as one transaction, after the earlier calls from this tab. */
function write<T>(work: (tx: RosterTx) => Promise<T>): Promise<T> {
  return serial(async () => (await db()).run(work));
}
```

  with:

```ts
const changeListeners = new Set<() => void>();

/**
 * Calls `listener` after a change made on this device is saved (an add, a rename, a photo, a delete, a played mark).
 * Changes the sync engine makes itself do not call it. Returns a function that stops listening.
 */
export function subscribeRosterChanges(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/** Runs a change as one transaction, after the earlier calls from this tab. */
function write<T>(work: (tx: RosterTx) => Promise<T>, { quiet = false } = {}): Promise<T> {
  return serial(async () => {
    const result = await (await db()).run(work);
    if (!quiet) changeListeners.forEach((listener) => listener());
    return result;
  });
}
```

- [ ] **Step 7: The sync engine needs to see a pulled row, and to merge a duplicate**

  In `src/store/rosterDb.ts`, replace:

```ts
/** Small values the sync engine keeps between visits, such as the last pull time. */
```

  with:

```ts
/** One player row as the server has it, checked, with times in milliseconds. */
export interface PulledPlayer {
  id: string;
  name: string;
  photoVersion: number;
  photoSeq: number;
  lastPlayedAt?: number;
  deletedAt?: number;
  /** Server time of the last write. */
  updatedAt: number;
}

/**
 * Saves a row pulled from the server, in one transaction, without marking the player for a push. Leaves the player
 * alone (`'pending'`) when they have a change still waiting to be pushed: that change wins and is pushed afterwards.
 * `photo` is the picture for the row's `photoSeq` when it had to be downloaded, `null` when the row has no usable
 * picture, and `undefined` when the picture on this device is already the right one.
 */
export function applyPulledPlayer(
  pulled: PulledPlayer,
  photo: PhotoData | null | undefined,
): Promise<'applied' | 'pending' | 'unchanged'> {
  return write(
    async (tx) => {
      if (await tx.getMark(pulled.id)) return 'pending';
      const local = await tx.get(pulled.id);
      if (pulled.deletedAt !== undefined) {
        // A player this device never had, or already deleted, needs nothing.
        if (!local || local.deletedAt !== undefined) return 'unchanged';
        await tx.put({ ...local, deletedAt: pulled.deletedAt, updatedAt: pulled.updatedAt });
        await tx.deletePhoto(pulled.id);
        return 'applied';
      }
      const hasPhoto = pulled.photoVersion > 0 && photo !== null;
      const next: RosterPlayer = {
        id: pulled.id,
        name: pulled.name,
        photoVersion: hasPhoto ? pulled.photoVersion : 0,
        // Only ever goes up, whatever the server says.
        photoSeq: Math.max(local?.photoSeq ?? 0, pulled.photoSeq),
        updatedAt: pulled.updatedAt,
        ...(pulled.lastPlayedAt === undefined ? {} : { lastPlayedAt: pulled.lastPlayedAt }),
      };
      const same =
        local !== undefined &&
        local.deletedAt === undefined &&
        local.name === next.name &&
        local.photoVersion === next.photoVersion &&
        local.photoSeq === next.photoSeq &&
        local.lastPlayedAt === next.lastPlayedAt;
      if (same && photo === undefined) return 'unchanged';
      await tx.put(next);
      if (photo) await tx.putPhoto(pulled.id, photo);
      else if (photo === null || pulled.photoVersion === 0) await tx.deletePhoto(pulled.id);
      return 'applied';
    },
    { quiet: true },
  );
}

/**
 * Two players that are really one (the same name saved on two devices): keeps `keepId`, the entry the server has,
 * and retires `localId`. The retired player stays on this device as a deleted entry that is never pushed. The kept
 * player adopts the retired one's photo when they have none, and the later played time. Whatever the kept player
 * gains is marked for a push.
 */
export function mergeLocalInto(localId: string, keepId: string, now = Date.now()): Promise<void> {
  return write(
    async (tx) => {
      const retired = await tx.get(localId);
      const kept = await tx.get(keepId);
      if (!retired || !kept || localId === keepId) throw new Error('Both players must exist to be merged.');
      let next = kept;
      const photo = retired.photoVersion > 0 ? await tx.getPhoto(localId) : undefined;
      if (kept.photoVersion === 0 && photo) {
        next = { ...next, photoVersion: 1, photoSeq: kept.photoSeq + 1 };
        await tx.putPhoto(keepId, photo);
      }
      if ((retired.lastPlayedAt ?? 0) > (kept.lastPlayedAt ?? 0)) next = { ...next, lastPlayedAt: retired.lastPlayedAt };
      if (next !== kept) {
        await tx.put({ ...next, updatedAt: now });
        await tx.markDirty(keepId);
      }
      await tx.put({ ...retired, deletedAt: now, updatedAt: now });
      await tx.deletePhoto(localId);
      await tx.clearMark(localId);
    },
    { quiet: true },
  );
}

/** Small values the sync engine keeps between visits, such as the last pull time. */
```

- [ ] **Step 8: Run the new tests**

  Run:

```bash
npx vitest run src/store/rosterDb.sync.test.ts
```

  Expected: every test passes. The summary reads `Tests  15 passed (15)`.

- [ ] **Step 9: Typecheck**

  Run:

```bash
npm run typecheck
```

  Expected: nothing is printed after the `tsc --noEmit` line.

- [ ] **Step 10: Run everything**

  Run:

```bash
npm test
```

  Expected: nothing else broke. The summary reads `Tests  326 passed (326)`. The count was 311 before this plan.

- [ ] **Step 11: Commit**

```bash
git add src/store/rosterDb.ts src/store/rosterDb.sync.test.ts
git commit -m "feat: save pulled rows without marking them, merge duplicate players, and tell the app about local changes"
```


### Task 2: Check a row from the server, and talk to the server

`rows.ts` checks every row that comes back from the server before the app can use it, and builds the row that is sent. `remote.ts` is the list of things the engine asks of the server, and the adapter that asks the real Supabase. The adapter is tested twice: against a small fake client, and against the real Supabase client library with the network stubbed, so what it sends and how it reads real replies is checked against the library and not only against our own guess of it.

**Files:**
- Create: `src/sync/rows.ts`, `src/sync/rows.test.ts`
- Create: `src/sync/remote.ts`, `src/sync/remote.test.ts`, `src/sync/remote.wire.test.ts`

- [ ] **Step 1: Tests for checking a row**

  Create `src/sync/rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { norm, parsePlayerRow, pushRow } from './rows';

const ID = '0a1b2c3d-0000-4000-8000-00000000000a';
const good = {
  id: ID,
  name: 'Ann',
  photo_version: 2,
  photo_seq: 3,
  last_played_at: '2026-11-06T10:00:00+00:00',
  deleted_at: null,
  updated_at: '2026-11-06T10:00:01.123456+00:00',
};

describe('checking a row from the server', () => {
  it('turns a good row into the app\'s units', () => {
    expect(parsePlayerRow(good)).toEqual({
      id: ID,
      name: 'Ann',
      photoVersion: 2,
      photoSeq: 3,
      lastPlayedAt: Date.parse('2026-11-06T10:00:00Z'),
      updatedAt: Date.parse('2026-11-06T10:00:01.123Z'),
    });
  });

  it('reads a deleted row, and a row that was never played', () => {
    const row = parsePlayerRow({ ...good, last_played_at: null, deleted_at: '2026-11-06T11:00:00Z' });
    expect(row).toMatchObject({ deletedAt: Date.parse('2026-11-06T11:00:00Z') });
    expect(row).not.toHaveProperty('lastPlayedAt');
  });

  it('lowercases the id and trims the name the way JavaScript does', () => {
    expect(parsePlayerRow({ ...good, id: ID.toUpperCase(), name: '  Ann\t' })).toMatchObject({ id: ID, name: 'Ann' });
  });

  it.each([
    ['nothing', null],
    ['a string', 'row'],
    ['an id that is not a uuid', { ...good, id: 'p1' }],
    ['no id', { ...good, id: undefined }],
    ['no name', { ...good, name: undefined }],
    ['a name of only spaces and tabs', { ...good, name: ' \t  ' }],
    ['a name that is far too long', { ...good, name: 'x'.repeat(201) }],
    ['a negative photo version', { ...good, photo_version: -1 }],
    ['a photo version that is not whole', { ...good, photo_version: 1.5 }],
    ['a photo sequence that is a string', { ...good, photo_seq: '3' }],
    ['a photo sequence that is absurd', { ...good, photo_seq: 5_000_000 }],
    ['a played time that is not a time', { ...good, last_played_at: 'yesterday' }],
    ['a played time that is a number', { ...good, last_played_at: 5 }],
    ['a deleted time that is not a time', { ...good, deleted_at: 'x' }],
    ['no update time', { ...good, updated_at: null }],
    ['an update time that is not a time', { ...good, updated_at: 'soon' }],
  ])('rejects a row with %s', (_why, raw) => {
    expect(parsePlayerRow(raw)).toBeNull();
  });
});

describe('sending a player', () => {
  it('uses the server\'s column names and ISO times', () => {
    expect(
      pushRow({ id: ID, name: ' Ann ', photoVersion: 1, photoSeq: 2, lastPlayedAt: 1_000, updatedAt: 5, deletedAt: 2_000 }),
    ).toEqual({
      id: ID,
      name: 'Ann',
      photo_version: 1,
      photo_seq: 2,
      last_played_at: '1970-01-01T00:00:01.000Z',
      deleted_at: '1970-01-01T00:00:02.000Z',
    });
    expect(pushRow({ id: ID, name: 'Ann', photoVersion: 0, photoSeq: 0, updatedAt: 5 })).toMatchObject({
      last_played_at: null,
      deleted_at: null,
    });
  });

  it('compares names with the edges trimmed and the case ignored', () => {
    expect(norm('  ANN\t')).toBe('ann');
  });
});
```

- [ ] **Step 2: Tests for the adapter, with a fake client**

  Create `src/sync/remote.test.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHOTO_BUCKET, RemoteError, isRemoteError, photoFolder, photoPath, supabaseRemote } from './remote';
import type { PushRow } from './rows';

const OWNER = '0a1b2c3d-0000-4000-8000-00000000000a';
const ROW: PushRow = { id: 'p1', name: 'Ann', photo_version: 0, photo_seq: 0, last_played_at: null, deleted_at: null };

type Reply = { data?: unknown; error?: Record<string, unknown> | null; status?: number };

/** A stand-in for the part of the Supabase client the adapter uses. It records every call the adapter makes. */
function fakeClient(replies: { table?: (ops: string[]) => Reply; storage?: Record<string, Reply | (() => Reply)> }) {
  const calls: string[] = [];
  const from = vi.fn((table: string) => {
    const ops: string[] = [`from(${table})`];
    const builder: Record<string, unknown> = {};
    for (const method of ['upsert', 'select', 'is', 'gte', 'order', 'range']) {
      builder[method] = (...args: unknown[]) => {
        ops.push(`${method}(${args.map((a) => JSON.stringify(a)).join(',')})`);
        return builder;
      };
    }
    builder.then = (resolve: (value: unknown) => void) => {
      calls.push(ops.join('.'));
      const reply = replies.table?.(ops) ?? {};
      resolve({ data: reply.data ?? null, error: reply.error ?? null, status: reply.status ?? 200 });
    };
    return builder;
  });
  const storageCalls: { bucket: string; method: string; args: unknown[] }[] = [];
  const storage = {
    from: (bucket: string) =>
      Object.fromEntries(
        ['upload', 'download', 'list', 'remove'].map((method) => [
          method,
          async (...args: unknown[]) => {
            storageCalls.push({ bucket, method, args });
            const reply = replies.storage?.[method];
            const value = (typeof reply === 'function' ? reply() : reply) ?? {};
            return { data: value.data ?? null, error: value.error ?? null };
          },
        ]),
      ),
  };
  return { client: { from, storage } as unknown as SupabaseClient, calls, storageCalls };
}

const kind = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return isRemoteError(error) ? error.kind : 'other';
  }
  return 'none';
};

afterEach(() => vi.unstubAllGlobals());

describe('paths', () => {
  it('puts a photo at {owner}/{player}/{seq}.jpg with the owner in lower case', () => {
    expect(photoFolder(OWNER.toUpperCase(), 'P1')).toBe(`${OWNER}/p1`);
    expect(photoPath(OWNER.toUpperCase(), 'p1', 4)).toBe(`${OWNER}/p1/4.jpg`);
  });
});

describe('pushing a player', () => {
  it('upserts one row with the owner, on the primary key', async () => {
    const { client, calls } = fakeClient({});
    expect(await supabaseRemote(client, OWNER).upsertPlayer(ROW)).toBe('ok');
    expect(calls).toEqual([`from(players).upsert(${JSON.stringify({ owner_id: OWNER, ...ROW })},{"onConflict":"owner_id,id"})`]);
  });

  it('says nameTaken for a unique violation, and fails for anything else', async () => {
    const taken = fakeClient({ table: () => ({ error: { code: '23505', message: 'duplicate key' }, status: 409 }) });
    expect(await supabaseRemote(taken.client, OWNER).upsertPlayer(ROW)).toBe('nameTaken');
    const other = fakeClient({ table: () => ({ error: { code: '42501', message: 'row-level security' }, status: 403 }) });
    expect(await kind(supabaseRemote(other.client, OWNER).upsertPlayer(ROW))).toBe('server');
  });

  it('tells a missing connection and a rejected session from a server fault', async () => {
    const offline = fakeClient({ table: () => ({ error: { message: 'TypeError: Failed to fetch' }, status: 0 }) });
    expect(await kind(supabaseRemote(offline.client, OWNER).upsertPlayer(ROW))).toBe('offline');
    const noStatus = fakeClient({ table: () => ({ error: { message: 'NetworkError when attempting to fetch resource.' }, status: 500 }) });
    expect(await kind(supabaseRemote(noStatus.client, OWNER).upsertPlayer(ROW))).toBe('offline');
    const expired = fakeClient({ table: () => ({ error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 }) });
    expect(await kind(supabaseRemote(expired.client, OWNER).upsertPlayer(ROW))).toBe('auth');
    const bare401 = fakeClient({ table: () => ({ error: { message: 'x' }, status: 401 }) });
    expect(await kind(supabaseRemote(bare401.client, OWNER).upsertPlayer(ROW))).toBe('auth');
    const broken = fakeClient({ table: () => ({ error: { message: 'boom' }, status: 500 }) });
    expect(await kind(supabaseRemote(broken.client, OWNER).upsertPlayer(ROW))).toBe('server');
    vi.stubGlobal('navigator', { onLine: false });
    expect(await kind(supabaseRemote(broken.client, OWNER).upsertPlayer(ROW))).toBe('offline');
  });

  it('never shows the server\'s own wording', async () => {
    const { client } = fakeClient({ table: () => ({ error: { message: 'secret detail' }, status: 500 }) });
    const error = await supabaseRemote(client, OWNER).upsertPlayer(ROW).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RemoteError);
    expect((error as Error).message).not.toContain('secret');
  });
});

describe('reading players', () => {
  it('asks for everything, oldest write first, when there is no cursor', async () => {
    const { client, calls } = fakeClient({ table: () => ({ data: [{ id: 'a' }] }) });
    expect(await supabaseRemote(client, OWNER).pull(undefined)).toEqual([{ id: 'a' }]);
    expect(calls).toEqual(['from(players).select("*").order("updated_at",{"ascending":true}).order("id",{"ascending":true}).range(0,499)']);
  });

  it('asks only for rows written at or after the time given', async () => {
    const { client, calls } = fakeClient({ table: () => ({ data: [] }) });
    await supabaseRemote(client, OWNER).pull('2026-11-06T10:00:00.000Z');
    expect(calls[0]).toContain('.select("*").gte("updated_at","2026-11-06T10:00:00.000Z").order("updated_at"');
  });

  it('reads long lists a page at a time', async () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i) }));
    const { client, calls } = fakeClient({ table: (ops) => ({ data: ops.some((o) => o === 'range(0,499)') ? page(500) : page(2) }) });
    expect(await supabaseRemote(client, OWNER).pull(undefined)).toHaveLength(502);
    expect(calls.map((c) => c.slice(c.indexOf('range')))).toEqual(['range(0,499)', 'range(500,999)']);
  });

  it('lists the players that are not deleted', async () => {
    const { client, calls } = fakeClient({ table: () => ({ data: [] }) });
    await supabaseRemote(client, OWNER).listLive();
    expect(calls[0]).toBe('from(players).select("*").is("deleted_at",null).order("id").range(0,499)');
  });

  it('fails when a page fails', async () => {
    const { client } = fakeClient({ table: () => ({ error: { message: 'boom' }, status: 500 }) });
    expect(await kind(supabaseRemote(client, OWNER).pull(undefined))).toBe('server');
    expect(await kind(supabaseRemote(client, OWNER).listLive())).toBe('server');
  });
});

describe('photo files', () => {
  const photo = { type: 'image/jpeg', data: new Uint8Array([1, 2, 3]).buffer };

  it('uploads a JPEG to the private bucket without replacing anything', async () => {
    const { client, storageCalls } = fakeClient({});
    await supabaseRemote(client, OWNER).uploadPhoto(`${OWNER}/p1/1.jpg`, photo);
    expect(storageCalls).toHaveLength(1);
    const [call] = storageCalls;
    expect([call.bucket, call.method, call.args[0], call.args[2]]).toEqual([
      PHOTO_BUCKET,
      'upload',
      `${OWNER}/p1/1.jpg`,
      { contentType: 'image/jpeg', upsert: false },
    ]);
    const body = call.args[1] as Blob;
    expect(body.type).toBe('image/jpeg');
    expect(body.size).toBe(3);
  });

  it('counts a file that is already there as uploaded, and fails for other errors', async () => {
    const exists = fakeClient({ storage: { upload: { error: { status: 409, statusCode: '409', code: 'ResourceAlreadyExists', message: 'The resource already exists' } } } });
    await expect(supabaseRemote(exists.client, OWNER).uploadPhoto('x/y/1.jpg', photo)).resolves.toBeUndefined();
    const bad = fakeClient({ storage: { upload: { error: { status: 413, message: 'too big' } } } });
    expect(await kind(supabaseRemote(bad.client, OWNER).uploadPhoto('x/y/1.jpg', photo))).toBe('server');
    const offline = fakeClient({ storage: { upload: { error: { message: 'Failed to fetch' } } } });
    expect(await kind(supabaseRemote(offline.client, OWNER).uploadPhoto('x/y/1.jpg', photo))).toBe('offline');
  });

  it('downloads the bytes, and says null for a file that is not there', async () => {
    const ok = fakeClient({ storage: { download: { data: { arrayBuffer: async () => new Uint8Array([4, 5]).buffer } } } });
    expect([...new Uint8Array((await supabaseRemote(ok.client, OWNER).downloadPhoto('x/y/1.jpg'))!)]).toEqual([4, 5]);
    for (const error of [{ status: 404, message: 'x' }, { status: 400, statusCode: '404', message: 'Object not found' }, { code: 'NoSuchKey', message: 'x' }]) {
      const missing = fakeClient({ storage: { download: { error } } });
      expect(await supabaseRemote(missing.client, OWNER).downloadPhoto('x/y/1.jpg')).toBeNull();
    }
    const bad = fakeClient({ storage: { download: { error: { status: 500, message: 'boom' } } } });
    expect(await kind(supabaseRemote(bad.client, OWNER).downloadPhoto('x/y/1.jpg'))).toBe('server');
  });

  it('lists the files in a folder', async () => {
    const { client, storageCalls } = fakeClient({ storage: { list: { data: [{ name: '1.jpg' }, { name: '2.jpg' }] } } });
    expect(await supabaseRemote(client, OWNER).listPhotoFiles(`${OWNER}/p1`)).toEqual(['1.jpg', '2.jpg']);
    expect(storageCalls[0].args).toEqual([`${OWNER}/p1`, { limit: 100 }]);
    const bad = fakeClient({ storage: { list: { error: { status: 500, message: 'x' } } } });
    expect(await kind(supabaseRemote(bad.client, OWNER).listPhotoFiles('x'))).toBe('server');
  });

  it('removes files, and makes no request when there is nothing to remove', async () => {
    const { client, storageCalls } = fakeClient({});
    await supabaseRemote(client, OWNER).removePhotoFiles([]);
    expect(storageCalls).toEqual([]);
    await supabaseRemote(client, OWNER).removePhotoFiles(['a/b/1.jpg']);
    expect(storageCalls.map((c) => [c.method, c.args])).toEqual([['remove', [['a/b/1.jpg']]]]);
    const bad = fakeClient({ storage: { remove: { error: { status: 500, message: 'x' } } } });
    expect(await kind(supabaseRemote(bad.client, OWNER).removePhotoFiles(['a']))).toBe('server');
  });
});
```

- [ ] **Step 3: Tests for the adapter, with the real client library**

  Create `src/sync/remote.wire.test.ts`:

```ts
// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { isRemoteError, supabaseRemote } from './remote';
import type { PushRow } from './rows';

const OWNER = '0a1b2c3d-0000-4000-8000-00000000000a';
const ROW: PushRow = { id: 'p1', name: 'Ann', photo_version: 1, photo_seq: 2, last_played_at: null, deleted_at: null };

interface Seen {
  method: string;
  url: URL;
  headers: Headers;
  body: string | FormData | undefined;
}
let seen: Seen[];
let reply: (request: Seen) => Response;

/** The real Supabase client, with the network replaced: what the adapter really sends, and how it reads real replies. */
function realClient() {
  const fetchStub: typeof fetch = async (input, init) => {
    const request = new Request(input as string, init);
    const body = init?.body;
    const entry: Seen = {
      method: request.method,
      url: new URL(request.url),
      headers: request.headers,
      body: typeof body === 'string' || body instanceof FormData ? body : undefined,
    };
    seen.push(entry);
    return reply(entry);
  };
  const client = createClient('http://localhost:54321', 'sb_publishable_test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchStub },
  });
  return supabaseRemote(client, OWNER);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  seen = [];
  reply = () => json(200, []);
});

describe('what the adapter sends to the real client library', () => {
  it('upserts one row on the primary key and merges duplicates', async () => {
    reply = () => new Response(null, { status: 201 });
    expect(await realClient().upsertPlayer(ROW)).toBe('ok');
    const [call] = seen;
    expect(call.method).toBe('POST');
    expect(call.url.pathname).toBe('/rest/v1/players');
    expect(call.url.searchParams.get('on_conflict')).toBe('owner_id,id');
    expect(call.headers.get('prefer')).toContain('resolution=merge-duplicates');
    expect(JSON.parse(call.body as string)).toEqual({ owner_id: OWNER, ...ROW });
  });

  it('reads the unique name violation from a real error reply', async () => {
    reply = () => json(409, { code: '23505', message: 'duplicate key value violates unique constraint', details: null, hint: null });
    expect(await realClient().upsertPlayer(ROW)).toBe('nameTaken');
  });

  it('asks for rows from a time on, oldest first, a page at a time', async () => {
    await realClient().pull('2026-11-06T10:00:00.000Z');
    const { url, method } = seen[0];
    expect(method).toBe('GET');
    expect(url.pathname).toBe('/rest/v1/players');
    expect(url.searchParams.get('select')).toBe('*');
    expect(url.searchParams.get('updated_at')).toBe('gte.2026-11-06T10:00:00.000Z');
    expect(url.searchParams.get('order')).toBe('updated_at.asc,id.asc');
    expect([url.searchParams.get('offset'), url.searchParams.get('limit')]).toEqual(['0', '500']);
  });

  it('asks for the players that are not deleted', async () => {
    await realClient().listLive();
    expect(seen[0].url.searchParams.get('deleted_at')).toBe('is.null');
  });

  it('turns a dropped connection into an offline error', async () => {
    reply = () => {
      throw new TypeError('Failed to fetch');
    };
    const error = await realClient().upsertPlayer(ROW).catch((e: unknown) => e);
    expect(isRemoteError(error) && error.kind).toBe('offline');
  });

  it('turns a rejected session into an auth error', async () => {
    reply = () => json(401, { code: 'PGRST301', message: 'JWT expired' });
    const error = await realClient().pull(undefined).catch((e: unknown) => e);
    expect(isRemoteError(error) && error.kind).toBe('auth');
  });

  it('uploads a JPEG without replacing, and counts "already exists" as done', async () => {
    reply = () => json(200, { Key: 'player-photos/x/y/1.jpg' });
    await realClient().uploadPhoto('x/y/1.jpg', { type: 'image/jpeg', data: new Uint8Array([1, 2, 3]).buffer });
    const call = seen[0];
    expect(call.method).toBe('POST');
    expect(call.url.pathname).toBe('/storage/v1/object/player-photos/x/y/1.jpg');
    expect(call.headers.get('x-upsert')).toBe('false');

    reply = () => json(409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    await expect(realClient().uploadPhoto('x/y/1.jpg', { type: 'image/jpeg', data: new ArrayBuffer(1) })).resolves.toBeUndefined();
  });

  it('downloads the bytes, and reads a missing file as null whichever way the server says so', async () => {
    reply = () => new Response(new Uint8Array([7, 8]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    const bytes = await realClient().downloadPhoto('x/y/1.jpg');
    expect([...new Uint8Array(bytes!)]).toEqual([7, 8]);
    expect(seen[0].url.pathname).toBe('/storage/v1/object/player-photos/x/y/1.jpg');

    for (const status of [400, 404]) {
      reply = () => json(status, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      expect(await realClient().downloadPhoto('x/y/1.jpg')).toBeNull();
    }
  });

  it('lists the files of a folder and removes files by path', async () => {
    reply = () => json(200, [{ name: '1.jpg' }, { name: '2.jpg' }]);
    expect(await realClient().listPhotoFiles('x/y')).toEqual(['1.jpg', '2.jpg']);
    expect(seen[0].url.pathname).toBe('/storage/v1/object/list/player-photos');
    expect(JSON.parse(seen[0].body as string)).toMatchObject({ prefix: 'x/y', limit: 100 });

    reply = () => json(200, []);
    await realClient().removePhotoFiles(['x/y/1.jpg']);
    expect(seen[1].method).toBe('DELETE');
    expect(seen[1].url.pathname).toBe('/storage/v1/object/player-photos');
    expect(JSON.parse(seen[1].body as string)).toEqual({ prefixes: ['x/y/1.jpg'] });
  });
});
```

- [ ] **Step 4: Watch them fail**

  Run:

```bash
npx vitest run src/sync/rows.test.ts src/sync/remote.test.ts src/sync/remote.wire.test.ts
```

  Expected: the three files fail to load, with `Failed to resolve import "./rows"` or `"./remote"`.

- [ ] **Step 5: Row checks**

  Create `src/sync/rows.ts`:

```ts
import type { PulledPlayer, RosterPlayer } from '../store/rosterDb';

/** How a player is sent to the server. `owner_id` is added when it is sent. */
export interface PushRow {
  id: string;
  name: string;
  photo_version: number;
  photo_seq: number;
  last_played_at: string | null;
  deleted_at: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Far longer than any real name. A row above this is not a player this app wrote. */
const MAX_NAME = 200;
const MAX_COUNT = 1_000_000;

/** Names are compared the way the app compares them: edges trimmed, case ignored. */
export const norm = (name: string) => name.trim().toLowerCase();

export function pushRow(player: RosterPlayer): PushRow {
  return {
    id: player.id,
    name: player.name.trim(),
    photo_version: player.photoVersion,
    photo_seq: player.photoSeq,
    last_played_at: player.lastPlayedAt === undefined ? null : new Date(player.lastPlayedAt).toISOString(),
    deleted_at: player.deletedAt === undefined ? null : new Date(player.deletedAt).toISOString(),
  };
}

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT ? value : null;

/** A time as milliseconds, `undefined` for null, and `null` for anything that is not a time. */
function time(value: unknown): number | undefined | null {
  if (value === null) return undefined;
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Checks one row from the server before it can reach the screen, and puts it in the app's units. Returns null for
 * a row this app would not have written (a missing field, a name that is only spaces once trimmed the way
 * JavaScript trims, a number that is not a number). The server's own `btrim` strips fewer characters than
 * JavaScript's `trim()`, so a name is trimmed here too.
 */
export function parsePlayerRow(raw: unknown): PulledPlayer | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || !UUID.test(row.id) || typeof row.name !== 'string') return null;
  const name = row.name.trim();
  if (name === '' || name.length > MAX_NAME) return null;
  const photoVersion = count(row.photo_version);
  const photoSeq = count(row.photo_seq);
  const lastPlayedAt = time(row.last_played_at);
  const deletedAt = time(row.deleted_at);
  const updatedAt = time(row.updated_at);
  if (photoVersion === null || photoSeq === null || lastPlayedAt === null || deletedAt === null) return null;
  if (updatedAt === null || updatedAt === undefined) return null;
  return {
    id: row.id.toLowerCase(),
    name,
    photoVersion,
    photoSeq,
    updatedAt,
    ...(lastPlayedAt === undefined ? {} : { lastPlayedAt }),
    ...(deletedAt === undefined ? {} : { deletedAt }),
  };
}
```

- [ ] **Step 6: The server interface and the adapter**

  Create `src/sync/remote.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PhotoData } from '../store/rosterDb';
import type { PushRow } from './rows';

export const PHOTO_BUCKET = 'player-photos';

/** Why a request failed: no connection, a session that is no longer accepted, or anything else. */
export type RemoteFailure = 'offline' | 'auth' | 'server';

export class RemoteError extends Error {
  constructor(readonly kind: RemoteFailure) {
    super(`Sync request failed (${kind})`);
    this.name = 'RemoteError';
  }
}

/** True for a `RemoteError`, even one made by another copy of this module (as when a test runs two devices). */
export function isRemoteError(error: unknown): error is RemoteError {
  return error instanceof Error && error.name === 'RemoteError' && typeof (error as { kind?: unknown }).kind === 'string';
}

/** What the sync engine asks of the server. Rows come back unchecked: the engine validates them. */
export interface Remote {
  /** Inserts or updates one player. `nameTaken` means another live player of this organizer already has the name. */
  upsertPlayer(row: PushRow): Promise<'ok' | 'nameTaken'>;
  /** Every player that is not deleted. */
  listLive(): Promise<unknown[]>;
  /** Every player written at or after `since` (an ISO time), or all of them, oldest write first. */
  pull(since: string | undefined): Promise<unknown[]>;
  /** Stores a JPEG at a path that is never reused. A file already there counts as stored. */
  uploadPhoto(path: string, photo: PhotoData): Promise<void>;
  /** The bytes at a path, or null when there is no such file. */
  downloadPhoto(path: string): Promise<ArrayBuffer | null>;
  /** The names of the files in a folder. */
  listPhotoFiles(folder: string): Promise<string[]>;
  removePhotoFiles(paths: string[]): Promise<void>;
}

/** Photos live at `{owner id}/{player id}/{photo_seq}.jpg`, with the owner id in lower case. */
export const photoFolder = (ownerId: string, playerId: string) => `${ownerId.toLowerCase()}/${playerId.toLowerCase()}`;
export const photoPath = (ownerId: string, playerId: string, seq: number) => `${photoFolder(ownerId, playerId)}/${seq}.jpg`;

interface Failure {
  message?: string;
  status?: number;
  statusCode?: string;
  code?: string;
}

const NETWORK = /failed to fetch|network|load failed|fetch failed/i;

/** Turns a failed request into a `RemoteError`. Status 0 is how supabase-js reports a request that never arrived. */
function fail(error: Failure, status?: number): never {
  const code = status ?? error.status;
  const offline = code === 0 || NETWORK.test(error.message ?? '') || (typeof navigator !== 'undefined' && navigator.onLine === false);
  throw new RemoteError(offline ? 'offline' : code === 401 || error.code === 'PGRST301' ? 'auth' : 'server');
}

const isExists = (error: Failure) => error.status === 409 || error.statusCode === '409' || error.code === 'ResourceAlreadyExists';
const isMissing = (error: Failure) =>
  error.status === 404 || error.statusCode === '404' || error.code === 'NoSuchKey' || /not found/i.test(error.message ?? '');

/** The server answers at most this many rows a request, so longer lists are read a page at a time. */
const PAGE = 500;

/** The real server, as the signed-in organizer `ownerId`. */
export function supabaseRemote(client: SupabaseClient, ownerId: string): Remote {
  const bucket = () => client.storage.from(PHOTO_BUCKET);

  async function allRows(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: Failure | null; status: number }>) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error, status } = await page(from, from + PAGE - 1);
      if (error) fail(error, status);
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) return rows;
    }
  }

  return {
    async upsertPlayer(row) {
      const { error, status } = await client.from('players').upsert({ owner_id: ownerId, ...row }, { onConflict: 'owner_id,id' });
      if (!error) return 'ok';
      // 23505 is a unique violation. The only unique rule besides the key is the name, and an upsert handles the key.
      if (error.code === '23505') return 'nameTaken';
      return fail(error, status);
    },
    listLive() {
      return allRows((from, to) => client.from('players').select('*').is('deleted_at', null).order('id').range(from, to));
    },
    pull(since) {
      return allRows((from, to) => {
        const query = client.from('players').select('*');
        return (since === undefined ? query : query.gte('updated_at', since))
          .order('updated_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to);
      });
    },
    async uploadPhoto(path, photo) {
      const body = new Blob([photo.data], { type: 'image/jpeg' });
      const { error } = await bucket().upload(path, body, { contentType: 'image/jpeg', upsert: false });
      if (error && !isExists(error)) fail(error as Failure);
    },
    async downloadPhoto(path) {
      const { data, error } = await bucket().download(path);
      if (error) {
        if (isMissing(error as Failure)) return null;
        fail(error as Failure);
      }
      return data.arrayBuffer();
    },
    async listPhotoFiles(folder) {
      const { data, error } = await bucket().list(folder, { limit: 100 });
      if (error) fail(error as Failure);
      return data.map((file) => file.name);
    },
    async removePhotoFiles(paths) {
      if (paths.length === 0) return;
      const { error } = await bucket().remove(paths);
      if (error) fail(error as Failure);
    },
  };
}
```

- [ ] **Step 7: Run the new tests**

  Run:

```bash
npx vitest run src/sync/rows.test.ts src/sync/remote.test.ts src/sync/remote.wire.test.ts
```

  Expected: every test passes. The summary reads `Tests  45 passed (45)`.

- [ ] **Step 8: Typecheck**

  Run:

```bash
npm run typecheck
```

  Expected: nothing is printed after the `tsc --noEmit` line.

- [ ] **Step 9: Commit**

```bash
git add src/sync/rows.ts src/sync/rows.test.ts src/sync/remote.ts src/sync/remote.test.ts src/sync/remote.wire.test.ts
git commit -m "feat: check rows from the server and add the Supabase adapter for sync"
```


### Task 3: The sync engine

`syncOnce` is the heart of the plan: the first-sign-in marking, the push loop with its waiting and name swaps, the merge of duplicate players, and the pull with its overlap and cursor. Its tests run against a stand-in server that applies the real database rules, with two simulated devices, so the interesting cases (two devices, a name swap, a merge, a failed download) are exercised end to end.

**Files:**
- Create: `src/sync/fakeServer.ts`, `src/sync/device.ts` (test helpers)
- Create: `src/sync/engine.test.ts`, `src/sync/engine.ts`

- [ ] **Step 1: The stand-in server**

  Create `src/sync/fakeServer.ts`:

```ts
import type { PGlite } from '@electric-sql/pglite';
import type { PhotoData } from '../store/rosterDb';
import { createDb, run } from './db/harness';
import { RemoteError, type Remote } from './remote';
import type { PushRow } from './rows';

/** The server's file size limit for player photos. */
const MAX_PHOTO_BYTES = 204800;

/**
 * A stand-in for the real server, for tests: the real database rules (the migrations run in an in-memory Postgres,
 * with row-level security, the unique name rule and the server-set `updated_at`) and a small photo store that
 * applies the bucket's rules. Several organizers can use it, each through `remote(user)`.
 */
export interface FakeServer {
  db: PGlite;
  /** Photo files by path. */
  files: Map<string, PhotoData>;
  /** What each remote was asked, in order, as `method` or `method:detail`. */
  calls: string[];
  /** While set, every request fails the way a request with no connection does. */
  offline: boolean;
  /** Pushes of these player ids are refused, as if the server failed on them. */
  refuse: Set<string>;
  /** Every photo download fails with no connection. */
  downloadsOffline: boolean;
  remote(user: string): Remote;
  close(): Promise<void>;
}

const text = (value: unknown) => (value instanceof Date ? value.toISOString() : value);

export async function createFakeServer(): Promise<FakeServer> {
  const db = await createDb();
  const server: FakeServer = {
    db,
    files: new Map(),
    calls: [],
    offline: false,
    refuse: new Set(),
    downloadsOffline: false,
    remote(user) {
      const guard = (call: string) => {
        server.calls.push(call);
        if (server.offline) throw new RemoteError('offline');
      };
      const rows = async (sql: string, params: unknown[] = []) =>
        (await run(db, { user }, sql, params)).rows.map((row) =>
          Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([k, v]) => [k, text(v)])),
        );
      const columns = 'id, name, photo_version, photo_seq, last_played_at, deleted_at, updated_at';
      return {
        async upsertPlayer(row: PushRow) {
          guard(`upsertPlayer:${row.id}`);
          if (server.refuse.has(row.id)) throw new RemoteError('server');
          try {
            await run(
              db,
              { user },
              `insert into public.players (owner_id, id, name, photo_version, photo_seq, last_played_at, deleted_at)
               values ($1, $2, $3, $4, $5, $6, $7)
               on conflict (owner_id, id) do update set name = excluded.name, photo_version = excluded.photo_version,
                 photo_seq = excluded.photo_seq, last_played_at = excluded.last_played_at, deleted_at = excluded.deleted_at`,
              [user, row.id, row.name, row.photo_version, row.photo_seq, row.last_played_at, row.deleted_at],
            );
            return 'ok';
          } catch (error) {
            if ((error as { code?: string }).code === '23505') return 'nameTaken';
            throw error;
          }
        },
        async listLive() {
          guard('listLive');
          return rows(`select ${columns} from public.players where deleted_at is null order by id`);
        },
        async pull(since) {
          guard(`pull:${since ?? 'all'}`);
          return rows(
            `select ${columns} from public.players where ($1::timestamptz is null or updated_at >= $1::timestamptz)
             order by updated_at, id`,
            [since ?? null],
          );
        },
        async uploadPhoto(path, photo) {
          guard(`uploadPhoto:${path}`);
          if (path.split('/')[0] !== user.toLowerCase()) throw new RemoteError('server');
          if (photo.type !== 'image/jpeg' || photo.data.byteLength > MAX_PHOTO_BYTES) throw new RemoteError('server');
          if (!server.files.has(path)) server.files.set(path, { type: photo.type, data: photo.data.slice(0) });
        },
        async downloadPhoto(path) {
          guard(`downloadPhoto:${path}`);
          if (server.downloadsOffline) throw new RemoteError('offline');
          return server.files.get(path)?.data.slice(0) ?? null;
        },
        async listPhotoFiles(folder) {
          guard(`listPhotoFiles:${folder}`);
          return [...server.files.keys()].filter((p) => p.startsWith(`${folder}/`)).map((p) => p.slice(folder.length + 1));
        },
        async removePhotoFiles(paths) {
          guard(`removePhotoFiles:${paths.length}`);
          for (const path of paths) server.files.delete(path);
        },
      };
    },
    close: () => db.close(),
  };
  return server;
}
```

- [ ] **Step 2: A second simulated device**

  Create `src/sync/device.ts`:

```ts
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
```

- [ ] **Step 3: The engine tests**

  Create `src/sync/engine.test.ts`:

```ts
// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PhotoData } from '../store/rosterDb';
import { USER_A, USER_B } from './db/harness';
import { createDevice, type Device } from './device';
import { createFakeServer, type FakeServer } from './fakeServer';

let server: FakeServer;
let a: Device;
let b: Device;

beforeAll(async () => {
  server = await createFakeServer();
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await server.db.exec('truncate public.players');
  server.files.clear();
  server.calls.length = 0;
  server.offline = false;
  server.downloadsOffline = false;
  server.refuse.clear();
  a = await createDevice();
  b = await createDevice();
});

const jpeg = (...bytes: number[]): PhotoData => ({ type: 'image/jpeg', data: new Uint8Array(bytes).buffer });
const bytesOf = (photo: PhotoData | undefined) => (photo ? [...new Uint8Array(photo.data)] : undefined);
const syncA = () => a.engine.syncOnce(server.remote(USER_A), USER_A);
const syncB = () => b.engine.syncOnce(server.remote(USER_A), USER_A);
const names = async (device: Device) => (await device.roster.listRoster()).map((p) => p.name);

async function serverRows() {
  const { rows } = await server.db.query(
    `select name, photo_version, photo_seq, deleted_at is not null as deleted, last_played_at from public.players order by name, id`,
  );
  return rows as { name: string; photo_version: number; photo_seq: number; deleted: boolean; last_played_at: Date | null }[];
}
const live = async () => (await serverRows()).filter((r) => !r.deleted).map((r) => r.name);
const filesOf = () => [...server.files.keys()].sort();

describe('pushing', () => {
  it('sends every saved player on the first sync, with their photo, and clears the marks', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(1, 2, 3));
    const ben = await a.roster.addRosterPlayer('Ben');
    await a.roster.deleteRosterPlayer(ben.id);

    expect(await syncA()).toEqual({ ok: true, pushed: 2, pulled: 0, skippedRows: 0, pending: 0 });

    expect((await serverRows()).map((r) => [r.name, r.photo_version, r.photo_seq, r.deleted])).toEqual([
      ['Ann', 1, 1, false],
      ['Ben', 0, 0, true],
    ]);
    expect(filesOf()).toEqual([`${USER_A}/${ann.id}/1.jpg`]);
    expect(await a.roster.listOutbox()).toEqual([]);
  });

  it('marks players that were saved before the first sign-in, even if they never changed since', async () => {
    // Saved with no sync engine running, as every install of the app before this one did.
    await a.roster.addRosterPlayer('Ann');
    await a.roster.ackOutbox((await a.roster.listOutbox())[0].playerId, (await a.roster.listOutbox())[0].rev);
    expect(await a.roster.listOutbox()).toEqual([]);
    await syncA();
    expect(await live()).toEqual(['Ann']);
  });

  it('sends nothing when nothing changed, and only a pull', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(1));
    await syncA();
    server.calls.length = 0;
    expect(await syncA()).toEqual({ ok: true, pushed: 0, pulled: 0, skippedRows: 0, pending: 0 });
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]).toMatch(/^pull:/);
  });

  it('sends a rename and a played time without uploading the unchanged photo again', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(1));
    await syncA();
    await a.roster.renameRosterPlayer(ann.id, 'Annie');
    await a.roster.markRosterPlayed([ann.id], Date.UTC(2026, 10, 7, 9));
    server.calls.length = 0;
    await syncA();
    expect(server.calls.some((c) => c.startsWith('uploadPhoto'))).toBe(false);
    const [row] = await serverRows();
    expect(row.name).toBe('Annie');
    expect(row.last_played_at?.toISOString()).toBe('2026-11-07T09:00:00.000Z');
  });

  it('uploads a new photo under a new path and deletes the one it replaces', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(1));
    await syncA();
    await a.roster.setRosterPhoto(ann.id, jpeg(2));
    await syncA();
    expect(filesOf()).toEqual([`${USER_A}/${ann.id}/2.jpg`]);
    expect((await serverRows())[0]).toMatchObject({ photo_version: 2, photo_seq: 2 });
  });

  it('removes the file when the photo is removed, and a photo added again never reuses the path', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(1));
    await syncA();
    await a.roster.removeRosterPhoto(ann.id);
    await syncA();
    expect(filesOf()).toEqual([]);
    expect((await serverRows())[0]).toMatchObject({ photo_version: 0, photo_seq: 1 });
    await a.roster.setRosterPhoto(ann.id, jpeg(3));
    await syncA();
    expect(filesOf()).toEqual([`${USER_A}/${ann.id}/2.jpg`]);
  });

  it('removes every photo file of a deleted player, and marks the row deleted', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(1));
    await syncA();
    await a.roster.deleteRosterPlayer(ann.id);
    await syncA();
    expect(filesOf()).toEqual([]);
    expect((await serverRows())[0].deleted).toBe(true);
  });

  it('lets a name be used again after the player who had it was deleted, in one sync', async () => {
    const old = await a.roster.addRosterPlayer('Ann');
    await syncA();
    await a.roster.deleteRosterPlayer(old.id);
    await a.roster.addRosterPlayer('Ann');
    server.calls.length = 0;
    expect(await syncA()).toMatchObject({ ok: true, pending: 0 });
    expect(await live()).toEqual(['Ann']);
    // The deleted player went first, so the new one was never refused and nobody had to look for a holder.
    expect(server.calls).not.toContain('listLive');
  });

  it('puts a player off until the player holding their new name has been renamed', async () => {
    const x = await a.roster.addRosterPlayer('Ann');
    const y = await a.roster.addRosterPlayer('Bob');
    await syncA();
    // The one pushed first takes the name the other one is giving up.
    const [first, second] = [x, y].sort((p, q) => p.id.localeCompare(q.id));
    const taken = second.name;
    await a.roster.renameRosterPlayer(second.id, 'Zed');
    await a.roster.renameRosterPlayer(first.id, taken);
    expect(await syncA()).toMatchObject({ ok: true, pending: 0 });
    expect((await live()).sort()).toEqual([taken, 'Zed'].sort());
  });

  it('swaps the names of two players', async () => {
    const x = await a.roster.addRosterPlayer('Ann');
    const y = await a.roster.addRosterPlayer('Bob');
    await syncA();
    await a.roster.renameRosterPlayer(x.id, 'Tmp');
    await a.roster.renameRosterPlayer(y.id, 'Ann');
    await a.roster.renameRosterPlayer(x.id, 'Bob');
    expect(await syncA()).toMatchObject({ ok: true, pending: 0 });
    expect(await live()).toEqual(['Ann', 'Bob']);
    const { rows } = await server.db.query('select id, name from public.players order by name');
    expect(rows).toEqual([
      { id: y.id, name: 'Ann' },
      { id: x.id, name: 'Bob' },
    ]);
  });
});

describe('pulling', () => {
  it('brings a new device the players and photos of the account', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(9, 8));
    await a.roster.addRosterPlayer('Ben');
    await syncA();

    expect(await syncB()).toMatchObject({ ok: true, pushed: 0, pulled: 2, pending: 0 });
    expect(await names(b)).toEqual(['Ann', 'Ben']);
    expect(bytesOf(await b.roster.getRosterPhoto(ann.id))).toEqual([9, 8]);
    expect(await b.roster.getRosterEntry(ann.id)).toMatchObject({ photoVersion: 1, photoSeq: 1 });
    expect(await b.roster.listOutbox()).toEqual([]);
  });

  it('follows renames, new photos and deletions made on another device', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    const ben = await a.roster.addRosterPlayer('Ben');
    await a.roster.setRosterPhoto(ann.id, jpeg(1));
    await syncA();
    await syncB();

    await a.roster.renameRosterPlayer(ann.id, 'Annie');
    await a.roster.setRosterPhoto(ann.id, jpeg(2));
    await a.roster.deleteRosterPlayer(ben.id);
    await syncA();
    expect(await syncB()).toMatchObject({ ok: true, pulled: 2, pending: 0 });

    expect(await names(b)).toEqual(['Annie']);
    expect(bytesOf(await b.roster.getRosterPhoto(ann.id))).toEqual([2]);
    expect(await b.roster.getRosterEntry(ann.id)).toMatchObject({ photoVersion: 2, photoSeq: 2 });
    expect(await b.roster.getRosterEntry(ben.id)).toMatchObject({ deletedAt: expect.any(Number) });
  });

  it('removes a photo another device removed, and keeps the sequence going up', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(1));
    await syncA();
    await syncB();
    await a.roster.removeRosterPhoto(ann.id);
    await syncA();
    await syncB();
    expect(await b.roster.getRosterPhoto(ann.id)).toBeUndefined();
    expect(await b.roster.getRosterEntry(ann.id)).toMatchObject({ photoVersion: 0, photoSeq: 1 });
  });

  it('never overwrites a change still waiting to be pushed', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await syncA();
    await syncB();
    await a.roster.renameRosterPlayer(ann.id, 'Annie');
    await syncA();
    await b.roster.renameRosterPlayer(ann.id, 'Anna');
    server.refuse.add(ann.id); // B cannot push it this time
    expect(await syncB()).toMatchObject({ ok: false, reason: 'server', pending: 1 });
    expect(await names(b)).toEqual(['Anna']);
    server.refuse.clear();
    expect(await syncB()).toMatchObject({ ok: true, pending: 0 });
    expect(await live()).toEqual(['Anna']);
    expect(await syncA()).toMatchObject({ pulled: 1 });
    expect(await names(a)).toEqual(['Anna']);
  });

  it('shows nothing for a player deleted on the server that this device never had', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await syncA();
    await a.roster.deleteRosterPlayer(ann.id);
    await syncA();
    expect(await syncB()).toMatchObject({ ok: true, pulled: 0 });
    expect(await b.roster.getRosterEntry(ann.id)).toBeUndefined();
  });

  it('reads the rows of the last two minutes again, and saves nothing new for them', async () => {
    await a.roster.addRosterPlayer('Ann');
    await syncA();
    await syncB();
    server.calls.length = 0;
    expect(await syncB()).toMatchObject({ ok: true, pulled: 0 });
    const pullCall = server.calls.find((c) => c.startsWith('pull:'))!;
    const since = Date.parse(pullCall.slice('pull:'.length));
    const newest = (await server.db.query('select updated_at from public.players')).rows[0] as { updated_at: Date };
    expect(newest.updated_at.getTime() - since).toBeGreaterThanOrEqual(120_000);
    expect(newest.updated_at.getTime() - since).toBeLessThan(121_000);
  });

  it('skips rows this app would not have written, counts them, and tidies names the way the app does', async () => {
    await server.db.query(
      `insert into public.players (owner_id, id, name) values ($1, $2, E'\\t'), ($1, $3, $4), ($1, $5, 'Cy')`,
      [USER_A, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Dee ', '00000000-0000-4000-8000-000000000003'],
    );
    expect(await syncB()).toMatchObject({ ok: true, pulled: 2, skippedRows: 1 });
    expect(await names(b)).toEqual(['Cy', 'Dee']);
  });

  it('shows a player whose picture is gone from the server without one', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(1));
    await syncA();
    server.files.clear();
    expect(await syncB()).toMatchObject({ ok: true, pulled: 1 });
    expect(await names(b)).toEqual(['Ann']);
    expect(await b.roster.getRosterEntry(ann.id)).toMatchObject({ photoVersion: 0 });
  });

  it('stops a pull that cannot download a picture, and reads the same rows again next time', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(1));
    await syncA();
    server.downloadsOffline = true;
    expect(await syncB()).toEqual({ ok: false, reason: 'offline', pending: 0 });
    expect(await b.roster.getSyncMeta('syncCursor')).toBeUndefined();
    server.downloadsOffline = false;
    expect(await syncB()).toMatchObject({ ok: true, pulled: 1 });
    expect(bytesOf(await b.roster.getRosterPhoto(ann.id))).toEqual([1]);
  });
});

describe('the same player saved on two devices', () => {
  it('keeps the server entry, and the other device adopts it', async () => {
    const annA = await a.roster.addRosterPlayer('Ann');
    const annB = await b.roster.addRosterPlayer(' ann ');
    await syncA();
    expect(await syncB()).toMatchObject({ ok: true, pending: 0 });

    expect(await live()).toEqual(['Ann']);
    expect(await names(b)).toEqual(['Ann']);
    expect((await b.roster.listRoster())[0].id).toBe(annA.id);
    expect(await b.roster.getRosterEntry(annB.id)).toMatchObject({ deletedAt: expect.any(Number) });
    expect(await b.roster.listOutbox()).toEqual([]);
  });

  it('gives the server entry the photo and the later played time the other device had', async () => {
    const annA = await a.roster.addRosterPlayer('Ann');
    await a.roster.markRosterPlayed([annA.id], 1_000);
    const annB = await b.roster.addRosterPlayer('Ann');
    await b.roster.setRosterPhoto(annB.id, jpeg(5, 5));
    await b.roster.markRosterPlayed([annB.id], 9_000);
    await syncA();
    expect(await syncB()).toMatchObject({ ok: true, pending: 0 });

    expect((await serverRows())[0]).toMatchObject({ photo_version: 1, photo_seq: 1 });
    expect((await serverRows())[0].last_played_at?.getTime()).toBe(9_000);
    expect(filesOf()).toEqual([`${USER_A}/${annA.id}/1.jpg`]);
    expect(bytesOf(await b.roster.getRosterPhoto(annA.id))).toEqual([5, 5]);
    expect(await syncA()).toMatchObject({ pulled: 1 });
    expect(bytesOf(await a.roster.getRosterPhoto(annA.id))).toEqual([5, 5]);
  });

  it('keeps the server photo when both have one', async () => {
    const annA = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(annA.id, jpeg(1));
    const annB = await b.roster.addRosterPlayer('Ann');
    await b.roster.setRosterPhoto(annB.id, jpeg(2));
    await syncA();
    await syncB();
    expect(bytesOf(await b.roster.getRosterPhoto(annA.id))).toEqual([1]);
    expect(filesOf()).toEqual([`${USER_A}/${annA.id}/1.jpg`]);
  });

  it('merges every duplicate when a device with a whole roster signs in to an account that has one', async () => {
    for (const name of ['Ann', 'Ben', 'Cy']) await a.roster.addRosterPlayer(name);
    for (const name of ['Ben', 'Cy', 'Dee']) await b.roster.addRosterPlayer(name);
    await syncA();
    await syncB();
    await syncA();
    expect(await live()).toEqual(['Ann', 'Ben', 'Cy', 'Dee']);
    expect(await names(a)).toEqual(['Ann', 'Ben', 'Cy', 'Dee']);
    expect(await names(b)).toEqual(['Ann', 'Ben', 'Cy', 'Dee']);
  });
});

describe('when things go wrong', () => {
  it('keeps every change and says so when there is no connection', async () => {
    await a.roster.addRosterPlayer('Ann');
    server.offline = true;
    expect(await syncA()).toEqual({ ok: false, reason: 'offline', pending: 1 });
    server.offline = false;
    expect(await syncA()).toMatchObject({ ok: true, pending: 0 });
    expect(await live()).toEqual(['Ann']);
  });

  it('does not let one refused player hold up the others', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.addRosterPlayer('Ben');
    server.refuse.add(ann.id);
    expect(await syncA()).toEqual({ ok: false, reason: 'server', pending: 1 });
    expect(await live()).toEqual(['Ben']);
  });

  it('does not loop forever when the holder of a name never moves', async () => {
    const x = await a.roster.addRosterPlayer('Ann');
    const y = await a.roster.addRosterPlayer('Bob');
    await syncA();
    await a.roster.renameRosterPlayer(x.id, 'Zed');
    await a.roster.renameRosterPlayer(y.id, 'Ann');
    server.refuse.add(x.id);
    expect(await syncA()).toMatchObject({ ok: false, reason: 'server' });
    // Nobody was parked under a made-up name while waiting for a holder that is not going to move.
    expect(await live()).toEqual(['Ann', 'Bob']);
  });

  it('will not mix another account into this one, and says so', async () => {
    await a.roster.addRosterPlayer('Ann');
    await syncA();
    server.calls.length = 0;
    expect(await a.engine.syncOnce(server.remote(USER_B), USER_B)).toEqual({ ok: false, reason: 'otherAccount', pending: 0 });
    expect(server.calls).toEqual([]);
  });

  it('treats the account id as the same whatever its case', async () => {
    await a.roster.addRosterPlayer('Ann');
    await a.engine.syncOnce(server.remote(USER_A), USER_A.toUpperCase());
    expect(await syncA()).toMatchObject({ ok: true });
  });
});
```

- [ ] **Step 4: Watch them fail**

  Run:

```bash
npx vitest run src/sync/engine.test.ts
```

  Expected: The summary reads `Tests  28 failed (28)`. Every test fails with `Cannot find module './engine'`, because the engine does not exist yet.

- [ ] **Step 5: The engine**

  Create `src/sync/engine.ts`:

```ts
import {
  ackOutbox,
  applyPulledPlayer,
  getRosterEntry,
  getRosterPhoto,
  getSyncMeta,
  listOutbox,
  mergeLocalInto,
  queueAllForSync,
  setSyncMeta,
  type OutboxEntry,
  type PhotoData,
  type PulledPlayer,
  type RosterPlayer,
} from '../store/rosterDb';
import { RemoteError, isRemoteError, photoFolder, photoPath, type Remote, type RemoteFailure } from './remote';
import { norm, parsePlayerRow, pushRow } from './rows';

/** The `syncMeta` keys this engine owns. (`outboxRev` belongs to the roster database.) */
const USER_KEY = 'syncUser';
const CURSOR_KEY = 'syncCursor';

/** Rows are asked for from this long before the cursor, because a write that started earlier can commit later. */
const OVERLAP_MS = 2 * 60 * 1000;
/** How many times one sync tries the players it had to put off. */
const MAX_PASSES = 6;

export type SyncOutcome =
  | { ok: true; pushed: number; pulled: number; skippedRows: number; pending: number }
  | { ok: false; reason: RemoteFailure | 'otherAccount'; pending: number };

interface Stats {
  pushed: number;
  pulled: number;
  skippedRows: number;
}

const pendingCount = async () => (await listOutbox()).length;

/**
 * One round of sync as the signed-in organizer: first push every player with changes waiting, then pull what changed
 * on the server. Safe to run again at any time, and safe to stop halfway: each step is saved on its own.
 * Failures that need another try later come back as `ok: false`; anything else (a bug) is thrown.
 */
export async function syncOnce(remote: Remote, userId: string): Promise<SyncOutcome> {
  const owner = userId.toLowerCase();
  const known = await getSyncMeta(USER_KEY);
  if (known === undefined) {
    // The first sync on this device: everything saved here has to reach the account, and names that the account
    // already has are merged in when each player is pushed.
    await queueAllForSync();
    await setSyncMeta(USER_KEY, owner);
  } else if (known !== owner) {
    // Another account's players are on this device. Neither mix them into this account nor drop them.
    return { ok: false, reason: 'otherAccount', pending: await pendingCount() };
  }

  const stats: Stats = { pushed: 0, pulled: 0, skippedRows: 0 };
  try {
    const failed = await pushAll(remote, owner, stats);
    await pullAll(remote, owner, stats);
    const pending = await pendingCount();
    if (failed > 0) return { ok: false, reason: 'server', pending };
    return { ok: true, ...stats, pending };
  } catch (error) {
    if (isRemoteError(error)) return { ok: false, reason: error.kind, pending: await pendingCount() };
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------- push

/**
 * Pushes every marked player. Returns how many could not be pushed this time (the server refused them, or they are
 * still waiting for a name to be freed). Players put off are tried again after the others, and a merge can mark
 * another player, so each pass reads the marks afresh.
 */
async function pushAll(remote: Remote, owner: string, stats: Stats): Promise<number> {
  const refused = new Set<string>();
  const waiting = async () => (await listOutbox()).filter((mark) => !refused.has(mark.playerId));
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const todo = await waiting();
    if (todo.length === 0) return refused.size;
    let done = 0;
    const deferred: OutboxEntry[] = [];
    for (const mark of await deletedFirst(todo)) {
      try {
        if ((await pushPlayer(remote, owner, mark)) === 'deferred') deferred.push(mark);
        else done += 1;
      } catch (error) {
        // A refusal for one player must not hold up the others. No connection or no session stops everything.
        if (isRemoteError(error) && error.kind === 'server') refused.add(mark.playerId);
        else throw error;
      }
    }
    stats.pushed += done;
    if (done === 0 && deferred.length > 0 && refused.size === 0) {
      // Nobody could go first: players have to swap names. Park one under a name nobody has, so the others can go.
      // Not while a player was refused: that player may be the one holding the name, and waiting is then right.
      const stuck = await getRosterEntry(deferred[0].playerId);
      if (stuck) await remote.upsertPlayer({ ...pushRow(stuck), name: `${stuck.name.trim()} #${stuck.id.slice(0, 8)}` });
    }
  }
  return refused.size + (await waiting()).length;
}

/** Deleted players go first: the server's unique name rule would refuse a new player with a deleted player's name. */
async function deletedFirst(marks: OutboxEntry[]): Promise<OutboxEntry[]> {
  const flagged = await Promise.all(
    marks.map(async (mark) => ({ mark, deleted: (await getRosterEntry(mark.playerId))?.deletedAt !== undefined })),
  );
  return [...flagged.filter((f) => f.deleted), ...flagged.filter((f) => !f.deleted)].map((f) => f.mark);
}

/** Pushes one player: the picture, then the row, then clears the mark. `deferred` means try again after the others. */
async function pushPlayer(remote: Remote, owner: string, mark: OutboxEntry): Promise<'done' | 'deferred'> {
  const player = await getRosterEntry(mark.playerId);
  if (!player) {
    await ackOutbox(mark.playerId, mark.rev);
    return 'done';
  }
  const folder = photoFolder(owner, player.id);
  // The picture goes up before the row that points at it, so no other device finds a row without its picture.
  let stale: string[] = [];
  if (player.photoSeq > 0) {
    const names = await remote.listPhotoFiles(folder);
    const keep = player.deletedAt === undefined && player.photoVersion > 0 ? `${player.photoSeq}.jpg` : undefined;
    if (keep && !names.includes(keep)) {
      const photo = await getRosterPhoto(player.id);
      if (photo) await remote.uploadPhoto(`${folder}/${keep}`, photo);
    }
    // Earlier pictures of this player, and all of them once the player is deleted, are no longer needed.
    stale = names.filter((name) => name !== keep).map((name) => `${folder}/${name}`);
  }

  if ((await remote.upsertPlayer(pushRow(player))) === 'nameTaken') {
    const settled = await settleNameClash(remote, owner, player);
    if (settled === 'deferred') return 'deferred';
    if (settled === 'merged') return 'done';
    // The holder of the name went away since the refusal.
    if ((await remote.upsertPlayer(pushRow(player))) !== 'ok') throw new RemoteError('server');
  }
  if (stale.length > 0) await remote.removePhotoFiles(stale);
  await ackOutbox(player.id, mark.rev);
  return 'done';
}

/**
 * The server already has a live player with this player's name. Either it is the same person, saved on another
 * device (merge them), or its holder is about to be renamed or deleted by a change of ours that has not been pushed
 * yet (wait for that).
 */
async function settleNameClash(remote: Remote, owner: string, player: RosterPlayer): Promise<'merged' | 'deferred' | 'retry'> {
  const live = (await remote.listLive()).map(parsePlayerRow).filter((row): row is PulledPlayer => row !== null);
  const holder = live.find((row) => row.id !== player.id && norm(row.name) === norm(player.name));
  if (!holder) return 'retry';
  if ((await listOutbox()).some((entry) => entry.playerId === holder.id)) return 'deferred';
  await applyRemote(remote, owner, holder);
  await mergeLocalInto(player.id, holder.id);
  // This player never had a row, so whatever picture was uploaded for them belongs to no one.
  const leftovers = await remote.listPhotoFiles(photoFolder(owner, player.id));
  await remote.removePhotoFiles(leftovers.map((name) => `${photoFolder(owner, player.id)}/${name}`));
  return 'merged';
}

// ---------------------------------------------------------------------------------------------------- pull

async function pullAll(remote: Remote, owner: string, stats: Stats): Promise<void> {
  const cursor = await getSyncMeta(CURSOR_KEY);
  const cursorMs = typeof cursor === 'string' ? Date.parse(cursor) : NaN;
  const since = Number.isNaN(cursorMs) ? undefined : new Date(cursorMs - OVERLAP_MS).toISOString();
  const rows: PulledPlayer[] = [];
  for (const raw of await remote.pull(since)) {
    const row = parsePlayerRow(raw);
    if (row) rows.push(row);
    else stats.skippedRows += 1;
  }
  rows.sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id));
  for (const row of rows) {
    if ((await applyRemote(remote, owner, row)) === 'applied') stats.pulled += 1;
  }
  // The cursor only moves once every row is saved, so a failure halfway reads the same rows again.
  const newest = rows.reduce((latest, row) => Math.max(latest, row.updatedAt), Number.isNaN(cursorMs) ? 0 : cursorMs);
  if (newest > 0) await setSyncMeta(CURSOR_KEY, new Date(newest).toISOString());
}

/** Saves one pulled row, downloading its picture first when this device does not have the right one. */
async function applyRemote(remote: Remote, owner: string, row: PulledPlayer): Promise<'applied' | 'pending' | 'unchanged'> {
  let photo: PhotoData | null | undefined;
  if (row.deletedAt === undefined && row.photoVersion !== 0) {
    const local = await getRosterEntry(row.id);
    const current = local !== undefined && local.photoSeq >= row.photoSeq && (await getRosterPhoto(row.id)) !== undefined;
    if (!current) {
      const bytes = await remote.downloadPhoto(photoPath(owner, row.id, row.photoSeq));
      // A row whose picture is gone is shown without one.
      photo = bytes ? { type: 'image/jpeg', data: bytes } : null;
    }
  }
  return applyPulledPlayer(row, photo);
}
```

- [ ] **Step 6: Run the engine tests**

  Run:

```bash
npx vitest run src/sync/engine.test.ts
```

  Expected: every test passes. The summary reads `Tests  28 passed (28)`.

- [ ] **Step 7: Typecheck**

  Run:

```bash
npm run typecheck
```

  Expected: nothing is printed after the `tsc --noEmit` line.

- [ ] **Step 8: Commit**

```bash
git add src/sync/fakeServer.ts src/sync/device.ts src/sync/engine.ts src/sync/engine.test.ts
git commit -m "feat: sync engine that pushes marked players, merges duplicates and pulls changes"
```


### Task 4: The sign-in store keeps the account id

The engine names rows and photo files by the account id, so the sign-in store has to hold it. Today it keeps only the email. The id follows the session: set on sign-in and on a saved session, replaced if another account signs in with the same email, cleared on sign-out.

**Files:**
- Modify: `src/sync/auth.test.ts`
- Modify: `src/sync/auth.ts`

- [ ] **Step 1: A test session has an account id**

  In `src/sync/auth.test.ts`, replace:

```ts
const session = (email: string) => ({ user: { email } }) as unknown as Session;
```

  with:

```ts
const session = (email: string, id = 'user-1') => ({ user: { email, id } }) as unknown as Session;
```

- [ ] **Step 2: A saved session gives the account id**

  In `src/sync/auth.test.ts`, replace:

```ts
    expect(store.getState()).toMatchObject({ status: 'signedIn', email: 'ann@example.com' });
  });

  it('only listens for session changes once
```

  with:

```ts
    expect(store.getState()).toMatchObject({ status: 'signedIn', email: 'ann@example.com', userId: 'user-1' });
  });

  it('only listens for session changes once
```

- [ ] **Step 3: The account id follows the session**

  In `src/sync/auth.test.ts`, replace:

```ts
    emit('SIGNED_OUT', null);
    expect(store.getState()).toMatchObject({ status: 'signedOut', email: null });
  });
```

  with:

```ts
    emit('SIGNED_OUT', null);
    expect(store.getState()).toMatchObject({ status: 'signedOut', email: null, userId: null });
  });

  it('keeps the account id in step with the session, including a different account with the same email', async () => {
    const { client, emit } = fakeClient();
    const store = createAuthStore(() => client);
    await store.getState().init();
    emit('SIGNED_IN', session('ann@example.com', 'user-1'));
    expect(store.getState()).toMatchObject({ status: 'signedIn', userId: 'user-1' });
    emit('TOKEN_REFRESHED', session('ann@example.com', 'user-1'));
    expect(store.getState().userId).toBe('user-1');
    emit('SIGNED_IN', session('ann@example.com', 'user-2'));
    expect(store.getState().userId).toBe('user-2');
  });
```

- [ ] **Step 4: Signing out clears the account id even when no listener says so**

  In `src/sync/auth.test.ts`, replace:

```ts
      expect(auth.signOut).toHaveBeenCalledTimes(1);
      expect(store.getState()).toMatchObject({ status: 'signedOut', email: null });
    });
```

  with:

```ts
      expect(auth.signOut).toHaveBeenCalledTimes(1);
      expect(store.getState()).toMatchObject({ status: 'signedOut', email: null, userId: null });
    });
```

- [ ] **Step 5: Watch it fail**

  Run:

```bash
npx vitest run src/sync/auth.test.ts
```

  Expected: The summary reads `Tests  4 failed | 23 passed (27)`. The new assertions about `userId` fail.

- [ ] **Step 6: The sign-in store keeps the account id**

  In `src/sync/auth.ts`, replace:

```ts
  /** The signed-in email, or the address a sign-in link was sent to. */
  email: string | null;
```

  with:

```ts
  /** The signed-in email, or the address a sign-in link was sent to. */
  email: string | null;
  /** The signed-in account's id, which names its rows and photo files online. Null unless signed in. */
  userId: string | null;
```

- [ ] **Step 7: It starts empty**

  In `src/sync/auth.ts`, replace:

```ts
      status: 'loading',
      email: null,
      error: null,
```

  with:

```ts
      status: 'loading',
      email: null,
      userId: null,
      error: null,
```

- [ ] **Step 8: A session arriving or ending sets or clears it**

  In `src/sync/auth.ts`, replace:

```ts
            const email = session?.user.email;
            if (email) {
              if (get().status !== 'signedIn' || get().email !== email) set({ status: 'signedIn', email, error: null });
            } else if (event === 'SIGNED_OUT' && (get().status === 'signedIn' || get().status === 'unknown')) {
              set({ status: 'signedOut', email: null });
            }
```

  with:

```ts
            const email = session?.user.email;
            if (email && session) {
              const userId = session.user.id;
              if (get().status !== 'signedIn' || get().email !== email || get().userId !== userId) {
                set({ status: 'signedIn', email, userId, error: null });
              }
            } else if (event === 'SIGNED_OUT' && (get().status === 'signedIn' || get().status === 'unknown')) {
              set({ status: 'signedOut', email: null, userId: null });
            }
```

- [ ] **Step 9: A saved session read at start-up sets it**

  In `src/sync/auth.ts`, replace:

```ts
            set({ status: 'signedIn', email: result.data.session.user.email });
          } else {
            // An error with no session means "could not check", not "nobody is signed in".
            set({ status: result.error ? 'unknown' : 'signedOut', email: null });
```

  with:

```ts
            set({ status: 'signedIn', email: result.data.session.user.email, userId: result.data.session.user.id });
          } else {
            // An error with no session means "could not check", not "nobody is signed in".
            set({ status: result.error ? 'unknown' : 'signedOut', email: null, userId: null });
```

- [ ] **Step 10: Signing out clears it**

  In `src/sync/auth.ts`, replace:

```ts
          set({ status: 'signedOut', email: null });
        });
      },
    };
```

  with:

```ts
          set({ status: 'signedOut', email: null, userId: null });
        });
      },
    };
```

- [ ] **Step 11: Run the sign-in tests**

  Run:

```bash
npx vitest run src/sync/auth.test.ts
```

  Expected: every test passes. The summary reads `Tests  27 passed (27)`.

- [ ] **Step 12: Typecheck**

  Run:

```bash
npm run typecheck
```

  Expected: nothing is printed after the `tsc --noEmit` line.

- [ ] **Step 13: Commit**

```bash
git add src/sync/auth.ts src/sync/auth.test.ts
git commit -m "feat: the sign-in store keeps the account id"
```


### Task 5: Rounds on a schedule, the status, and the coordinator

The runner decides when a round happens (and one at a time); the status store is what the screens will show; the coordinator starts and stops the runner as the organizer signs in and out, and wakes it when a change is saved, when the connection returns and when the app is shown again.

**Files:**
- Create: `src/sync/runner.ts`, `src/sync/runner.test.ts`
- Create: `src/sync/syncStore.ts`
- Create: `src/sync/coordinator.ts`, `src/sync/coordinator.test.ts`

- [ ] **Step 1: Runner tests**

  Create `src/sync/runner.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncOutcome } from './engine';
import { createRunner, type RoundResult } from './runner';

const ok = (pending = 0): SyncOutcome => ({ ok: true, pushed: 0, pulled: 0, skippedRows: 0, pending });
const bad = (reason: 'offline' | 'auth' | 'server' | 'otherAccount'): SyncOutcome => ({ ok: false, reason, pending: 1 });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A runner whose rounds return the outcomes given in order (the last one repeats), and that records what happened. */
function setup(outcomes: SyncOutcome[], options: { hold?: boolean } = {}) {
  const log: string[] = [];
  const results: RoundResult[] = [];
  let n = 0;
  let release: (() => void) | undefined;
  const run = vi.fn(async () => {
    log.push(`run@${Date.now()}`);
    const outcome = outcomes[Math.min(n++, outcomes.length - 1)];
    if (options.hold) await new Promise<void>((resolve) => (release = resolve));
    return outcome;
  });
  const runner = createRunner({ run, onStart: () => log.push('start'), onResult: (r) => results.push(r) });
  return { runner, run, results, log, release: () => release?.() };
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;

describe('the sync runner', () => {
  it('runs a round as soon as it starts, and then waits five minutes', async () => {
    const { runner, run } = setup([ok()]);
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * MINUTE - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not start twice', async () => {
    const { runner, run } = setup([ok()]);
    runner.start();
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('waits two seconds after a change, and joins a burst of changes into one round', async () => {
    const { runner, run } = setup([ok()]);
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.poke();
    await vi.advanceTimersByTimeAsync(1500);
    runner.poke();
    await vi.advanceTimersByTimeAsync(499);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('lets a request for now beat a request for later, but not the other way round', async () => {
    const { runner, run } = setup([ok()]);
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.poke(10 * SECOND);
    runner.poke(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    runner.poke(0);
    runner.poke(10 * SECOND);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(9 * SECOND);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('follows a round with one more when a change came in while it ran, and when it left changes waiting', async () => {
    const { runner, run, release } = setup([ok(), ok(1), ok(0)], { hold: true });
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.poke();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * SECOND);
    expect(run).toHaveBeenCalledTimes(2);
    release();
    await vi.advanceTimersByTimeAsync(2 * SECOND);
    expect(run).toHaveBeenCalledTimes(3);
    release();
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('never runs two rounds at once', async () => {
    const { runner, run, release } = setup([ok()], { hold: true });
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.poke(0);
    runner.poke(0);
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(run).toHaveBeenCalledTimes(1);
    release();
  });

  it('tries again after 30 seconds with no connection, and after a minute when the session is not accepted', async () => {
    const offline = setup([bad('offline'), ok()]);
    offline.runner.start();
    await vi.advanceTimersByTimeAsync(29 * SECOND);
    expect(offline.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1 * SECOND);
    expect(offline.run).toHaveBeenCalledTimes(2);

    const auth = setup([bad('auth'), ok()]);
    auth.runner.start();
    await vi.advanceTimersByTimeAsync(59 * SECOND);
    expect(auth.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1 * SECOND);
    expect(auth.run).toHaveBeenCalledTimes(2);
  });

  it('waits longer after each failure from the server, up to five minutes, and starts over after a good round', async () => {
    const { runner, run, log } = setup([bad('server'), bad('server'), bad('server'), ok(), bad('server')]);
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    const gaps: number[] = [];
    for (let i = 0; i < 3; i++) {
      const before = run.mock.calls.length;
      let waited = 0;
      while (run.mock.calls.length === before) {
        await vi.advanceTimersByTimeAsync(SECOND);
        waited += SECOND;
      }
      gaps.push(waited);
    }
    expect(gaps).toEqual([5 * SECOND, 10 * SECOND, 20 * SECOND]);
    expect(log.filter((l) => l.startsWith('run'))).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(5 * MINUTE); // the good round, then the interval
    expect(run).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(5 * SECOND); // failures start from five seconds again
    expect(run).toHaveBeenCalledTimes(6);
  });

  it('caps the wait after repeated failures at five minutes', async () => {
    const { runner, run } = setup([bad('server')]);
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 12; i++) await vi.advanceTimersByTimeAsync(5 * MINUTE);
    const calls = run.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(run.mock.calls.length).toBe(calls + 1);
  });

  it('stops trying when another account owns this device', async () => {
    const { runner, run, results } = setup([bad('otherAccount')]);
    runner.start();
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(run).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it('reports a round that broke, and keeps going with a delay', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const results: RoundResult[] = [];
    const run = vi.fn().mockRejectedValueOnce(new Error('bug')).mockResolvedValue(ok());
    const runner = createRunner({ run, onStart: () => undefined, onResult: (r) => results.push(r) });
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(results).toEqual([{ ok: false, reason: 'error', pending: 0 }]);
    await vi.advanceTimersByTimeAsync(5 * SECOND);
    expect(run).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('stops for good, throws away the result of a round still running, and can start again', async () => {
    const { runner, run, results, release } = setup([ok()], { hold: true });
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.stop();
    release();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(results).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);
    runner.poke(0);
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(run).toHaveBeenCalledTimes(1);

    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(results).toHaveLength(1);
  });

  it('throws away the result of a round from before a stop, even after starting again', async () => {
    const releases: (() => void)[] = [];
    const results: RoundResult[] = [];
    const run = vi.fn(
      () =>
        new Promise<SyncOutcome>((resolve) => {
          releases.push(() => resolve(ok()));
        }),
    );
    const runner = createRunner({ run, onStart: () => undefined, onResult: (r) => results.push(r) });
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.stop();
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    releases[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(results).toEqual([]);
    releases[1]();
    await vi.advanceTimersByTimeAsync(0);
    expect(results).toHaveLength(1);
  });

  it('cancels a round that was planned but has not started when it stops', async () => {
    const { runner, run } = setup([ok()]);
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.poke(5 * SECOND);
    runner.stop();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Coordinator tests**

  Create `src/sync/coordinator.test.ts`:

```ts
import { createStore } from 'zustand/vanilla';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addRosterPlayer, resetRosterDbForTests } from '../store/rosterDb';
import type { AuthStatus } from './auth';
import { startSyncCoordinator, type CoordinatorDeps } from './coordinator';
import type { Remote } from './remote';
import { useSyncStore } from './syncStore';

/** A server that holds nothing and accepts everything, and counts what it is asked. */
function stubRemote() {
  const upserts: string[] = [];
  let pulls = 0;
  const remote: Remote = {
    upsertPlayer: async (row) => {
      upserts.push(row.name);
      return 'ok';
    },
    listLive: async () => [],
    pull: async () => {
      pulls += 1;
      return [];
    },
    uploadPhoto: async () => undefined,
    downloadPhoto: async () => null,
    listPhotoFiles: async () => [],
    removePhotoFiles: async () => undefined,
  };
  return { remote, upserts, pulls: () => pulls };
}

const auth = createStore<{ status: AuthStatus; userId: string | null }>(() => ({ status: 'loading', userId: null }));
const signIn = (userId: string) => auth.setState({ status: 'signedIn', userId });

let stub: ReturnType<typeof stubRemote>;
let onChanged: ReturnType<typeof vi.fn>;
let makeRemote: ReturnType<typeof vi.fn>;
let stop: (() => void) | undefined;

function start(over: Partial<CoordinatorDeps> = {}) {
  stop = startSyncCoordinator({
    auth,
    makeRemote,
    onChanged,
    timing: { debounceMs: 5, intervalMs: 60_000 },
    ...over,
  });
}

beforeEach(async () => {
  await resetRosterDbForTests();
  auth.setState({ status: 'loading', userId: null });
  stub = stubRemote();
  onChanged = vi.fn();
  makeRemote = vi.fn(() => stub.remote);
  useSyncStore.setState({ status: 'off', pending: 0, lastSyncedAt: null });
});
afterEach(() => {
  stop?.();
  stop = undefined;
});

describe('the sync coordinator', () => {
  it('does nothing while nobody is signed in', async () => {
    await addRosterPlayer('Ann');
    start();
    for (const status of ['loading', 'unknown', 'signedOut', 'linkSent', 'unconfigured'] as const) {
      auth.setState({ status, userId: status === 'unknown' ? 'u1' : null });
    }
    await new Promise((r) => setTimeout(r, 30));
    expect(makeRemote).not.toHaveBeenCalled();
    expect(useSyncStore.getState().status).toBe('off');
  });

  it('syncs once signed in, and shows the result', async () => {
    await addRosterPlayer('Ann');
    start();
    signIn('u1');
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
    expect(makeRemote).toHaveBeenCalledWith('u1');
    expect(stub.upserts).toEqual(['Ann']);
    expect(useSyncStore.getState()).toMatchObject({ pending: 0, lastSyncedAt: expect.any(Number) });
    expect(onChanged).toHaveBeenCalled();
  });

  it('is already signed in when it starts', async () => {
    signIn('u1');
    start();
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
  });

  it('pushes a change made on this device soon after', async () => {
    signIn('u1');
    start();
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
    await addRosterPlayer('Ben');
    await vi.waitFor(() => expect(stub.upserts).toEqual(['Ben']));
  });

  it('stops when the organizer signs out, and does not sync later changes', async () => {
    signIn('u1');
    start();
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
    auth.setState({ status: 'signedOut', userId: null });
    expect(useSyncStore.getState().status).toBe('off');
    await addRosterPlayer('Ben');
    await new Promise((r) => setTimeout(r, 40));
    expect(stub.upserts).toEqual([]);
  });

  it('does not sync, and does not clear anything, when the session could not be checked', async () => {
    signIn('u1');
    start();
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
    await addRosterPlayer('Ben');
    auth.setState({ status: 'unknown', userId: 'u1' });
    await new Promise((r) => setTimeout(r, 40));
    expect(useSyncStore.getState().status).toBe('off');
    expect(stub.upserts).not.toContain('Ben');
  });

  it('does nothing when this build has no backend', async () => {
    signIn('u1');
    start({ makeRemote: () => null });
    await new Promise((r) => setTimeout(r, 30));
    expect(useSyncStore.getState().status).toBe('off');
  });

  it('refuses a second account on the same device, and says so', async () => {
    signIn('u1');
    start();
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
    signIn('u2');
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('otherAccount'));
  });

  it('syncs again when the connection comes back, and when the app is shown again after a while', async () => {
    signIn('u1');
    start();
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
    const before = stub.pulls();
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(stub.pulls()).toBe(before + 1));

    // Shown again straight after a round: no new round.
    window.dispatchEvent(new Event('focus'));
    await new Promise((r) => setTimeout(r, 30));
    expect(stub.pulls()).toBe(before + 1);

    // Shown again after a while.
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 31_000);
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(stub.pulls()).toBe(before + 2));
    vi.spyOn(Date, 'now').mockReturnValue(now + 62_000);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 30));
    expect(stub.pulls()).toBe(before + 2);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(stub.pulls()).toBe(before + 3));
    vi.restoreAllMocks();
  });

  it('takes back every listener it added when it is stopped', () => {
    const windowOff = vi.spyOn(window, 'removeEventListener');
    const documentOff = vi.spyOn(document, 'removeEventListener');
    start();
    stop?.();
    stop = undefined;
    expect(windowOff.mock.calls.map(([type]) => type).sort()).toEqual(['focus', 'online']);
    expect(documentOff.mock.calls.map(([type]) => type)).toEqual(['visibilitychange']);
    windowOff.mockRestore();
    documentOff.mockRestore();
  });

  it('stops listening to everything when it is stopped', async () => {
    signIn('u1');
    start();
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
    stop?.();
    stop = undefined;
    const before = stub.pulls();
    window.dispatchEvent(new Event('online'));
    await addRosterPlayer('Ben');
    await new Promise((r) => setTimeout(r, 40));
    expect(stub.pulls()).toBe(before);
    expect(useSyncStore.getState().status).toBe('off');
  });
});
```

- [ ] **Step 3: Watch them fail**

  Run:

```bash
npx vitest run src/sync/runner.test.ts src/sync/coordinator.test.ts
```

  Expected: both files fail to load, with `Failed to resolve import "./runner"` or `"./coordinator"`.

- [ ] **Step 4: The runner**

  Create `src/sync/runner.ts`:

```ts
import type { SyncOutcome } from './engine';

/** What a finished round reports. `error` means the round itself broke (a bug), not the network or the server. */
export type RoundResult = SyncOutcome | { ok: false; reason: 'error'; pending: number };

export interface RunnerOptions {
  /** One round of sync. */
  run: () => Promise<SyncOutcome>;
  onStart: () => void;
  onResult: (result: RoundResult) => void;
  /** How long to wait between rounds when all is well. */
  intervalMs?: number;
  /** How long to wait after a change before syncing it, so a burst of changes is one round. */
  debounceMs?: number;
}

export interface Runner {
  /** Starts syncing now, and keeps going until `stop`. */
  start(): void;
  stop(): void;
  /** Asks for a round soon: after `delayMs`, and straight away when the connection comes back. */
  poke(delayMs?: number): void;
}

const INTERVAL_MS = 5 * 60 * 1000;
const DEBOUNCE_MS = 2000;
const OFFLINE_RETRY_MS = 30 * 1000;
const AUTH_RETRY_MS = 60 * 1000;
const BACKOFF_START_MS = 5000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;

/**
 * Runs sync rounds one at a time. After a good round it waits for the next change (or the interval); after a failure
 * it waits longer each time. A request made while a round runs makes one more round follow it.
 */
export function createRunner(options: RunnerOptions): Runner {
  const { run, onStart, onResult, intervalMs = INTERVAL_MS, debounceMs = DEBOUNCE_MS } = options;
  let active = false;
  let running = false;
  let again = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dueAt = Infinity;
  /** Raised by every stop, so the result of a round that was running at the time is thrown away. */
  let generation = 0;

  function schedule(delayMs: number) {
    const at = Date.now() + delayMs;
    if (timer !== undefined && at >= dueAt) return; // an earlier round is already planned
    clearTimeout(timer);
    dueAt = at;
    timer = setTimeout(round, delayMs);
  }

  async function round() {
    timer = undefined;
    dueAt = Infinity;
    if (!active) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    const mine = generation;
    onStart();
    let result: RoundResult;
    try {
      result = await run();
    } catch (error) {
      console.error('Sync stopped by an unexpected error.', error);
      result = { ok: false, reason: 'error', pending: 0 };
    }
    running = false;
    if (mine !== generation || !active) return;
    onResult(result);
    if (result.ok) {
      failures = 0;
      const more = again || result.pending > 0;
      again = false;
      schedule(more ? debounceMs : intervalMs);
    } else if (result.reason === 'otherAccount') {
      // Nothing will change until someone signs out or in; the coordinator starts a new runner then.
    } else if (result.reason === 'offline') {
      again = false;
      schedule(OFFLINE_RETRY_MS);
    } else if (result.reason === 'auth') {
      again = false;
      schedule(AUTH_RETRY_MS);
    } else {
      again = false;
      schedule(Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** failures));
      failures += 1;
    }
  }

  return {
    start() {
      if (active) return;
      active = true;
      failures = 0;
      schedule(0);
    },
    stop() {
      active = false;
      generation += 1;
      clearTimeout(timer);
      timer = undefined;
      dueAt = Infinity;
      again = false;
      running = false;
    },
    poke(delayMs = debounceMs) {
      if (!active) return;
      if (running) again = true;
      else schedule(delayMs);
    },
  };
}
```

- [ ] **Step 5: The status store**

  Create `src/sync/syncStore.ts`:

```ts
import { create } from 'zustand';

/**
 * Where sync stands, for the screens to show. `off`: not signed in, or not signed in for sure, or no backend.
 * `error`: the server could not be reached or refused something, and sync will try again.
 */
export type SyncStatus = 'off' | 'syncing' | 'synced' | 'offline' | 'error' | 'auth' | 'otherAccount';

export interface SyncState {
  status: SyncStatus;
  /** Players with changes not yet pushed, as of the last round. */
  pending: number;
  /** When the last round ended well, in milliseconds. */
  lastSyncedAt: number | null;
}

export const useSyncStore = create<SyncState>()(() => ({ status: 'off', pending: 0, lastSyncedAt: null }));
```

- [ ] **Step 6: The coordinator**

  Create `src/sync/coordinator.ts`:

```ts
import { subscribeRosterChanges } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useAuthStore, type AuthStatus } from './auth';
import { getSupabase } from './client';
import { syncOnce } from './engine';
import { supabaseRemote, type Remote } from './remote';
import { createRunner, type Runner, type RunnerOptions } from './runner';
import { useSyncStore } from './syncStore';

/** Coming back to the app syncs again, unless a round ended less than this long ago. */
const FOCUS_GAP_MS = 30 * 1000;

export interface CoordinatorDeps {
  auth: {
    getState(): { status: AuthStatus; userId: string | null };
    subscribe(listener: () => void): () => void;
  };
  /** The server for this organizer, or null when this build has no backend. */
  makeRemote(userId: string): Remote | null;
  /** Called when a round changed what this device holds, so the screens can read it again. */
  onChanged(): void;
  /** Shorter waits, for tests. */
  timing?: Pick<RunnerOptions, 'intervalMs' | 'debounceMs'>;
}

const defaultDeps: CoordinatorDeps = {
  auth: useAuthStore,
  makeRemote(userId) {
    const client = getSupabase();
    return client ? supabaseRemote(client, userId) : null;
  },
  onChanged() {
    useRosterStore.getState().load().catch(() => {});
  },
};

/**
 * Keeps one sync runner going while an organizer is signed in, and none otherwise. A saved session that could not be
 * checked (`unknown`) neither syncs nor clears anything. Returns a function that stops it all.
 */
export function startSyncCoordinator(deps: CoordinatorDeps = defaultDeps): () => void {
  let runner: Runner | null = null;
  let runnerUser: string | null = null;
  let lastRoundAt = 0;

  function follow() {
    const { status, userId } = deps.auth.getState();
    const wanted = status === 'signedIn' && userId ? userId : null;
    if (wanted === runnerUser) return;
    runner?.stop();
    runner = null;
    runnerUser = wanted;
    useSyncStore.setState({ status: 'off', pending: 0 });
    if (!wanted) return;
    const remote = deps.makeRemote(wanted);
    if (!remote) return;
    runner = createRunner({
      ...deps.timing,
      run: () => syncOnce(remote, wanted),
      onStart: () => useSyncStore.setState({ status: 'syncing' }),
      onResult(result) {
        lastRoundAt = Date.now();
        if (result.ok) {
          useSyncStore.setState({ status: 'synced', pending: result.pending, lastSyncedAt: lastRoundAt });
          if (result.pushed > 0 || result.pulled > 0) deps.onChanged();
        } else {
          const status = result.reason === 'offline' ? 'offline' : result.reason === 'auth' ? 'auth' : result.reason === 'otherAccount' ? 'otherAccount' : 'error';
          useSyncStore.setState({ status, pending: result.pending });
        }
      },
    });
    // The runner starts on a timer, so nothing here runs inside the sign-in listener that told us about the session.
    runner.start();
  }

  const stopFollowing = deps.auth.subscribe(follow);
  const stopHearing = subscribeRosterChanges(() => runner?.poke());
  const back = () => {
    if (Date.now() - lastRoundAt > FOCUS_GAP_MS) runner?.poke(0);
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') back();
  };
  const onOnline = () => runner?.poke(0);
  window.addEventListener('online', onOnline);
  window.addEventListener('focus', back);
  document.addEventListener('visibilitychange', onVisible);
  follow();

  return () => {
    stopFollowing();
    stopHearing();
    window.removeEventListener('online', onOnline);
    window.removeEventListener('focus', back);
    document.removeEventListener('visibilitychange', onVisible);
    runner?.stop();
    runner = null;
    runnerUser = null;
    useSyncStore.setState({ status: 'off', pending: 0 });
  };
}
```

- [ ] **Step 7: Run the new tests**

  Run:

```bash
npx vitest run src/sync/runner.test.ts src/sync/coordinator.test.ts
```

  Expected: every test passes. The summary reads `Tests  25 passed (25)`.

- [ ] **Step 8: Typecheck**

  Run:

```bash
npm run typecheck
```

  Expected: nothing is printed after the `tsc --noEmit` line.

- [ ] **Step 9: Commit**

```bash
git add src/sync/runner.ts src/sync/runner.test.ts src/sync/syncStore.ts src/sync/coordinator.ts src/sync/coordinator.test.ts
git commit -m "feat: run sync rounds on a schedule while signed in"
```


### Task 6: Turn it on: start sync with the app, and bring the spec in line

The one line that makes the engine run: the app starts the coordinator, which does nothing without a backend or a signed-in organizer. The Settings sentence stops promising backups for later, and the spec is brought in line with what was built. Then the whole suite and the build.

**Files:**
- Create: `src/ui/syncWiring.test.tsx`
- Modify: `src/ui/App.tsx`, `src/ui/SettingsScreen.tsx`
- Modify: `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md`

- [ ] **Step 1: A test that the app starts and stops sync**

  Create `src/ui/syncWiring.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stop = vi.fn();
const start = vi.fn(() => stop);
vi.mock('../sync/coordinator', () => ({ startSyncCoordinator: () => start() }));

beforeEach(() => {
  start.mockClear();
  stop.mockClear();
});

describe('sync in the app', () => {
  it('starts when the app opens and stops when it closes', async () => {
    const { default: App } = await import('./App');
    const { unmount } = render(<App />);
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Watch it fail**

  Run:

```bash
npx vitest run src/ui/syncWiring.test.tsx
```

  Expected: The summary reads `Tests  1 failed (1)`. The coordinator is never started.

- [ ] **Step 3: The app starts the sync coordinator**

  In `src/ui/App.tsx`, replace:

```ts
import { useAuthStore } from '../sync/auth';
```

  with:

```ts
import { useAuthStore } from '../sync/auth';
import { startSyncCoordinator } from '../sync/coordinator';
```

- [ ] **Step 4: ...once, and stops it when the app goes away**

  In `src/ui/App.tsx`, replace:

```ts
  useEffect(() => {
    void initAuth();
  }, [initAuth]);
```

  with:

```ts
  useEffect(() => {
    void initAuth();
  }, [initAuth]);

  // Keeps saved players backed up while signed in. It does nothing without a backend or a signed-in organizer.
  useEffect(() => startSyncCoordinator(), []);
```

- [ ] **Step 5: The sign-in text no longer says backing up is still to come**

  In `src/ui/SettingsScreen.tsx`, replace:

```ts
              Sign in with your email. There is no password: we email you a link. Backing up your saved players comes
              in a later update.
```

  with:

```ts
              Sign in with your email. There is no password: we email you a link. Once you are signed in, your saved
              players and their photos are backed up online and shared between your devices.
```

- [ ] **Step 6: Run it again**

  Run:

```bash
npx vitest run src/ui/syncWiring.test.tsx
```

  Expected: it passes. The summary reads `Tests  1 passed (1)`.

- [ ] **Step 7: Run everything**

  Run:

```bash
npm test
```

  Expected: every test passes. The summary reads `Tests  426 passed (426)`. The count was 311 before this plan.

- [ ] **Step 8: Typecheck and build**

  Run:

```bash
npm run build
```

  Expected: the build finishes and prints the precache size, about 225 KiB with the two Supabase settings unset. With them set it is about 448 KiB.

- [ ] **Step 9: Commit**

```bash
git add src/ui/App.tsx src/ui/SettingsScreen.tsx src/ui/syncWiring.test.tsx
git commit -m "feat: start sync with the app"
```

- [ ] **Step 10: `updatedAt` says what it holds**

  In `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md`, replace:

```md
  updatedAt,             // server time once synced; local edit time until then
```

  with:

```md
  updatedAt,             // local edit time; the server's time once a change pulled from the server is saved
```

- [ ] **Step 11: Push: one player per request, the picture before the row**

  In `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md`, replace:

```md
2. When signed in and online (and again on reconnect, app focus, and every few minutes while open), sync **pushes** the outbox in order: upsert the `players` row, then upload the new photo file if `photoVersion` changed, then delete the superseded photo file. A failed step stays in the outbox and is retried with backoff.
```

  with:

```md
2. When signed in and online (and again on reconnect, app focus, every few minutes while open, and a couple of seconds after a change), sync **pushes** each player marked in the `outbox`, one request per player, deleted players first. For each: upload the photo file if the player has one the server does not (the file goes up before the row that points at it), upsert the `players` row, then delete the photo files that no longer belong to the player. The mark is cleared only if the player has not changed meanwhile. A failed player stays marked and is retried with backoff; one refused player does not hold up the others.
```

- [ ] **Step 12: Pull: an overlap, checked rows, the cursor moves last**

  In `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md`, replace:

```md
3. Sync then **pulls** rows with `updated_at` greater than the stored cursor, merges them into IndexedDB, and downloads any photo whose `photo_version` is newer than the local copy (via authenticated download, stored as a local blob so display never needs the network).
```

  with:

```md
3. Sync then **pulls** the rows written at or after the stored cursor minus two minutes (the overlap covers a write that committed late), oldest first. Each row is checked before it is used, and rows this app would not have written are skipped. A row is merged into IndexedDB, and its photo is downloaded when this device does not have the right one (via authenticated download, stored as a local blob so display never needs the network); a row whose photo file is gone is shown without a photo. The cursor moves only after every row is saved.
```

- [ ] **Step 13: Conflicts: how a merge and a name swap work**

  In `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md`, replace:

```md
it is pushed afterward. If another device created a player with the same name (unique-index violation), the two are merged: the existing server entry is kept, and the local entry's photo is adopted if the server entry has none.
```

  with:

```md
it is pushed afterward. If another device created a player with the same name (unique-index violation), the two are merged: the existing server entry is kept, the other entry stays on this device as a deleted entry that is never pushed, and the kept entry adopts its photo if it has none and its later `lastPlayedAt`. If the name is held by a player whose own rename or deletion is still waiting to be pushed, the push waits for that one first, and two players swapping names are pushed through a temporary name.
```

- [ ] **Step 14: First sign-in, and a second account on the same device**

  In `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md`, replace:

```md
5. **First sign-in on a device:** the local roster and the account's roster are merged by case-insensitive name (union), then both sides converge via the steps above.
```

  with:

```md
5. **First sign-in on a device:** every saved player is marked for a push, so the local roster and the account's roster are merged by case-insensitive name (union) through the name rule above, then both sides converge via the steps above. A device that already holds one account's players does not sync another account; it reports that and leaves the data untouched.
```

- [ ] **Step 15: Commit**

```bash
git add docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md
git commit -m "docs: spec now describes how the sync engine pushes, pulls and merges"
```


### Task 7: Check it on the real project, with a real sign-in

Every test above ran against stand-ins: a simulated server with the real database rules, and the real client library with the network stubbed. This task proves the same thing against the real Supabase project `pikl`, after the plan is merged to production and Vercel has deployed. It takes about fifteen minutes and needs two browsers (or a browser and a phone). There is no status line yet, so the evidence is in the Supabase tables and on the second device.

**Files:**
- No files change.

- [ ] **Step 1: Sign in on the first device and add players**

  Open https://piklmatch.vercel.app. If the app offers **Reload now**, tap it. In **Settings**, sign in with the emailed link if you are not already signed in (the Settings text now says your players are backed up). On **Setup**, add three players, `Ann`, `Ben` and `Cy`, and give Ann a photo in **Manage saved players**. Leave the app open for about ten seconds.

- [ ] **Step 2: Look at the server**

  In the Supabase dashboard, project `pikl`, open the SQL editor and run:
  
  ```sql
  select name, photo_version, photo_seq, deleted_at is not null as deleted from public.players order by name;
  select name from storage.objects where bucket_id = 'player-photos' order by name;
  ```
  
  - [ ] The first query lists `Ann` (photo_version 1 and photo_seq 1 if this is her first photo), `Ben` and `Cy`, none deleted. (Players you saved before this plan are there too.)
  - [ ] The second lists one file, shaped `{your user id}/{Ann's id}/1.jpg`, and nothing for players without a photo.
  - [ ] In the browser DevTools, Application, IndexedDB, `pickleball-roster`: `outbox` is empty, and `syncMeta` has `syncUser` (your user id in lower case) and `syncCursor`.

- [ ] **Step 3: Bring the players to a second device**

  On a second browser profile (or your phone), open the app and sign in with the same email. Within about a minute (switch to the tab, or reload) **Manage saved players** shows `Ann` with her photo, `Ben` and `Cy`. Nothing was typed on this device.

- [ ] **Step 4: Changes travel both ways**

  - [ ] On the first device rename `Cy` to `Cyrus`, and leave the app in view for a few seconds. Wait until the second device has been out of view for at least 30 seconds, then bring it forward: it syncs when it is shown again, and shows `Cyrus` within seconds. (If it was shown less than 30 seconds ago it waits for its next scheduled round, up to five minutes.)
  - [ ] On the second device change Ann's photo. The first shows the new photo after a minute. In the SQL editor Ann's `photo_seq` is `2` and the file list shows only `.../2.jpg` for her.
  - [ ] Delete `Ben` on the first device. The second no longer lists him, and the SQL editor shows `Ben` as deleted.

- [ ] **Step 5: No connection, and the same name twice**

  - [ ] Turn on airplane mode on the second device. Add `Dee`. Nothing complains. Turn airplane mode off: within about a minute `Dee` is in the SQL editor.
  - [ ] With airplane mode on for both devices, add `Eve` on each. Turn airplane mode off on the first device and wait a minute, then turn it off on the second. Afterwards both devices list `Eve` once, and the server has one `Eve`.

- [ ] **Step 6: Signing out**

  Sign out on the first device, then rename `Ann` to `Annie`. The server still says `Ann`. Sign in again: within a minute it says `Annie`. If any check fails, note what you saw and stop: revert the merge of this plan on production, and the rows already on the server stay harmless.


---

## Self-review

**Spec coverage** (spec section "Sync and backend", algorithm steps 1 to 5):

| Spec requirement | Where |
|---|---|
| Changes are marked in the outbox as they are made | Plan 3B1; the runner hears about them in Task 5 |
| Push when signed in and online, on reconnect, on focus, every few minutes, with backoff | Tasks 3 and 5 |
| Push a row, upload the photo, remove the superseded file | Task 3 (the picture first, see decision 4) |
| Pull rows newer than a cursor, merge, download photos | Task 3 |
| Last write wins; a change waiting is never overwritten | Tasks 1 and 3 |
| Same name on two devices is merged; the server entry is kept and the photo adopted | Tasks 1 and 3 |
| First sign-in: union by name | Task 3 (marks everything; names merge on push) |
| Signed out or unchecked sessions do nothing | Task 5 |
| Validate pulled rows (Plan 2 review) | Task 2 |
| Names handled like the database (Plan 3A review) | Tasks 2 and 3 |
| The real server accepts what the adapter sends | Task 2 (real client library, stubbed network) and Task 7 (real project) |

Not in this plan on purpose: the status line, the banner, "Delete all my data", the way out of "another account", the blocked-upgrade message, and loading the Supabase client on demand. These are Plan 3B3 or later.

**Placeholder scan:** none. Every step has the exact text to write or the exact command to run.

**Type consistency:** `PulledPlayer` is defined in `rosterDb.ts` (Task 1) and used unchanged by `rows.ts`, `engine.ts` and the tests. `PushRow` and `parsePlayerRow` (Task 2) are the only row types the engine and adapter share. `Remote`, `RemoteError` and `isRemoteError` (Task 2) are used by the engine, the fake server and the coordinator; the engine tests two copies of the modules at once, which is why errors are recognised by name and `kind`, not with `instanceof`. `SyncOutcome` (Task 3) is the only type the runner and coordinator read. `AuthState.userId` (Task 4) is the only new field the coordinator reads from the sign-in store.

**What Plan 3B3 can rely on:** `useSyncStore` (`status`: `off`, `syncing`, `synced`, `offline`, `error`, `auth` or `otherAccount`; `pending`: players waiting; `lastSyncedAt`); `syncMeta` keys `syncUser` and `syncCursor` (3B3's "Delete all my data" and "another account" exit clear them, with `outboxRev` left alone); `photoFolder` and `photoPath` for removing files; `Remote.listPhotoFiles` and `removePhotoFiles` for the purge.

**Known limits, carried to 3B3 and later:**
- Two devices that each give the same player a photo before either has synced pick the same file name. The first to upload wins the file; the other keeps its own picture on its own device until that player's photo changes again. Fixing it needs a check that the file at the path is the one this device sent.
- A player merged away during first sign-in disappears from the roster while a session that names them is running: the session carries on, but "played" times for that player are no longer recorded.
- A name that Postgres lower-cases differently from JavaScript (a few unusual letters) cannot be matched in a name clash, so that player stays waiting and the status ends as an error. Nothing is lost.
- A photo the server refuses (not JPEG, over 200 KB) is retried forever with backoff. The app only makes small JPEGs, so this should not happen.
- A stray file from a push that failed between the upload and the row is removed the next time that player is pushed. A player never pushed again leaves it behind.
- `updatedAt` stays the local edit time until a change from the server is saved, so it is not a reliable "last synced" time.
- The "another account" state has no exit until Plan 3B3.
- The Supabase client is still loaded up front: with the two settings set, the service worker precaches about 448 KiB (about 225 KiB without them).
