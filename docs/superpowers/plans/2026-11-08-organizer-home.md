# Home: the club's recurring sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app opens on the club's own sessions (Tuesday, Thursday, Saturday), each with an editable time and venue. One tap starts a session from a slot, and a running session can be extended.

**Architecture:** A small store holds the slots and the saved venues on this device. Home reads it and starts Who's playing with a plan (weekday, venue, planned end). The session carries the venue and the planned end, and one pure engine action extends the end. The summary, Past sessions and the shared picture show the venue.

**Tech Stack:** React, TypeScript, Vite, Zustand, Vitest. No new dependencies.

---

## Decisions (settled 2026-11-08)

1. **Slots live on this device**, in `localStorage` with a memory fallback. They do not sync in this phase. Syncing slots to the account needs a new table and a migration, like the named groups in Phase 5.
2. **Slots ship with a weekday only.** No time and no venue are invented. A card shows "Add a time" and "Add a venue" until the organizer fills them in.
3. **The data is a list of slots**, so more than three can exist later. This phase edits time and venue only: there is no add, remove or change-day control. "Start a one-off session" covers anything else.
4. **"Just this time" is the default** when editing, because most changes last one week. It is kept in memory only, and it clears when the session starts. "Always for the weekday" writes to the slot.
5. **The big card is today's slot**, or the next weekday that has one. Any slot can be started on any day. The calendar never blocks anything.
6. **Extend changes only that session's planned end.** Nothing ends a session by itself, and there is no countdown prompt in this phase.
7. **The weekday regulars shortcut follows the slot**, not today. A Thursday session started on a Friday offers Thursday's regulars.
8. **The venue follows the session** onto the summary, the Past sessions list and the shared picture.
9. **Home has no Settings button of its own.** The account button in the app header already opens Settings.

**Left for later, on purpose:** add, remove and change-day for slots; syncing slots across devices; a "15 minutes left" prompt (it should be as quiet as the game-length reminder in 4c: once, no sound, dismissible); a "planned 7 to 9, ran to 9:30" line in the summary; courts per venue.

## File structure

| File | Job |
|---|---|
| `src/engine/types.ts`, `session.ts`, `errors.ts`, `index.ts` | `venue` and `plannedEndAt` on a session, `extendSession` |
| `src/store/persistence.ts` | accept the two new fields when a saved session is read back |
| `src/store/slots.ts` | slots, venues, `nextSlot`, clock and range text, the slots store |
| `src/ui/EditSlotSheet.tsx`, `weekdays.ts` | the "when and where" sheet |
| `src/ui/HomeScreen.tsx` | Home |
| `src/ui/App.tsx`, `SetupScreen.tsx` | landing on Home, starting from a plan |
| `src/ui/ExtendSheet.tsx`, `LiveScreen.tsx` | the "Ends" button and the extend sheet |
| `src/ui/SummaryScreen.tsx`, `PastSessionsScreen.tsx`, `cardModel.ts`, `cardDraw.ts` | the venue on three outputs |
| `src/test/renderAtSetup.tsx` | test helper: opens a one-off session from Home |

Each task below is one commit. A task writes its tests first, runs them and sees them fail, then writes the code. The code in this plan is the code that was built and proven first: it was run against the full suite and 53 deliberate breaks, then replayed from this document onto a clean checkout of production.

---


### Task 1: A session can carry a venue and a planned end, and be extended (engine)

The engine is where the new facts live: a venue and a planned end on the session, and one pure action that moves the end. Nothing here touches a screen.

**Files:**
- Modify: `src/engine/errors.ts`
- Create: `src/engine/extend.test.ts`
- Modify: `src/engine/index.ts`
- Modify: `src/engine/session.ts`
- Modify: `src/engine/types.ts`
- Modify: `src/store/persistence.test.ts`
- Modify: `src/store/persistence.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/engine/extend.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createSession, endSession, extendSession } from './session';
import { expectEngineError, makeCtx, newTestSession } from './testing';

describe('extendSession', () => {
  it('moves the planned end later by the minutes given', () => {
    const s = { ...newTestSession(['A', 'B', 'C', 'D']), plannedEndAt: 5_000_000 };
    const next = extendSession(s, 30, makeCtx(1, 9_000_000));
    expect(next.plannedEndAt).toBe(5_000_000 + 30 * 60_000);
  });

  it('starts from now when the session has no planned end', () => {
    const s = newTestSession(['A', 'B', 'C', 'D']);
    const next = extendSession(s, 15, makeCtx(1, 2_000_000));
    expect(next.plannedEndAt).toBe(2_000_000 + 15 * 60_000);
  });

  it('accepts the limits 1 and 240', () => {
    const s = newTestSession(['A', 'B', 'C', 'D']);
    expect(extendSession(s, 1, makeCtx(1, 0)).plannedEndAt).toBe(60_000);
    expect(extendSession(s, 240, makeCtx(1, 0)).plannedEndAt).toBe(240 * 60_000);
  });

  it('rejects 0, 241, fractions, negatives and non-numbers', () => {
    const s = newTestSession(['A', 'B', 'C', 'D']);
    for (const m of [0, 241, 1.5, -5, NaN, Infinity]) {
      expectEngineError(() => extendSession(s, m, makeCtx()), 'INVALID_EXTENSION');
    }
  });

  it('rejects an ended session', () => {
    const ended = endSession(newTestSession(['A', 'B', 'C', 'D']), makeCtx());
    expectEngineError(() => extendSession(ended, 30, makeCtx()), 'SESSION_ENDED');
  });

  it('checks the ended session before the minutes', () => {
    const ended = endSession(newTestSession(['A', 'B', 'C', 'D']), makeCtx());
    expectEngineError(() => extendSession(ended, 0, makeCtx()), 'SESSION_ENDED');
  });

  it('returns a clone and leaves the original alone', () => {
    const s = { ...newTestSession(['A', 'B', 'C', 'D']), plannedEndAt: 1_000_000 };
    const next = extendSession(s, 15, makeCtx());
    expect(next).not.toBe(s);
    expect(s.plannedEndAt).toBe(1_000_000);
    expect(next.players).toEqual(s.players);
  });
});

describe('createSession venue and planned end', () => {
  const base = { name: 'x', mode: 'fairness' as const, courtCount: 1, players: [] };

  it('copies a trimmed venue and the planned end', () => {
    const s = createSession({ ...base, venue: '  Tacloban Sports Hall ', plannedEndAt: 123 }, makeCtx());
    expect(s.venue).toBe('Tacloban Sports Hall');
    expect(s.plannedEndAt).toBe(123);
  });

  it('omits the fields when not given or empty', () => {
    const s = createSession({ ...base, venue: '   ' }, makeCtx());
    expect('venue' in s).toBe(false);
    expect('plannedEndAt' in s).toBe(false);
  });
});
```

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/store/persistence.test.ts`:

```diff
diff --git a/src/store/persistence.test.ts b/src/store/persistence.test.ts
--- a/src/store/persistence.test.ts
+++ b/src/store/persistence.test.ts
@@ -183,2 +183,21 @@ describe('a session with players asked to play next', () => {
   });
+
+  it('keeps a venue and a planned end across a reload, and rejects wrong types', () => {
+    const s = newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }, makeCtx());
+    s.venue = 'Tacloban Sports Hall';
+    s.plannedEndAt = 5_000_000;
+    savePersisted({ session: s, undoStack: [] });
+    expect(loadPersisted()?.session).toEqual(s);
+    for (const [field, bad] of [
+      ['venue', 5],
+      ['venue', null],
+      ['plannedEndAt', '5'],
+      ['plannedEndAt', null],
+    ] as const) {
+      const broken = JSON.parse(JSON.stringify(s));
+      broken[field] = bad;
+      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, session: broken, undoStack: [] }));
+      expect(loadPersisted()).toBeNull();
+    }
+  });
 });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/engine/extend.test.ts src/store/persistence.test.ts`
Expected: 9 tests fail. `extendSession` is not exported, `createSession` drops `venue` and `plannedEndAt`, and `isSession` accepts a bad `venue` or `plannedEndAt`.

- [ ] **Step 3: Write the code**

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/engine/errors.ts`, `src/engine/index.ts`, `src/engine/session.ts`, `src/engine/types.ts`, `src/store/persistence.ts`:

```diff
diff --git a/src/engine/errors.ts b/src/engine/errors.ts
--- a/src/engine/errors.ts
+++ b/src/engine/errors.ts
@@ -12,3 +12,5 @@ export type EngineErrorCode =
   | 'NO_REPLACEMENT'
-  | 'CANNOT_RETURN';
+  | 'CANNOT_RETURN'
+  | 'SESSION_ENDED'
+  | 'INVALID_EXTENSION';
 
diff --git a/src/engine/index.ts b/src/engine/index.ts
--- a/src/engine/index.ts
+++ b/src/engine/index.ts
@@ -3,3 +3,3 @@ export { EngineError } from './errors';
 export type { EngineErrorCode } from './errors';
-export { createSession, addPlayer, endSession } from './session';
+export { createSession, addPlayer, endSession, extendSession } from './session';
 export { finishGame } from './game';
diff --git a/src/engine/session.ts b/src/engine/session.ts
--- a/src/engine/session.ts
+++ b/src/engine/session.ts
@@ -45,2 +45,3 @@ export function createSession(input: NewSessionInput, ctx: Ctx): Session {
   }
+  const venue = input.venue?.trim();
   const s: Session = {
@@ -56,2 +57,4 @@ export function createSession(input: NewSessionInput, ctx: Ctx): Session {
     ...(input.autoStart === undefined ? {} : { autoStart: input.autoStart }),
+    ...(venue ? { venue } : {}),
+    ...(input.plannedEndAt === undefined ? {} : { plannedEndAt: input.plannedEndAt }),
   };
@@ -75 +78,12 @@ export function endSession(s: Session, ctx: Ctx): Session {
 }
+
+/** Moves the planned end later. Starts from now when no end was planned. */
+export function extendSession(s: Session, minutes: number, ctx: Ctx): Session {
+  if (s.endedAt !== undefined) throw new EngineError('SESSION_ENDED', 'This session has already ended.');
+  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
+    throw new EngineError('INVALID_EXTENSION', 'Extend by 1 to 240 minutes.');
+  }
+  const next = cloneSession(s);
+  next.plannedEndAt = (s.plannedEndAt ?? ctx.now) + minutes * 60_000;
+  return next;
+}
diff --git a/src/engine/types.ts b/src/engine/types.ts
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -89,2 +89,6 @@ export interface Session {
   pinned?: PlayerId[];
+  /** Where the session is played. */
+  venue?: string;
+  /** When the session is planned to end, as a ms timestamp. Nothing ends the session by itself. */
+  plannedEndAt?: number;
 }
@@ -111,2 +115,4 @@ export interface NewSessionInput {
   autoStart?: boolean;
+  venue?: string;
+  plannedEndAt?: number;
 }
diff --git a/src/store/persistence.ts b/src/store/persistence.ts
--- a/src/store/persistence.ts
+++ b/src/store/persistence.ts
@@ -78,2 +78,4 @@ function isSession(x: unknown): x is Session {
     isNum(x.createdAt) &&
+    (x.venue === undefined || typeof x.venue === 'string') &&
+    (x.plannedEndAt === undefined || isNum(x.plannedEndAt)) &&
     (x.pinned === undefined || (Array.isArray(x.pinned) && x.pinned.every((id) => typeof id === 'string')))
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/engine/extend.test.ts src/store/persistence.test.ts`
Expected: both files pass.

Then run `npx tsc --noEmit && npx vitest run`.
Expected: `tsc` prints nothing and the suite shows 915 tests across 94 files.

- [ ] **Step 5: Commit**

```bash
git add src/engine/errors.ts src/engine/extend.test.ts src/engine/index.ts src/engine/session.ts src/engine/types.ts src/store/persistence.test.ts src/store/persistence.ts
git commit -m "Let a session carry a venue and a planned end, and extend it"
```

### Task 2: The club's recurring slots and their venues (store)

A slot is a weekday with an optional time range and venue. Slots live on this device in `localStorage`, with a memory fallback when storage is blocked, like the other small settings. "Just this time" edits live in memory only.

**Files:**
- Create: `src/store/slots.test.ts`
- Create: `src/store/slots.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/store/slots.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SLOTS,
  SLOTS_KEY,
  effectiveSlot,
  formatClock,
  formatRange,
  nextSlot,
  parseSlots,
  timestampAt,
  useSlotsStore,
  type Slot,
} from './slots';

const fresh = () =>
  useSlotsStore.setState({
    slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })),
    venues: [],
    tonight: {},
  });

beforeEach(() => {
  localStorage.clear();
  fresh();
});
afterEach(() => vi.restoreAllMocks());

const stored = () => parseSlots(localStorage.getItem(SLOTS_KEY));

describe('DEFAULT_SLOTS', () => {
  it('is Tuesday, Thursday and Saturday with no time and no venue', () => {
    expect(DEFAULT_SLOTS.slots).toEqual([
      { id: 'tue', weekday: 2 },
      { id: 'thu', weekday: 4 },
      { id: 'sat', weekday: 6 },
    ]);
    expect(DEFAULT_SLOTS.venues).toEqual([]);
  });
});

describe('parseSlots', () => {
  it('returns the defaults for null, bad JSON and the wrong shape', () => {
    expect(parseSlots(null)).toEqual(DEFAULT_SLOTS);
    expect(parseSlots('{not json')).toEqual(DEFAULT_SLOTS);
    expect(parseSlots('42')).toEqual(DEFAULT_SLOTS);
    expect(parseSlots('null')).toEqual(DEFAULT_SLOTS);
    expect(parseSlots('{"slots":"x","venues":[]}')).toEqual(DEFAULT_SLOTS);
    expect(parseSlots('{"slots":[]}')).toEqual(DEFAULT_SLOTS);
    expect(parseSlots('{"slots":[],"venues":"x"}')).toEqual(DEFAULT_SLOTS);
  });

  it('keeps valid slots and venues as stored', () => {
    const data = {
      slots: [{ id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Hall' }, { id: 'x', weekday: 0 }],
      venues: ['Hall'],
    };
    expect(parseSlots(JSON.stringify(data))).toEqual(data);
  });

  it('drops invalid slots', () => {
    const raw = JSON.stringify({
      slots: [
        { id: 'ok', weekday: 1 },
        null,
        'x',
        { weekday: 1 },
        { id: '', weekday: 1 },
        { id: 'a', weekday: 7 },
        { id: 'b', weekday: -1 },
        { id: 'c', weekday: 1.5 },
        { id: 'd', weekday: '1' },
        { id: 'e', weekday: 1, startMin: '19:00' },
        { id: 'f', weekday: 1, endMin: null },
        { id: 'g', weekday: 1, venue: 5 },
      ],
      venues: [],
    });
    expect(parseSlots(raw).slots).toEqual([{ id: 'ok', weekday: 1 }]);
  });

  it('drops non-string venues', () => {
    const raw = JSON.stringify({ slots: [], venues: ['Hall', 3, null, 'Court B'] });
    expect(parseSlots(raw)).toEqual({ slots: [], venues: ['Hall', 'Court B'] });
  });
});

describe('nextSlot', () => {
  // 2026-11-08 is a Sunday. Local dates, so the weekday does not depend on the time zone.
  const sunday = new Date(2026, 10, 8, 10, 0);
  const day = (n: number) => new Date(2026, 10, 8 + n, 10, 0); // 0 Sun .. 6 Sat
  const slot = (id: string, weekday: number, startMin?: number): Slot => ({ id, weekday, startMin });

  it('returns undefined with no slots', () => {
    expect(nextSlot([], sunday)).toBeUndefined();
  });

  it('picks the slot that is today', () => {
    expect(nextSlot(DEFAULT_SLOTS.slots, day(4))?.id).toBe('thu');
  });

  it('picks the earliest of several slots today, with unset times last', () => {
    const slots = [slot('none', 4), slot('late', 4, 1200), slot('early', 4, 600)];
    expect(nextSlot(slots, day(4))?.id).toBe('early');
    expect(nextSlot([slot('none', 4), slot('late', 4, 1200)], day(4))?.id).toBe('late');
    expect(nextSlot([slot('a', 4), slot('b', 4)], day(4))?.id).toBe('a');
  });

  it('picks the next weekday that has a slot', () => {
    expect(nextSlot(DEFAULT_SLOTS.slots, day(0))?.id).toBe('tue');
    expect(nextSlot(DEFAULT_SLOTS.slots, day(1))?.id).toBe('tue');
    expect(nextSlot(DEFAULT_SLOTS.slots, day(3))?.id).toBe('thu');
    expect(nextSlot(DEFAULT_SLOTS.slots, day(5))?.id).toBe('sat');
  });

  it('takes the earliest slot on that next weekday', () => {
    const slots = [slot('b', 2, 1200), slot('a', 2, 600)];
    expect(nextSlot(slots, day(0))?.id).toBe('a');
  });

  it('wraps from Saturday to Sunday and on into the next week', () => {
    const slots = [slot('sun', 0), slot('tue', 2)];
    expect(nextSlot(slots, day(6))?.id).toBe('sun');
    expect(nextSlot([slot('tue', 2)], day(6))?.id).toBe('tue');
  });

  it('does not change the list it was given', () => {
    const slots = [slot('late', 4, 1200), slot('early', 4, 600)];
    nextSlot(slots, day(4));
    expect(slots.map((s) => s.id)).toEqual(['late', 'early']);
  });
});

describe('formatClock', () => {
  it('formats the cases around noon and midnight', () => {
    expect(formatClock(0)).toBe('12:00 am');
    expect(formatClock(30)).toBe('12:30 am');
    expect(formatClock(60)).toBe('1:00 am');
    expect(formatClock(11 * 60 + 59)).toBe('11:59 am');
    expect(formatClock(12 * 60)).toBe('12:00 pm');
    expect(formatClock(12 * 60 + 5)).toBe('12:05 pm');
    expect(formatClock(13 * 60)).toBe('1:00 pm');
    expect(formatClock(19 * 60)).toBe('7:00 pm');
    expect(formatClock(23 * 60 + 59)).toBe('11:59 pm');
  });
});

describe('formatRange', () => {
  it('shares the am or pm when both ends match', () => {
    expect(formatRange(19 * 60, 21 * 60)).toBe('7:00 to 9:00 pm');
    expect(formatRange(9 * 60, 11 * 60 + 30)).toBe('9:00 to 11:30 am');
  });
  it('shows both when they differ', () => {
    expect(formatRange(11 * 60, 13 * 60)).toBe('11:00 am to 1:00 pm');
    expect(formatRange(11 * 60 + 30, 12 * 60)).toBe('11:30 am to 12:00 pm');
  });
  it('handles one end or none', () => {
    expect(formatRange(19 * 60, undefined)).toBe('From 7:00 pm');
    expect(formatRange(undefined, 21 * 60)).toBe('Until 9:00 pm');
    expect(formatRange(undefined, undefined)).toBe('Add a time');
  });
  it('treats 0 minutes as a real time', () => {
    expect(formatRange(0, undefined)).toBe('From 12:00 am');
    expect(formatRange(undefined, 0)).toBe('Until 12:00 am');
  });
});

describe('timestampAt', () => {
  it('is the local time on the day of now', () => {
    const now = new Date(2026, 10, 11, 15, 42, 7, 500).getTime();
    expect(timestampAt(21 * 60, now)).toBe(new Date(2026, 10, 11, 21, 0, 0, 0).getTime());
    expect(timestampAt(0, now)).toBe(new Date(2026, 10, 11, 0, 0, 0, 0).getTime());
    expect(timestampAt(19 * 60 + 30, now)).toBe(new Date(2026, 10, 11, 19, 30, 0, 0).getTime());
  });
});

describe('effectiveSlot', () => {
  const base: Slot = { id: 'tue', weekday: 2, startMin: 1140, venue: 'Hall' };
  it('returns the slot when there is no override', () => {
    expect(effectiveSlot(base, {})).toEqual(base);
  });
  it('merges the override for that slot only', () => {
    expect(effectiveSlot(base, { tue: { endMin: 1260, venue: 'Court B' } })).toEqual({
      ...base,
      endMin: 1260,
      venue: 'Court B',
    });
    expect(effectiveSlot(base, { thu: { venue: 'Court B' } })).toEqual(base);
  });
  it('lets an override clear a value', () => {
    expect(effectiveSlot(base, { tue: { venue: undefined } }).venue).toBeUndefined();
  });
});

describe('useSlotsStore', () => {
  it('saveSlot updates the slot and persists it', () => {
    useSlotsStore.getState().saveSlot('tue', { startMin: 1140, endMin: 1260, venue: 'Hall' });
    expect(useSlotsStore.getState().slots[0]).toEqual({ id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Hall' });
    expect(stored().slots[0]).toEqual({ id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Hall' });
    expect(stored().slots).toHaveLength(3);
  });

  it('saveSlot can clear a value, and ignores an unknown id', () => {
    const s = useSlotsStore.getState();
    s.saveSlot('tue', { startMin: 1140, venue: 'Hall' });
    useSlotsStore.getState().saveSlot('tue', { venue: undefined });
    expect(stored().slots[0]).toEqual({ id: 'tue', weekday: 2, startMin: 1140 });
    const before = localStorage.getItem(SLOTS_KEY);
    useSlotsStore.getState().saveSlot('nope', { startMin: 5 });
    expect(localStorage.getItem(SLOTS_KEY)).toBe(before);
  });

  it('saveSlot keeps the saved venues', () => {
    useSlotsStore.getState().addVenue('Hall');
    useSlotsStore.getState().saveSlot('tue', { venue: 'Hall' });
    expect(stored().venues).toEqual(['Hall']);
  });

  it('setTonight changes memory only, and clearTonight removes it', () => {
    useSlotsStore.getState().setTonight('tue', { startMin: 1200 });
    expect(useSlotsStore.getState().tonight).toEqual({ tue: { startMin: 1200 } });
    expect(localStorage.getItem(SLOTS_KEY)).toBeNull();
    expect(useSlotsStore.getState().slots[0].startMin).toBeUndefined();
    useSlotsStore.getState().setTonight('tue', { venue: 'Hall' });
    expect(useSlotsStore.getState().tonight.tue).toEqual({ startMin: 1200, venue: 'Hall' });
    useSlotsStore.getState().clearTonight('tue');
    expect(useSlotsStore.getState().tonight).toEqual({});
  });

  describe('addVenue', () => {
    const add = (n: string) => useSlotsStore.getState().addVenue(n);

    it('trims, stores, persists and returns the stored name', () => {
      expect(add('  Tacloban Sports Hall ')).toBe('Tacloban Sports Hall');
      expect(useSlotsStore.getState().venues).toEqual(['Tacloban Sports Hall']);
      expect(stored().venues).toEqual(['Tacloban Sports Hall']);
    });

    it('ignores an empty name', () => {
      expect(add('   ')).toBe('');
      expect(useSlotsStore.getState().venues).toEqual([]);
      expect(localStorage.getItem(SLOTS_KEY)).toBeNull();
    });

    it('caps a name at 40 characters', () => {
      const out = add('x'.repeat(60));
      expect(out).toBe('x'.repeat(40));
      expect(useSlotsStore.getState().venues).toEqual(['x'.repeat(40)]);
    });

    it('keeps a 40 character name whole', () => {
      expect(add('y'.repeat(40))).toBe('y'.repeat(40));
    });

    it('dedupes case-insensitively and returns the name already stored', () => {
      add('Tacloban Hall');
      expect(add('  tacloban HALL ')).toBe('Tacloban Hall');
      expect(useSlotsStore.getState().venues).toEqual(['Tacloban Hall']);
    });

    it('stops at 12 venues', () => {
      for (let i = 1; i <= 12; i++) expect(add(`Venue ${i}`)).toBe(`Venue ${i}`);
      expect(add('Venue 13')).toBe('');
      expect(useSlotsStore.getState().venues).toHaveLength(12);
      expect(add('venue 5')).toBe('Venue 5');
    });
  });

  it('keeps working in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => useSlotsStore.getState().saveSlot('tue', { startMin: 600 })).not.toThrow();
    expect(useSlotsStore.getState().slots[0].startMin).toBe(600);
    expect(useSlotsStore.getState().addVenue('Hall')).toBe('Hall');
    expect(useSlotsStore.getState().venues).toEqual(['Hall']);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/store/slots.test.ts`
Expected: the file fails to load because `./slots` does not exist.

- [ ] **Step 3: Write the code**

Create `src/store/slots.ts`:

```ts
import { create } from 'zustand';

/** The club's recurring sessions. They live on this device only. */
export interface Slot {
  id: string;
  /** 0 is Sunday, 6 is Saturday. */
  weekday: number;
  /** Minutes after midnight. */
  startMin?: number;
  endMin?: number;
  venue?: string;
}

export interface SlotsData {
  slots: Slot[];
  venues: string[];
}

type SlotEdit = Partial<Pick<Slot, 'startMin' | 'endMin' | 'venue'>>;

export const SLOTS_KEY = 'pickleball.slots';
export const MAX_VENUES = 12;
export const MAX_VENUE_LENGTH = 40;

export const DEFAULT_SLOTS: SlotsData = {
  slots: [
    { id: 'tue', weekday: 2 },
    { id: 'thu', weekday: 4 },
    { id: 'sat', weekday: 6 },
  ],
  venues: [],
};

const defaults = (): SlotsData => ({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [] });

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isOptNum = (x: unknown) => x === undefined || (typeof x === 'number' && Number.isFinite(x));

function isSlot(x: unknown): x is Slot {
  return (
    isObject(x) &&
    typeof x.id === 'string' &&
    x.id !== '' &&
    typeof x.weekday === 'number' &&
    Number.isInteger(x.weekday) &&
    x.weekday >= 0 &&
    x.weekday <= 6 &&
    isOptNum(x.startMin) &&
    isOptNum(x.endMin) &&
    (x.venue === undefined || typeof x.venue === 'string')
  );
}

/** Defaults for anything missing or malformed. Drops invalid slots and non-string venues. */
export function parseSlots(raw: string | null): SlotsData {
  if (raw === null) return defaults();
  try {
    const data: unknown = JSON.parse(raw);
    if (!isObject(data) || !Array.isArray(data.slots) || !Array.isArray(data.venues)) return defaults();
    return {
      slots: data.slots.filter(isSlot),
      venues: data.venues.filter((v): v is string => typeof v === 'string'),
    };
  } catch {
    return defaults();
  }
}

/** Earliest start first, slots with no start last. Stable. */
const byStart = (a: Slot, b: Slot) => (a.startMin ?? Infinity) - (b.startMin ?? Infinity) || 0;

function firstOn(slots: Slot[], weekday: number): Slot | undefined {
  return slots.filter((s) => s.weekday === weekday).sort(byStart)[0];
}

/** The slot that is today, else the first slot on the next weekday that has one. */
export function nextSlot(slots: Slot[], today: Date): Slot | undefined {
  for (let d = 0; d < 7; d++) {
    const found = firstOn(slots, (today.getDay() + d) % 7);
    if (found) return found;
  }
  return undefined;
}

const part = (min: number) => {
  const h = Math.floor(min / 60);
  const m = String(min % 60).padStart(2, '0');
  return { text: `${h % 12 || 12}:${m}`, suffix: h % 24 < 12 ? 'am' : 'pm' };
};

export function formatClock(min: number): string {
  const p = part(min);
  return `${p.text} ${p.suffix}`;
}

export function formatRange(startMin?: number, endMin?: number): string {
  if (startMin !== undefined && endMin !== undefined) {
    const a = part(startMin);
    const b = part(endMin);
    return a.suffix === b.suffix ? `${a.text} to ${b.text} ${b.suffix}` : `${formatClock(startMin)} to ${formatClock(endMin)}`;
  }
  if (startMin !== undefined) return `From ${formatClock(startMin)}`;
  if (endMin !== undefined) return `Until ${formatClock(endMin)}`;
  return 'Add a time';
}

/** The local time `min` minutes after midnight, on the day of `now`. */
export function timestampAt(min: number, now: number): number {
  const d = new Date(now);
  d.setHours(0, min, 0, 0);
  return d.getTime();
}

/** The slot with this-time-only edits laid over it. */
export function effectiveSlot(slot: Slot, tonight: Record<string, SlotEdit>): Slot {
  return { ...slot, ...tonight[slot.id] };
}

function load(): SlotsData {
  try {
    return parseSlots(localStorage.getItem(SLOTS_KEY));
  } catch {
    return defaults();
  }
}

function persist(data: SlotsData): void {
  try {
    localStorage.setItem(SLOTS_KEY, JSON.stringify({ slots: data.slots, venues: data.venues }));
  } catch {
    // Storage is blocked or full. The choice still holds until the app closes.
  }
}

interface SlotsState extends SlotsData {
  /** This-time-only edits. Never written to storage. */
  tonight: Record<string, SlotEdit>;
  saveSlot: (id: string, patch: SlotEdit) => void;
  setTonight: (id: string, patch: SlotEdit) => void;
  clearTonight: (id: string) => void;
  /** Returns the name as stored, or an empty string when nothing was stored. */
  addVenue: (name: string) => string;
}

export const useSlotsStore = create<SlotsState>()((set, get) => ({
  ...load(),
  tonight: {},
  saveSlot(id, patch) {
    const { slots, venues } = get();
    if (!slots.some((s) => s.id === id)) return;
    const next = slots.map((s) => {
      if (s.id !== id) return s;
      const merged: Record<string, unknown> = { ...s, ...patch };
      for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
      return merged as unknown as Slot;
    });
    set({ slots: next });
    persist({ slots: next, venues });
  },
  setTonight(id, patch) {
    set((st) => ({ tonight: { ...st.tonight, [id]: { ...st.tonight[id], ...patch } } }));
  },
  clearTonight(id) {
    set((st) => {
      const { [id]: _gone, ...rest } = st.tonight;
      return { tonight: rest };
    });
  },
  addVenue(name) {
    const clean = name.trim().slice(0, MAX_VENUE_LENGTH).trim();
    if (!clean) return '';
    const { slots, venues } = get();
    const existing = venues.find((v) => v.toLowerCase() === clean.toLowerCase());
    if (existing) return existing;
    if (venues.length >= MAX_VENUES) return '';
    const next = [...venues, clean];
    set({ venues: next });
    persist({ slots, venues: next });
    return clean;
  },
}));
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/store/slots.test.ts`
Expected: all 32 tests pass.

Then run `npx tsc --noEmit && npx vitest run`.
Expected: `tsc` prints nothing and the suite shows 947 tests across 95 files.

- [ ] **Step 5: Commit**

```bash
git add src/store/slots.test.ts src/store/slots.ts
git commit -m "Add the club's recurring session slots and their venues"
```

### Task 3: The sheet that edits a slot's time and venue

One sheet for when and where. It defaults to "Just this time", because most changes last one week. "Always for the weekday" is the second choice.

**Files:**
- Modify: `src/styles/app.css`
- Create: `src/ui/EditSlotSheet.test.tsx`
- Create: `src/ui/EditSlotSheet.tsx`
- Create: `src/ui/weekdays.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/EditSlotSheet.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SLOTS, MAX_VENUES, useSlotsStore, type Slot } from '../store/slots';
import { EditSlotSheet } from './EditSlotSheet';

const tue: Slot = { id: 'tue', weekday: 2 };

beforeEach(() => {
  localStorage.clear();
  useSlotsStore.setState({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {} });
});

function setup(over: Partial<Slot> = {}, venues: string[] = ['Hall A', 'Hall B']) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  useSlotsStore.setState({ venues });
  const user = userEvent.setup();
  const effective = { ...tue, ...over };
  render(<EditSlotSheet slot={tue} effective={effective} venues={venues} onSave={onSave} onClose={onClose} />);
  return { user, onSave, onClose };
}

const start = () => screen.getByLabelText('Start time') as HTMLInputElement;
const end = () => screen.getByLabelText('End time') as HTMLInputElement;
const chip = (name: string) => screen.queryByRole('button', { name });

describe('EditSlotSheet', () => {
  it('names the weekday in the title', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Tuesday: when and where' })).toBeInTheDocument();
  });

  it('fills the time inputs from the effective slot', () => {
    setup({ startMin: 19 * 60, endMin: 21 * 60 + 30 });
    expect(start().value).toBe('19:00');
    expect(end().value).toBe('21:30');
  });

  it('leaves the time inputs empty when no time is set', () => {
    setup();
    expect(start().value).toBe('');
    expect(end().value).toBe('');
  });

  it('picks one venue at a time and clears it when tapped again', async () => {
    const { user } = setup({ venue: 'Hall A' });
    expect(chip('Hall A')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Hall B')).toHaveAttribute('aria-pressed', 'false');
    await user.click(chip('Hall B')!);
    expect(chip('Hall A')).toHaveAttribute('aria-pressed', 'false');
    expect(chip('Hall B')).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip('Hall B')!);
    expect(chip('Hall B')).toHaveAttribute('aria-pressed', 'false');
  });

  it('adds a new venue, selects it and shows it as a chip', async () => {
    const { user, onSave } = setup();
    await user.type(screen.getByLabelText('New venue'), 'Court Club');
    await user.click(screen.getByRole('button', { name: 'Add venue' }));
    expect(chip('Court Club')).toHaveAttribute('aria-pressed', 'true');
    expect(useSlotsStore.getState().venues).toContain('Court Club');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ startMin: undefined, endMin: undefined, venue: 'Court Club' }, 'this-time');
  });

  it('adds a venue with Enter', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('New venue'), 'Park{enter}');
    expect(chip('Park')).toHaveAttribute('aria-pressed', 'true');
  });

  it('ignores an empty venue name', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Add venue' }));
    expect(useSlotsStore.getState().venues).toEqual(['Hall A', 'Hall B']);
  });

  it('does not select or show a 13th venue, and keeps the choice it had', async () => {
    const full = Array.from({ length: MAX_VENUES }, (_, i) => `Venue ${i + 1}`);
    const { user } = setup({ venue: 'Venue 2' }, full);
    await user.type(screen.getByLabelText('New venue'), 'One too many');
    await user.click(screen.getByRole('button', { name: 'Add venue' }));
    expect(chip('One too many')).toBeNull();
    expect(chip('Venue 2')).toHaveAttribute('aria-pressed', 'true');
    expect(useSlotsStore.getState().venues).toHaveLength(MAX_VENUES);
  });

  it('defaults the scope to just this time', () => {
    setup();
    expect(screen.getByRole('radio', { name: 'Just this time' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Always for Tuesday' })).not.toBeChecked();
  });

  it('saves for this time with the chosen times and venue', async () => {
    const { user, onSave } = setup({ venue: 'Hall A' });
    await user.type(start(), '19:00');
    await user.type(end(), '21:00');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ startMin: 1140, endMin: 1260, venue: 'Hall A' }, 'this-time');
  });

  it('saves for always when that scope is chosen', async () => {
    const { user, onSave } = setup({ startMin: 600 });
    await user.click(screen.getByRole('radio', { name: 'Always for Tuesday' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ startMin: 600, endMin: undefined, venue: undefined }, 'always');
  });

  it('saves cleared times as undefined', async () => {
    const { user, onSave } = setup({ startMin: 1140, endMin: 1260 });
    await user.clear(start());
    await user.clear(end());
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ startMin: undefined, endMin: undefined, venue: undefined }, 'this-time');
  });

  it('rejects an end that is not after the start', async () => {
    const { user, onSave } = setup({ startMin: 1260, endMin: 1140 });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('End time must be after the start.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects an end equal to the start', async () => {
    const { user, onSave } = setup({ startMin: 1140, endMin: 1140 });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('allows an end with no start', async () => {
    const { user, onSave } = setup({ endMin: 1140 });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('closes from the close button and from Escape', async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/EditSlotSheet.test.tsx`
Expected: the file fails to load because `./EditSlotSheet` does not exist.

- [ ] **Step 3: Write the code**

Create `src/ui/EditSlotSheet.tsx`:

```tsx
import { useState } from 'react';
import { useSlotsStore, type Slot } from '../store/slots';
import { Sheet } from './Sheet';
import { WEEKDAY_NAMES } from './weekdays';

export type SlotScope = 'this-time' | 'always';
export type SlotPatch = Partial<Pick<Slot, 'startMin' | 'endMin' | 'venue'>>;

interface Props {
  slot: Slot;
  /** The slot with this-time-only edits laid over it. The form starts from these values. */
  effective: Slot;
  venues: string[];
  onSave: (patch: SlotPatch, scope: SlotScope) => void;
  onClose: () => void;
}

const toInput = (min?: number) => (min === undefined ? '' : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`);

function fromInput(value: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

/** Edits a slot's time and venue, for this time only or for every week. */
export function EditSlotSheet({ slot, effective, venues, onSave, onClose }: Props) {
  const day = WEEKDAY_NAMES[slot.weekday];
  const addVenue = useSlotsStore((s) => s.addVenue);
  const [start, setStart] = useState(toInput(effective.startMin));
  const [end, setEnd] = useState(toInput(effective.endMin));
  const [venue, setVenue] = useState<string | undefined>(effective.venue);
  const [newVenue, setNewVenue] = useState('');
  const [scope, setScope] = useState<SlotScope>('this-time');
  const [error, setError] = useState<string | null>(null);

  // A venue that is chosen always shows, even if the list the sheet was given does not have it yet.
  const chips = venue !== undefined && !venues.includes(venue) ? [...venues, venue] : venues;

  function add() {
    const name = addVenue(newVenue);
    // An empty name means nothing was added (blank, or the list is full), so the choice stays as it was.
    if (!name) return;
    setVenue(name);
    setNewVenue('');
  }

  function save() {
    const startMin = fromInput(start);
    const endMin = fromInput(end);
    if (startMin !== undefined && endMin !== undefined && endMin <= startMin) {
      setError('End time must be after the start.');
      return;
    }
    setError(null);
    onSave({ startMin, endMin, venue }, scope);
  }

  return (
    <Sheet title={`${day}: when and where`} onClose={onClose}>
      <div className="time-row">
        <label className="stack slot-field">
          <span className="muted">Start time</span>
          <input className="field" type="time" aria-label="Start time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="stack slot-field">
          <span className="muted">End time</span>
          <input className="field" type="time" aria-label="End time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>

      <div className="stack">
        <h3 className="section-title">Venue</h3>
        {chips.length > 0 && (
          <div className="options">
            {chips.map((v) => (
              <button
                key={v}
                type="button"
                className={`btn venue-chip${venue === v ? ' is-on' : ''}`}
                aria-pressed={venue === v}
                onClick={() => setVenue(venue === v ? undefined : v)}
              >
                {v}
              </button>
            ))}
          </div>
        )}
        <div className="row-flex">
          <input
            className="field"
            type="text"
            aria-label="New venue"
            placeholder="+ New venue"
            maxLength={40}
            autoComplete="off"
            value={newVenue}
            onChange={(e) => setNewVenue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className="btn" onClick={add}>
            Add venue
          </button>
        </div>
      </div>

      <div className="options" role="radiogroup" aria-label="Apply to">
        <label className="option">
          <input type="radio" name="slot-scope" checked={scope === 'this-time'} onChange={() => setScope('this-time')} />
          <span>Just this time</span>
        </label>
        <label className="option">
          <input type="radio" name="slot-scope" checked={scope === 'always'} onChange={() => setScope('always')} />
          <span>Always for {day}</span>
        </label>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn btn-primary btn-block" onClick={save}>
        Save
      </button>
    </Sheet>
  );
}
```

Create `src/ui/weekdays.ts`:

```ts
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
```

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/styles/app.css`:

```diff
diff --git a/src/styles/app.css b/src/styles/app.css
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -1700 +1700,7 @@ caption {
 .saved-att { font-size: 0.8125rem; }
+
+/* Home and the slot sheet */
+.time-row { display: flex; gap: 12px; }
+.slot-field { flex: 1; min-width: 0; gap: 4px; }
+.venue-chip { border-radius: 999px; }
+.venue-chip.is-on { background: var(--ink); color: var(--bg); border-color: var(--ink); }
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/EditSlotSheet.test.tsx`
Expected: all 16 tests pass.

Then run `npx tsc --noEmit && npx vitest run`.
Expected: `tsc` prints nothing and the suite shows 963 tests across 96 files.

- [ ] **Step 5: Commit**

```bash
git add src/styles/app.css src/ui/EditSlotSheet.test.tsx src/ui/EditSlotSheet.tsx src/ui/weekdays.ts
git commit -m "Add the sheet that edits a session slot's time and venue"
```

### Task 4: The Home screen with the club's session slots

Today's slot, or the next weekday that has one, is the big card. The others are small cards. Any slot can start on any day.

**Files:**
- Modify: `src/styles/app.css`
- Create: `src/ui/HomeScreen.test.tsx`
- Create: `src/ui/HomeScreen.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/HomeScreen.test.tsx`:

```tsx
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newTestSession } from '../engine/testing';
import type { HistoryEntry } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { DEFAULT_SLOTS, SLOTS_KEY, timestampAt, useSlotsStore } from '../store/slots';
import { HomeScreen } from './HomeScreen';

// Saturday 7 Nov 2026, noon.
const NOW = new Date(2026, 10, 7, 12).getTime();

function resetSlots(slots = DEFAULT_SLOTS.slots) {
  useSlotsStore.setState({ slots: slots.map((s) => ({ ...s })), venues: [], tonight: {} });
}

beforeEach(() => {
  localStorage.clear();
  resetSlots();
  useHistoryStore.setState({ entries: [], loaded: true, persistent: true });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const onStart = vi.fn();
  const onHistory = vi.fn();
  const user = userEvent.setup({ advanceTimers: () => {} });
  render(<HomeScreen onStart={onStart} onHistory={onHistory} />);
  return { user, onStart, onHistory };
}

const card = (day: string) => screen.getByRole('heading', { name: new RegExp(`^${day}`) }).closest('section')!;

describe('HomeScreen cards', () => {
  it('makes today the big card and the other slots small cards', () => {
    setup();
    expect(screen.getByRole('heading', { level: 2, name: 'Saturday open play' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Tuesday' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Thursday' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'Saturday' })).not.toBeInTheDocument();
  });

  it('makes the next weekday with a slot the big card when today has none', () => {
    vi.setSystemTime(new Date(2026, 10, 9, 12)); // Monday
    setup();
    expect(screen.getByRole('heading', { level: 2, name: 'Tuesday open play' })).toBeInTheDocument();
    expect(within(card('Tuesday')).getByText('Tuesday')).toBeInTheDocument();
    expect(within(card('Tuesday')).queryByText('Today')).not.toBeInTheDocument();
  });

  it('labels today as Today', () => {
    setup();
    expect(within(card('Saturday')).getByText('Today')).toBeInTheDocument();
  });

  it('asks for a time and a venue when none is set', () => {
    setup();
    expect(within(card('Saturday')).getByText('Add a time')).toBeInTheDocument();
    expect(within(card('Saturday')).getByText('Add a venue')).toBeInTheDocument();
    expect(within(card('Tuesday')).getByText('Add a time')).toBeInTheDocument();
    expect(within(card('Tuesday')).getByText('Add a venue')).toBeInTheDocument();
  });

  it('shows the time and venue when they are set', () => {
    resetSlots([
      { id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Hall A' },
      { id: 'sat', weekday: 6, startMin: 540, endMin: 660, venue: 'Park' },
    ]);
    setup();
    expect(within(card('Saturday')).getByText('9:00 to 11:00 am')).toBeInTheDocument();
    expect(within(card('Saturday')).getByText('Park')).toBeInTheDocument();
    expect(within(card('Tuesday')).getByText('7:00 to 9:00 pm')).toBeInTheDocument();
    expect(within(card('Tuesday')).getByText('Hall A')).toBeInTheDocument();
    expect(screen.queryByText('Add a time')).not.toBeInTheDocument();
  });

  it('shows the this time only tag when tonight overrides a slot', () => {
    useSlotsStore.setState({ tonight: { thu: { venue: 'Elsewhere' } } });
    setup();
    expect(within(card('Thursday')).getByText('This time only')).toBeInTheDocument();
    expect(within(card('Thursday')).getByText('Elsewhere')).toBeInTheDocument();
    expect(within(card('Tuesday')).queryByText('This time only')).not.toBeInTheDocument();
    expect(within(card('Saturday')).queryByText('This time only')).not.toBeInTheDocument();
  });
});

describe('HomeScreen editing', () => {
  async function editSaturday(user: ReturnType<typeof userEvent.setup>, scope: 'always' | 'this-time') {
    await user.click(screen.getByRole('button', { name: 'Edit Saturday' }));
    await user.type(screen.getByLabelText('Start time'), '09:00');
    await user.type(screen.getByLabelText('End time'), '11:00');
    await user.type(screen.getByLabelText('New venue'), 'Park{enter}');
    if (scope === 'always') await user.click(screen.getByRole('radio', { name: 'Always for Saturday' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
  }

  it('opens the sheet for that card and closes it', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Edit Thursday' }));
    expect(screen.getByRole('heading', { name: 'Thursday: when and where' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('saves for always: the card updates and the slot is stored', async () => {
    const { user } = setup();
    await editSaturday(user, 'always');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(card('Saturday')).getByText('9:00 to 11:00 am')).toBeInTheDocument();
    expect(within(card('Saturday')).getByText('Park')).toBeInTheDocument();
    expect(within(card('Saturday')).queryByText('This time only')).not.toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(SLOTS_KEY)!);
    expect(stored.slots.find((s: { id: string }) => s.id === 'sat')).toMatchObject({ startMin: 540, endMin: 660, venue: 'Park' });
  });

  it('saves for this time: the card updates, shows the tag, and the slot is not stored', async () => {
    const { user } = setup();
    await editSaturday(user, 'this-time');
    expect(within(card('Saturday')).getByText('9:00 to 11:00 am')).toBeInTheDocument();
    expect(within(card('Saturday')).getByText('This time only')).toBeInTheDocument();
    expect(useSlotsStore.getState().slots.find((s) => s.id === 'sat')).toEqual({ id: 'sat', weekday: 6 });
    const stored = JSON.parse(localStorage.getItem(SLOTS_KEY) ?? '{"slots":[]}');
    expect(stored.slots.find((s: { id: string }) => s.id === 'sat')).not.toHaveProperty('startMin');
  });

  it('drops the this time only tag when the same slot is saved for always', async () => {
    const { user } = setup();
    await editSaturday(user, 'this-time');
    await user.click(screen.getByRole('button', { name: 'Edit Saturday' }));
    await user.click(screen.getByRole('radio', { name: 'Always for Saturday' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(within(card('Saturday')).queryByText('This time only')).not.toBeInTheDocument();
    expect(within(card('Saturday')).getByText('Park')).toBeInTheDocument();
  });
});

describe('HomeScreen starting', () => {
  it('starts the big card with its slot and weekday only when nothing is set', async () => {
    const { user, onStart } = setup();
    await user.click(screen.getByRole('button', { name: 'Start Saturday session' }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith({ slotId: 'sat', weekday: 6 });
  });

  it('starts a small card with its own slot, on any day', async () => {
    const { user, onStart } = setup();
    await user.click(screen.getByRole('button', { name: 'Start Thursday session' }));
    expect(onStart).toHaveBeenCalledWith({ slotId: 'thu', weekday: 4 });
  });

  it('carries the venue and a planned end made from the end time', async () => {
    resetSlots([
      { id: 'sat', weekday: 6, startMin: 540, endMin: 660, venue: 'Park' },
      { id: 'thu', weekday: 4, startMin: 600, venue: 'Hall A' },
    ]);
    const { user, onStart } = setup();
    await user.click(screen.getByRole('button', { name: 'Start Saturday session' }));
    expect(onStart).toHaveBeenLastCalledWith({ slotId: 'sat', weekday: 6, venue: 'Park', plannedEndAt: timestampAt(660, NOW) });
    await user.click(screen.getByRole('button', { name: 'Start Thursday session' }));
    expect(onStart).toHaveBeenLastCalledWith({ slotId: 'thu', weekday: 4, venue: 'Hall A' });
    expect(onStart.mock.calls[1][0]).not.toHaveProperty('plannedEndAt');
  });

  it('lets this time only values win over the slot', async () => {
    resetSlots([{ id: 'sat', weekday: 6, endMin: 660, venue: 'Park' }]);
    useSlotsStore.setState({ tonight: { sat: { endMin: 1260, venue: 'Hall A' } } });
    const { user, onStart } = setup();
    await user.click(screen.getByRole('button', { name: 'Start Saturday session' }));
    expect(onStart).toHaveBeenCalledWith({ slotId: 'sat', weekday: 6, venue: 'Hall A', plannedEndAt: timestampAt(1260, NOW) });
  });

  it('leaves the planned end out when this time only clears the end', async () => {
    resetSlots([{ id: 'sat', weekday: 6, endMin: 660 }]);
    useSlotsStore.setState({ tonight: { sat: { endMin: undefined } } });
    const { user, onStart } = setup();
    await user.click(screen.getByRole('button', { name: 'Start Saturday session' }));
    expect(onStart.mock.calls[0][0]).not.toHaveProperty('plannedEndAt');
  });

  it('starts a one-off session with no plan', async () => {
    const { user, onStart } = setup();
    await user.click(screen.getByRole('button', { name: 'Start a one-off session' }));
    expect(onStart).toHaveBeenCalledWith(undefined);
  });
});

describe('HomeScreen history and settings', () => {
  const entry = (endedAt: number, games: number): HistoryEntry => ({
    id: `e${endedAt}`,
    name: 'Open play',
    createdAt: endedAt - 1000,
    endedAt,
    games,
    session: newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }),
  });

  it('shows no last session line and no Past sessions button without history', () => {
    setup();
    expect(screen.queryByText(/^Last:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Past sessions' })).not.toBeInTheDocument();
  });

  it('shows the newest session and opens Past sessions when history exists', async () => {
    useHistoryStore.setState({ entries: [entry(new Date(2026, 10, 4, 21).getTime(), 7), entry(new Date(2026, 10, 1, 21).getTime(), 3)] });
    const { user, onHistory } = setup();
    expect(screen.getByText('Last: Wed 4 Nov, 7 games')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Past sessions' }));
    expect(onHistory).toHaveBeenCalledTimes(1);
  });

  it('says game, not games, for one game', () => {
    useHistoryStore.setState({ entries: [entry(new Date(2026, 10, 4, 21).getTime(), 1)] });
    setup();
    expect(screen.getByText('Last: Wed 4 Nov, 1 game')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/HomeScreen.test.tsx`
Expected: the file fails to load because `./HomeScreen` does not exist.

- [ ] **Step 3: Write the code**

Create `src/ui/HomeScreen.tsx`:

```tsx
import { useState } from 'react';
import { shortDate } from '../store/attendance';
import { useHistoryStore } from '../store/historyStore';
import { effectiveSlot, formatRange, nextSlot, timestampAt, useSlotsStore, type Slot } from '../store/slots';
import { EditSlotSheet, type SlotPatch, type SlotScope } from './EditSlotSheet';
import { WEEKDAY_NAMES } from './weekdays';

/** What Setup needs to start a session from a slot. */
export interface SessionPlan {
  slotId: string;
  weekday: number;
  venue?: string;
  plannedEndAt?: number;
}

interface Props {
  onStart: (plan: SessionPlan | undefined) => void;
  onHistory: () => void;
}

export function HomeScreen({ onStart, onHistory }: Props) {
  const slots = useSlotsStore((s) => s.slots);
  const venues = useSlotsStore((s) => s.venues);
  const tonight = useSlotsStore((s) => s.tonight);
  const saveSlot = useSlotsStore((s) => s.saveSlot);
  const setTonight = useSlotsStore((s) => s.setTonight);
  const clearTonight = useSlotsStore((s) => s.clearTonight);
  const last = useHistoryStore((s) => s.entries[0]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const now = new Date();
  const big = nextSlot(slots, now);
  const others = slots.filter((s) => s.id !== big?.id);
  const editing = slots.find((s) => s.id === editingId);

  function start(slot: Slot) {
    const eff = effectiveSlot(slot, tonight);
    const plan: SessionPlan = { slotId: slot.id, weekday: slot.weekday };
    if (eff.venue !== undefined) plan.venue = eff.venue;
    if (eff.endMin !== undefined) plan.plannedEndAt = timestampAt(eff.endMin, Date.now());
    onStart(plan);
  }

  function save(patch: SlotPatch, scope: SlotScope) {
    if (!editing) return;
    if (scope === 'always') {
      saveSlot(editing.id, patch);
      // The saved values now hold for good, so a this-time-only copy would only hide them.
      clearTonight(editing.id);
    } else {
      setTonight(editing.id, patch);
    }
    setEditingId(null);
  }

  function renderCard(slot: Slot, isBig: boolean) {
    const eff = effectiveSlot(slot, tonight);
    const day = WEEKDAY_NAMES[slot.weekday];
    const label = slot.weekday === now.getDay() ? 'Today' : day;
    return (
      <section key={slot.id} className={`card stack slot-card${isBig ? ' slot-big' : ''}`}>
        <div className="row-flex spread">
          {isBig ? <span className="slot-label muted">{label}</span> : <h3 className="section-title">{day}</h3>}
          {tonight[slot.id] && <span className="tag">This time only</span>}
        </div>
        {isBig && <h2 className="slot-title">{day} open play</h2>}
        <p className={eff.startMin === undefined && eff.endMin === undefined ? 'muted' : undefined}>{formatRange(eff.startMin, eff.endMin)}</p>
        <p className={eff.venue === undefined ? 'muted' : undefined}>{eff.venue ?? 'Add a venue'}</p>
        <div className="row-flex">
          <button type="button" className="btn" aria-label={`Edit ${day}`} onClick={() => setEditingId(slot.id)}>
            Edit
          </button>
          <button
            type="button"
            className={`btn btn-start${isBig ? ' btn-primary' : ''}`}
            aria-label={isBig ? undefined : `Start ${day} session`}
            onClick={() => start(slot)}
          >
            {isBig ? `Start ${day} session` : 'Start'}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="stack">
      {big && renderCard(big, true)}
      {others.map((s) => renderCard(s, false))}

      <button type="button" className="btn btn-ghost" onClick={() => onStart(undefined)}>
        Start a one-off session
      </button>

      {last && (
        <div className="row-flex spread">
          <p className="muted">
            Last: {shortDate(last.endedAt)}, {last.games} {last.games === 1 ? 'game' : 'games'}
          </p>
          <button type="button" className="btn" onClick={onHistory}>
            Past sessions
          </button>
        </div>
      )}

      {editing && (
        <EditSlotSheet slot={editing} effective={effectiveSlot(editing, tonight)} venues={venues} onSave={save} onClose={() => setEditingId(null)} />
      )}
    </div>
  );
}
```

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/styles/app.css`:

```diff
diff --git a/src/styles/app.css b/src/styles/app.css
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -1706 +1706,5 @@ caption {
 .venue-chip.is-on { background: var(--ink); color: var(--bg); border-color: var(--ink); }
+.slot-label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
+.slot-title { font-size: 24px; font-weight: 700; overflow-wrap: anywhere; }
+.slot-card .row-flex { flex-wrap: wrap; }
+.slot-card .btn-start { flex: 1; }
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/HomeScreen.test.tsx`
Expected: all 19 tests pass.

Then run `npx tsc --noEmit && npx vitest run`.
Expected: `tsc` prints nothing and the suite shows 982 tests across 97 files.

- [ ] **Step 5: Commit**

```bash
git add src/styles/app.css src/ui/HomeScreen.test.tsx src/ui/HomeScreen.tsx
git commit -m "Add the Home screen with the club's session slots"
```

### Task 5: Land on Home and start a session from a slot (wiring)

Home becomes the first screen when no session is running. Starting from a slot opens Who's playing with the slot's name, venue and end time, and the "{weekday} regulars" shortcut uses the slot's weekday, not today's. A running session still opens on the live screen. Because Home is now the landing view, 18 existing test files assumed Who's playing was the first screen. Sixteen now start through one small helper, `renderAtSetup`, that opens a one-off session; two (`settings.test.tsx` and `syncUi.test.tsx`) click "Start a one-off session" themselves. Two of the sixteen (`App.test.tsx` and `sessionPrefs.test.tsx`) also click it after "Start new session", because the app now lands on Home. Their behaviour checks do not change.

**Files:**
- Modify: `src/styles/app.css`
- Create: `src/test/renderAtSetup.tsx`
- Modify: `src/ui/App.test.tsx`
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/SetupScreen.tsx`
- Modify: `src/ui/addPlayerButton.test.tsx`
- Modify: `src/ui/controlActions.test.tsx`
- Modify: `src/ui/finishWithResult.test.tsx`
- Create: `src/ui/homeWiring.test.tsx`
- Modify: `src/ui/liveScreen.test.tsx`
- Modify: `src/ui/managePlayers.test.tsx`
- Modify: `src/ui/oneUndo.test.tsx`
- Modify: `src/ui/photos.test.tsx`
- Modify: `src/ui/readyStep.test.tsx`
- Modify: `src/ui/regulars.test.tsx`
- Modify: `src/ui/savedPlayers.test.tsx`
- Modify: `src/ui/sessionConflict.test.tsx`
- Modify: `src/ui/sessionPrefs.test.tsx`
- Modify: `src/ui/settings.test.tsx`
- Modify: `src/ui/setupScreen.test.tsx`
- Modify: `src/ui/syncUi.test.tsx`
- Modify: `src/ui/waitingSheetTop.test.tsx`
- Modify: `src/ui/whyWaiting.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/test/renderAtSetup.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import App from '../ui/App';

/** Renders the app and, when it lands on Home, opens Who's playing as a one-off session. */
export function renderAtSetup() {
  const result = render(<App />);
  const oneOff = screen.queryByRole('button', { name: 'Start a one-off session' });
  if (oneOff) fireEvent.click(oneOff);
  return result;
}
```

Create `src/ui/homeWiring.test.tsx`:

```tsx
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newTestSession } from '../engine/testing';
import { resetHistoryDbForTests } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { DEFAULT_SLOTS, timestampAt, useSlotsStore } from '../store/slots';
import { pastSession, seed } from '../test/historyFixtures';
import App from './App';
import { SetupScreen } from './SetupScreen';
import { setDefaultMode } from './matchmaking';

// Friday 13 Nov 2026, noon. The Thursday slot is not today.
const FRIDAY = new Date(2026, 10, 13, 12);

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('pickleball.autoStart', 'true');
  setDefaultMode('fairness');
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useSlotsStore.setState({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {} });
  await resetRosterDbForTests();
  await resetHistoryDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
  useHistoryStore.setState({ entries: [], loaded: false, persistent: true });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FRIDAY);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const setup = () => userEvent.setup({ advanceTimers: () => {} });
const four = 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}';
const box = () => screen.getByLabelText('Search or add players');
const click = (user: ReturnType<typeof setup>, name: string | RegExp) => user.click(screen.getByRole('button', { name }));

describe('Home is the landing screen', () => {
  it('shows Home first, with no Who’s playing form', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Start a one-off session' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Saturday open play' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Who’s playing?' })).not.toBeInTheDocument();
  });

  it('opens Who’s playing from a slot, named for that slot’s weekday', async () => {
    const user = setup();
    render(<App />);
    await click(user, 'Start Thursday session');
    expect(screen.getByRole('heading', { level: 1, name: 'Who’s playing?' })).toBeInTheDocument();
    await user.type(box(), four);
    await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
    expect(useSessionStore.getState().session!.name).toBe('Thursday open play');
  });

  it('shows the slot’s venue and time under the title', async () => {
    useSlotsStore.setState({ slots: [{ id: 'thu', weekday: 4, startMin: 1140, endMin: 1260, venue: 'Hall A' }] });
    const user = setup();
    render(<App />);
    await click(user, 'Start Thursday session');
    expect(screen.getByText('Hall A · 7:00 to 9:00 pm')).toBeInTheDocument();
  });

  it('stores the venue and planned end on the session', async () => {
    useSlotsStore.setState({ slots: [{ id: 'thu', weekday: 4, startMin: 1140, endMin: 1260, venue: 'Hall A' }] });
    const user = setup();
    render(<App />);
    await click(user, 'Start Thursday session');
    await user.type(box(), four);
    await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
    const s = useSessionStore.getState().session!;
    expect(s.venue).toBe('Hall A');
    expect(s.plannedEndAt).toBe(timestampAt(1260, FRIDAY.getTime()));
  });

  it('uses this time only values for the session and then forgets them', async () => {
    useSlotsStore.setState({ slots: [{ id: 'thu', weekday: 4, venue: 'Hall A' }], tonight: { thu: { venue: 'Park' } } });
    const user = setup();
    render(<App />);
    await click(user, 'Start Thursday session');
    await user.type(box(), four);
    await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
    expect(useSessionStore.getState().session!.venue).toBe('Park');
    expect(useSlotsStore.getState().tonight).toEqual({});
  });

  it('leaves venue and planned end off a one-off session', async () => {
    const user = setup();
    render(<App />);
    await click(user, 'Start a one-off session');
    await user.type(box(), four);
    await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
    const s = useSessionStore.getState().session!;
    expect(s.name).toBe('Friday open play');
    expect(s).not.toHaveProperty('venue');
    expect(s).not.toHaveProperty('plannedEndAt');
  });

  it('uses the slot’s weekday for the regulars shortcut, not today’s', async () => {
    const group = ['Ann', 'Ben', 'Cy', 'Dee'];
    const ids = await seed(group);
    await pastSession(group, ids, 2026, 10, 5); // Thursdays
    await pastSession(group, ids, 2026, 10, 12);
    const user = setup();
    render(<App />);
    await click(user, 'Start Thursday session');
    expect(await screen.findByRole('button', { name: 'Thursday regulars (4)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Friday regulars/ })).not.toBeInTheDocument();
  });

  it('goes back to Home from Who’s playing', async () => {
    const user = setup();
    render(<App />);
    await click(user, 'Start Thursday session');
    await click(user, 'Back');
    expect(screen.getByRole('button', { name: 'Start a one-off session' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Who’s playing?' })).not.toBeInTheDocument();
  });

  it('shows Back on a one-off session’s Who’s playing too', async () => {
    const user = setup();
    render(<App />);
    await click(user, 'Start a one-off session');
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('returns to Home from Settings opened on Home', async () => {
    const user = setup();
    render(<App />);
    await click(user, 'Settings');
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    await click(user, 'Back');
    expect(screen.getByRole('button', { name: 'Start a one-off session' })).toBeInTheDocument();
  });

  it('returns to Who’s playing from Settings opened there, keeping the form', async () => {
    const user = setup();
    render(<App />);
    await click(user, 'Start a one-off session');
    await user.type(box(), 'Ann{enter}');
    await screen.findByRole('checkbox', { name: 'Ann' });
    await click(user, /^Settings/);
    await click(user, 'Back');
    expect(screen.getByRole('heading', { name: 'Who’s playing?' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Ann' })).toBeChecked();
  });

  it('returns to Home from Past sessions opened on Home', async () => {
    const group = ['Ann', 'Ben', 'Cy', 'Dee'];
    const ids = await seed(group);
    await pastSession(group, ids, 2026, 10, 5);
    const user = setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Past sessions' }));
    expect(screen.getByRole('heading', { name: 'Past sessions' })).toBeInTheDocument();
    await click(user, 'Back');
    expect(screen.getByRole('button', { name: 'Start a one-off session' })).toBeInTheDocument();
  });

  it('lands on Home after Start new session on the summary', async () => {
    const ended = { ...newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }), endedAt: Date.now() };
    useSessionStore.setState({ session: ended });
    const user = setup();
    render(<App />);
    await click(user, 'Start new session');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start a one-off session' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Who’s playing?' })).not.toBeInTheDocument();
  });

  it('lands on Home after Start new session even if Who’s playing was open before', async () => {
    const user = setup();
    render(<App />);
    await click(user, 'Start a one-off session');
    await user.type(box(), four);
    await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
    act(() => useSessionStore.setState((st) => ({ session: { ...st.session!, endedAt: Date.now() } })));
    await user.click(await screen.findByRole('button', { name: 'Start new session' }));
    expect(await screen.findByRole('button', { name: 'Start a one-off session' })).toBeInTheDocument();
  });
});

describe('SetupScreen props', () => {
  it('has no Back button unless it is given one', () => {
    render(<SetupScreen onManage={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('calls onBack from the Back button', async () => {
    const onBack = vi.fn();
    const user = setup();
    render(<SetupScreen onManage={() => {}} onBack={onBack} />);
    await click(user, 'Back');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows only the venue when the plan has a venue but no time', () => {
    render(<SetupScreen onManage={() => {}} plan={{ slotId: 'x', weekday: 2, venue: 'Park' }} />);
    expect(screen.getByText('Park')).toBeInTheDocument();
  });

  it('shows the planned end when the slot is not known', () => {
    render(<SetupScreen onManage={() => {}} plan={{ slotId: 'x', weekday: 2, plannedEndAt: timestampAt(1260, FRIDAY.getTime()) }} />);
    expect(screen.getByText('Until 9:00 pm')).toBeInTheDocument();
  });

  it('shows no line under the title when the plan has nothing to say', () => {
    render(<SetupScreen onManage={() => {}} plan={{ slotId: 'x', weekday: 2 }} />);
    expect(document.querySelector('.setup-plan')).toBeNull();
  });
});
```

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/ui/App.test.tsx`, `src/ui/addPlayerButton.test.tsx`, `src/ui/controlActions.test.tsx`, `src/ui/finishWithResult.test.tsx`, `src/ui/liveScreen.test.tsx`, `src/ui/managePlayers.test.tsx`, `src/ui/oneUndo.test.tsx`, `src/ui/photos.test.tsx`, `src/ui/readyStep.test.tsx`, `src/ui/regulars.test.tsx`, `src/ui/savedPlayers.test.tsx`, `src/ui/sessionConflict.test.tsx`, `src/ui/sessionPrefs.test.tsx`, `src/ui/settings.test.tsx`, `src/ui/setupScreen.test.tsx`, `src/ui/syncUi.test.tsx`, `src/ui/waitingSheetTop.test.tsx`, `src/ui/whyWaiting.test.tsx`:

```diff
diff --git a/src/ui/App.test.tsx b/src/ui/App.test.tsx
--- a/src/ui/App.test.tsx
+++ b/src/ui/App.test.tsx
@@ -7,3 +7,3 @@ import { useUpdateStore } from '../pwa';
 import { useSessionStore } from '../store/sessionStore';
-import App from './App';
+import { renderAtSetup } from '../test/renderAtSetup';
 import { ErrorBoundary } from './ErrorBoundary';
@@ -34,3 +34,3 @@ async function addPlayers(user: User, text: string) {
 async function startFivePlayerSession(user: User) {
-  render(<App />);
+  renderAtSetup();
   await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}Eve');
@@ -58,3 +58,3 @@ describe('App', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     expect(screen.getByRole('button', { name: 'Pick at least 4' })).toBeDisabled();
@@ -177,2 +177,3 @@ describe('App', () => {
     await user.click(await screen.findByRole('button', { name: 'Start new session' }));
+    await user.click(await screen.findByRole('button', { name: 'Start a one-off session' }));
 
@@ -206,2 +207,3 @@ describe('App', () => {
     await user.click(screen.getByRole('button', { name: 'Start new session' }));
+    await user.click(await screen.findByRole('button', { name: 'Start a one-off session' }));
     await user.click(await screen.findByRole('button', { name: /^Same as last time/ }));
@@ -212,3 +214,3 @@ describe('App', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await user.type(screen.getByLabelText('Search or add players'), 'Ann{enter}Ben{enter}Cy{enter}Fri');
@@ -224,3 +226,3 @@ describe('App', () => {
     const user = userEvent.setup();
-    const { unmount } = render(<App />);
+    const { unmount } = renderAtSetup();
     expect(screen.queryByText(/A new version is ready/)).not.toBeInTheDocument();
@@ -230,3 +232,3 @@ describe('App', () => {
     useUpdateStore.setState({ ready: true, apply });
-    render(<App />);
+    renderAtSetup();
     const notice = screen.getByText(/A new version is ready\./);
@@ -241,3 +243,3 @@ describe('App', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await user.click(screen.getByRole('button', { name: /^Settings/ }));
@@ -255,3 +257,3 @@ describe('App', () => {
   it('has a PIKLMatch title bar with the account button, and no theme button there', () => {
-    render(<App />);
+    renderAtSetup();
     const bar = document.querySelector<HTMLElement>('.app-header')!;
@@ -265,3 +267,3 @@ describe('App', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee');
@@ -284,3 +286,3 @@ describe('App', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await addPlayers(user, 'Ann{enter}ann');
@@ -293,3 +295,3 @@ describe('App', () => {
     async function openSavedPlayers(user: User) {
-      render(<App />);
+      renderAtSetup();
       await addPlayers(user, 'Ann{enter}Ben');
diff --git a/src/ui/addPlayerButton.test.tsx b/src/ui/addPlayerButton.test.tsx
--- a/src/ui/addPlayerButton.test.tsx
+++ b/src/ui/addPlayerButton.test.tsx
@@ -1,2 +1,2 @@
-import { render, screen, within } from '@testing-library/react';
+import { screen, within } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
@@ -6,3 +6,3 @@ import { useRosterStore } from '../store/rosterStore';
 import { useSessionStore } from '../store/sessionStore';
-import App from './App';
+import { renderAtSetup } from '../test/renderAtSetup';
 
@@ -27,3 +27,3 @@ const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.from
 async function startSession(user: User, list: string) {
-  render(<App />);
+  renderAtSetup();
   await user.type(screen.getByLabelText('Search or add players'), list);
diff --git a/src/ui/controlActions.test.tsx b/src/ui/controlActions.test.tsx
--- a/src/ui/controlActions.test.tsx
+++ b/src/ui/controlActions.test.tsx
@@ -1,2 +1,2 @@
-import { render, screen, waitFor, within } from '@testing-library/react';
+import { screen, waitFor, within } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
@@ -6,3 +6,3 @@ import { useRosterStore } from '../store/rosterStore';
 import { useSessionStore } from '../store/sessionStore';
-import App from './App';
+import { renderAtSetup } from '../test/renderAtSetup';
 
@@ -22,3 +22,3 @@ const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.from
 async function startSession(user: User, count: number) {
-  render(<App />);
+  renderAtSetup();
   await user.type(screen.getByLabelText('Search or add players'), names(count));
diff --git a/src/ui/finishWithResult.test.tsx b/src/ui/finishWithResult.test.tsx
--- a/src/ui/finishWithResult.test.tsx
+++ b/src/ui/finishWithResult.test.tsx
@@ -1,2 +1,2 @@
-import { render, screen, within } from '@testing-library/react';
+import { screen, within } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
@@ -6,3 +6,3 @@ import { useRosterStore } from '../store/rosterStore';
 import { useSessionStore } from '../store/sessionStore';
-import App from './App';
+import { renderAtSetup } from '../test/renderAtSetup';
 
@@ -23,3 +23,3 @@ const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.from
 async function startSession(user: User, count = 5) {
-  render(<App />);
+  renderAtSetup();
   await user.type(screen.getByLabelText('Search or add players'), names(count));
diff --git a/src/ui/liveScreen.test.tsx b/src/ui/liveScreen.test.tsx
--- a/src/ui/liveScreen.test.tsx
+++ b/src/ui/liveScreen.test.tsx
@@ -1,2 +1,2 @@
-import { act, fireEvent, render, screen, within } from '@testing-library/react';
+import { act, fireEvent, screen, within } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
@@ -9,3 +9,3 @@ import { useUpdateStore } from '../pwa';
 import { useSessionStore } from '../store/sessionStore';
-import App from './App';
+import { renderAtSetup } from '../test/renderAtSetup';
 
@@ -27,3 +27,3 @@ afterEach(() => {
 async function startSession(user: User, names: string) {
-  render(<App />);
+  renderAtSetup();
   await user.type(screen.getByLabelText('Search or add players'), names);
@@ -194,3 +194,3 @@ describe('the top bar', () => {
   it('brings the title bar back outside a live session', async () => {
-    render(<App />);
+    renderAtSetup();
     expect(screen.getByText('PIKLMatch')).toBeInTheDocument();
diff --git a/src/ui/managePlayers.test.tsx b/src/ui/managePlayers.test.tsx
--- a/src/ui/managePlayers.test.tsx
+++ b/src/ui/managePlayers.test.tsx
@@ -1,2 +1,2 @@
-import { render, screen } from '@testing-library/react';
+import { screen } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
@@ -6,3 +6,3 @@ import { useRosterStore } from '../store/rosterStore';
 import { useSessionStore } from '../store/sessionStore';
-import App from './App';
+import { renderAtSetup } from '../test/renderAtSetup';
 
@@ -24,3 +24,3 @@ describe('Manage players in Settings', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await settings(user);
@@ -36,3 +36,3 @@ describe('Manage players in Settings', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await user.type(screen.getByLabelText('Search or add players'), 'Ann{enter}');
@@ -45,3 +45,3 @@ describe('Manage players in Settings', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await user.type(screen.getByLabelText('Search or add players'), 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}');
@@ -59,3 +59,3 @@ describe('Manage players in Settings', () => {
     vi.spyOn(window, 'confirm').mockReturnValue(true);
-    render(<App />);
+    renderAtSetup();
     await user.type(screen.getByLabelText('Search or add players'), 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}');
diff --git a/src/ui/oneUndo.test.tsx b/src/ui/oneUndo.test.tsx
--- a/src/ui/oneUndo.test.tsx
+++ b/src/ui/oneUndo.test.tsx
@@ -1,2 +1,2 @@
-import { render, screen, waitFor, within } from '@testing-library/react';
+import { screen, waitFor, within } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
@@ -6,3 +6,3 @@ import { useRosterStore } from '../store/rosterStore';
 import { useSessionStore } from '../store/sessionStore';
-import App from './App';
+import { renderAtSetup } from '../test/renderAtSetup';
 
@@ -22,3 +22,3 @@ const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.from
 async function startSession(user: User, count: number) {
-  render(<App />);
+  renderAtSetup();
   await user.type(screen.getByLabelText('Search or add players'), names(count));
diff --git a/src/ui/photos.test.tsx b/src/ui/photos.test.tsx
--- a/src/ui/photos.test.tsx
+++ b/src/ui/photos.test.tsx
@@ -1,2 +1,2 @@
-import { act, render, screen, waitFor, within } from '@testing-library/react';
+import { act, screen, waitFor, within } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
@@ -8,3 +8,3 @@ import { useSessionStore } from '../store/sessionStore';
 import { useUpdateStore } from '../pwa';
-import App from './App';
+import { renderAtSetup } from '../test/renderAtSetup';
 
@@ -50,3 +50,3 @@ describe('photos in the app', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await addPlayers(user, 'Ann{enter}Ben');
@@ -71,3 +71,3 @@ describe('photos in the app', () => {
     await useRosterStore.getState().setPhoto(ann.id, processed);
-    render(<App />);
+    renderAtSetup();
     await user.click(await screen.findByRole('button', { name: 'Edit players' }));
@@ -84,3 +84,3 @@ describe('photos in the app', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}Eve');
@@ -101,3 +101,3 @@ describe('photos in the app', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee');
@@ -116,3 +116,3 @@ describe('photos in the app', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee');
@@ -132,3 +132,3 @@ describe('photos in the app', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}Eve');
@@ -149,3 +149,3 @@ describe('photos in the app', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}Eve');
@@ -166,3 +166,3 @@ describe('photos in the app', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee');
@@ -186,3 +186,3 @@ describe('photos in the app', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee');
diff --git a/src/ui/readyStep.test.tsx b/src/ui/readyStep.test.tsx
--- a/src/ui/readyStep.test.tsx
+++ b/src/ui/readyStep.test.tsx
@@ -1,2 +1,2 @@
-import { render, screen, waitFor, within } from '@testing-library/react';
+import { screen, waitFor, within } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
@@ -6,3 +6,3 @@ import { useRosterStore } from '../store/rosterStore';
 import { useSessionStore } from '../store/sessionStore';
-import App from './App';
+import { renderAtSetup } from '../test/renderAtSetup';
 
@@ -24,3 +24,3 @@ const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.from
 async function startSession(user: User, count: number) {
-  render(<App />);
+  renderAtSetup();
   await user.type(screen.getByLabelText('Search or add players'), names(count));
@@ -182,3 +182,3 @@ describe('Settings: Start the next game by itself', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await user.click(screen.getByRole('button', { name: /^Settings/ }));
diff --git a/src/ui/regulars.test.tsx b/src/ui/regulars.test.tsx
--- a/src/ui/regulars.test.tsx
+++ b/src/ui/regulars.test.tsx
@@ -1,2 +1,2 @@
-import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
+import { cleanup, screen, waitFor, within } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
@@ -9,3 +9,3 @@ import { useSessionStore } from '../store/sessionStore';
 import { pastSession, seed } from '../test/historyFixtures';
-import App from './App';
+import { renderAtSetup } from '../test/renderAtSetup';
 import { setDefaultMode } from './matchmaking';
@@ -36,3 +36,3 @@ describe('Saved players shows who comes', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await user.click(await screen.findByRole('button', { name: /edit players/i }));
@@ -47,3 +47,3 @@ describe('Setup puts regulars first', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await waitFor(() => expect(useHistoryStore.getState().loaded).toBe(true));
@@ -75,3 +75,3 @@ describe('Setup puts regulars first', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await openSettings(user);
@@ -93,3 +93,3 @@ describe('the weekday chip', () => {
     await pastSession(['Eve', 'Ann', 'Ben', 'Cy'], ids, 2026, 10, 12); // a Thursday
-    render(<App />);
+    renderAtSetup();
     const chip = await screen.findByRole('button', { name: 'Wednesday regulars (4)' });
@@ -107,3 +107,3 @@ describe('the weekday chip', () => {
     await pastSession(['Ann', 'Ben', 'Cy', 'Eve'], ids, 2026, 10, 11);
-    render(<App />);
+    renderAtSetup();
     await waitFor(() => expect(useHistoryStore.getState().loaded).toBe(true));
@@ -118,3 +118,3 @@ describe('the weekday chip', () => {
     await pastSession(group, ids, 2026, 10, 11);
-    render(<App />);
+    renderAtSetup();
     await waitFor(() => expect(useHistoryStore.getState().loaded).toBe(true));
diff --git a/src/ui/savedPlayers.test.tsx b/src/ui/savedPlayers.test.tsx
--- a/src/ui/savedPlayers.test.tsx
+++ b/src/ui/savedPlayers.test.tsx
@@ -1,2 +1,2 @@
-import { act, render, screen, waitFor, within } from '@testing-library/react';
+import { act, screen, waitFor, within } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
@@ -6,3 +6,3 @@ import { useRosterStore } from '../store/rosterStore';
 import { useSessionStore } from '../store/sessionStore';
-import App from './App';
+import { renderAtSetup } from '../test/renderAtSetup';
 
@@ -19,3 +19,3 @@ afterEach(() => {
 async function openSaved(user: ReturnType<typeof userEvent.setup>, names: string) {
-  render(<App />);
+  renderAtSetup();
   await user.type(screen.getByLabelText('Search or add players'), names);
@@ -89,3 +89,3 @@ describe('adding a player on Saved players', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await user.click(screen.getByRole('button', { name: /^Settings/ }));
diff --git a/src/ui/sessionConflict.test.tsx b/src/ui/sessionConflict.test.tsx
--- a/src/ui/sessionConflict.test.tsx
+++ b/src/ui/sessionConflict.test.tsx
@@ -1,2 +1,2 @@
-import { act, render, screen } from '@testing-library/react';
+import { act, screen } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
@@ -6,3 +6,3 @@ import { useRosterStore } from '../store/rosterStore';
 import { useSessionStore } from '../store/sessionStore';
-import App from './App';
+import { renderAtSetup } from '../test/renderAtSetup';
 
@@ -27,3 +27,3 @@ const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.from
 async function startSession(user: User, list: string) {
-  render(<App />);
+  renderAtSetup();
   await user.type(screen.getByLabelText('Search or add players'), list);
@@ -38,3 +38,3 @@ describe('a second window', () => {
   it('raises a notice when another window saves the session, and never by itself reloads', () => {
-    render(<App />);
+    renderAtSetup();
     expect(screen.queryByText(/changed in another window/)).not.toBeInTheDocument();
@@ -46,3 +46,3 @@ describe('a second window', () => {
   it('also notices the other window clearing storage, but not unrelated keys', () => {
-    const { unmount } = render(<App />);
+    const { unmount } = renderAtSetup();
     change({ key: 'pickleball.theme', newValue: 'dark' });
@@ -50,3 +50,3 @@ describe('a second window', () => {
     unmount();
-    render(<App />);
+    renderAtSetup();
     change({ key: null });
diff --git a/src/ui/sessionPrefs.test.tsx b/src/ui/sessionPrefs.test.tsx
--- a/src/ui/sessionPrefs.test.tsx
+++ b/src/ui/sessionPrefs.test.tsx
@@ -1,2 +1,2 @@
-import { act, render, screen, waitFor } from '@testing-library/react';
+import { act, screen, waitFor } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
@@ -6,3 +6,3 @@ import { useRosterStore } from '../store/rosterStore';
 import { useSessionStore } from '../store/sessionStore';
-import App from './App';
+import { renderAtSetup } from '../test/renderAtSetup';
 
@@ -36,3 +36,3 @@ describe('the screen stays on during a session', () => {
     const { request, release } = stubWakeLock();
-    render(<App />);
+    renderAtSetup();
     await act(async () => {});
@@ -55,3 +55,3 @@ describe('the screen stays on during a session', () => {
     const { request } = stubWakeLock();
-    render(<App />);
+    renderAtSetup();
     await user.click(screen.getByRole('button', { name: /^Settings/ }));
@@ -73,3 +73,3 @@ describe('Settings, During a session', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await user.click(screen.getByRole('button', { name: /^Settings/ }));
@@ -88,3 +88,3 @@ describe('courts are remembered', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     expect(screen.getByRole('group', { name: 'Courts' })).toHaveTextContent('2');
@@ -97,2 +97,4 @@ describe('courts are remembered', () => {
     act(() => useSessionStore.getState().reset());
+    // Resetting lands on Home, so open Who's playing again.
+    await user.click(screen.getByRole('button', { name: 'Start a one-off session' }));
     expect(screen.getByRole('group', { name: 'Courts' })).toHaveTextContent('4');
@@ -102,3 +104,3 @@ describe('courts are remembered', () => {
     localStorage.setItem('pickleball.courts', 'lots');
-    render(<App />);
+    renderAtSetup();
     expect(screen.getByRole('group', { name: 'Courts' })).toHaveTextContent('2');
diff --git a/src/ui/settings.test.tsx b/src/ui/settings.test.tsx
--- a/src/ui/settings.test.tsx
+++ b/src/ui/settings.test.tsx
@@ -1,3 +1,3 @@
 import type { AuthError, Session } from '@supabase/supabase-js';
-import { act, cleanup, render, screen } from '@testing-library/react';
+import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
@@ -30,2 +30,4 @@ async function startApp(client: ReturnType<typeof fakeClient> | null) {
   render(<App />);
+  // These tests are about Who's playing, so they open it from Home first.
+  fireEvent.click(screen.getByRole('button', { name: 'Start a one-off session' }));
   return userEvent.setup();
diff --git a/src/ui/setupScreen.test.tsx b/src/ui/setupScreen.test.tsx
--- a/src/ui/setupScreen.test.tsx
+++ b/src/ui/setupScreen.test.tsx
@@ -1,2 +1,2 @@
-import { render, screen, waitFor, within } from '@testing-library/react';
+import { screen, waitFor, within } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
@@ -6,3 +6,3 @@ import { useRosterStore } from '../store/rosterStore';
 import { useSessionStore } from '../store/sessionStore';
-import App from './App';
+import { renderAtSetup } from '../test/renderAtSetup';
 import { getDefaultMode, setDefaultMode } from './matchmaking';
@@ -25,3 +25,3 @@ describe('the New session page', () => {
   it('asks who is playing first, with no name field, no cards and no matchmaking choice', () => {
-    render(<App />);
+    renderAtSetup();
     expect(screen.getByRole('heading', { level: 1, name: 'Who’s playing?' })).toBeInTheDocument();
@@ -35,3 +35,3 @@ describe('the New session page', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     expect(screen.getByText(/Add the people who play regularly/)).toBeInTheDocument();
@@ -48,3 +48,3 @@ describe('the New session page', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await user.type(box(), 'Ann{enter}');
@@ -58,3 +58,3 @@ describe('the New session page', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await user.click(box());
@@ -67,3 +67,3 @@ describe('the New session page', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await user.type(box(), '{enter}');
@@ -75,3 +75,3 @@ describe('the New session page', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await user.type(box(), 'Ann{enter}Ben{enter}Anna{enter}');
@@ -92,3 +92,3 @@ describe('the New session page', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await user.type(box(), 'Ann{enter}');
@@ -106,3 +106,3 @@ describe('the New session page', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await user.type(box(), four);
@@ -118,3 +118,3 @@ describe('the New session page', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await user.type(box(), 'Ann{enter}Ben{enter}');
@@ -129,3 +129,3 @@ describe('the New session page', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     const bar = document.querySelector<HTMLElement>('.start-bar')!;
@@ -148,3 +148,3 @@ describe('the New session page', () => {
     const user = userEvent.setup({ advanceTimers: () => {} });
-    render(<App />);
+    renderAtSetup();
     await user.type(box(), four);
@@ -160,3 +160,3 @@ describe('the New session page', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await user.type(box(), four);
@@ -175,3 +175,3 @@ describe('the New session page', () => {
     const user = userEvent.setup();
-    render(<App />);
+    renderAtSetup();
     await user.type(box(), four);
diff --git a/src/ui/syncUi.test.tsx b/src/ui/syncUi.test.tsx
--- a/src/ui/syncUi.test.tsx
+++ b/src/ui/syncUi.test.tsx
@@ -1,3 +1,3 @@
 import type { Session } from '@supabase/supabase-js';
-import { act, cleanup, render, screen, within } from '@testing-library/react';
+import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
@@ -36,2 +36,4 @@ async function startApp(options: { client: ReturnType<typeof fakeClient> | null
   render(<App />);
+  // These tests are about Who's playing, so they open it from Home first.
+  fireEvent.click(screen.getByRole('button', { name: 'Start a one-off session' }));
   return { user: userEvent.setup(), auth: useAuthStore, sync: useSyncStore, roster: useRosterStore };
diff --git a/src/ui/waitingSheetTop.test.tsx b/src/ui/waitingSheetTop.test.tsx
--- a/src/ui/waitingSheetTop.test.tsx
+++ b/src/ui/waitingSheetTop.test.tsx
@@ -1,2 +1,2 @@
-import { fireEvent, render, screen, within } from '@testing-library/react';
+import { fireEvent, screen, within } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
@@ -6,3 +6,3 @@ import { useRosterStore } from '../store/rosterStore';
 import { useSessionStore } from '../store/sessionStore';
-import App from './App';
+import { renderAtSetup } from '../test/renderAtSetup';
 
@@ -24,3 +24,3 @@ const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.from
 async function startSession(user: User, count: number) {
-  render(<App />);
+  renderAtSetup();
   await user.type(screen.getByLabelText('Search or add players'), names(count));
diff --git a/src/ui/whyWaiting.test.tsx b/src/ui/whyWaiting.test.tsx
--- a/src/ui/whyWaiting.test.tsx
+++ b/src/ui/whyWaiting.test.tsx
@@ -1,2 +1,2 @@
-import { render, screen, within } from '@testing-library/react';
+import { screen, within } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
@@ -6,3 +6,3 @@ import { useRosterStore } from '../store/rosterStore';
 import { useSessionStore } from '../store/sessionStore';
-import App from './App';
+import { renderAtSetup } from '../test/renderAtSetup';
 
@@ -27,3 +27,3 @@ const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.from
 async function startSession(user: User, list: string) {
-  render(<App />);
+  renderAtSetup();
   await user.type(screen.getByLabelText('Search or add players'), list);
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/homeWiring.test.tsx`
Expected: 17 tests fail and 2 pass. Home does not exist yet and Who's playing is still the landing view. The two that pass are SetupScreen props tests that the old screen happens to satisfy.

- [ ] **Step 3: Write the code**

Replace the whole of `src/ui/App.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { useRosterStore } from '../store/rosterStore';
import { useAuthStore } from '../sync/auth';
import { startSyncCoordinator } from '../sync/coordinator';
import { useUpdateStore } from '../pwa';
import { useHistoryStore } from '../store/historyStore';
import { useSessionStore } from '../store/sessionStore';
import { AccountButton } from './AccountButton';
import { ErrorBoundary } from './ErrorBoundary';
import { SignInBanner } from './SignInBanner';
import { HomeScreen, type SessionPlan } from './HomeScreen';
import { LiveScreen } from './LiveScreen';
import { PastSessionsScreen } from './PastSessionsScreen';
import { SavedPlayersScreen } from './SavedPlayersScreen';
import { SettingsScreen } from './SettingsScreen';
import { SetupScreen } from './SetupScreen';
import { SummaryScreen } from './SummaryScreen';
import { KEEP_AWAKE_KEY, useBoolPref } from './prefs';
import { useSessionConflict } from './useSessionConflict';
import { useWakeLock } from './useWakeLock';

export default function App() {
  const session = useSessionStore((s) => s.session);
  const saveFailed = useSessionStore((s) => s.saveFailed);
  const updateReady = useUpdateStore((s) => s.ready);
  const applyUpdate = useUpdateStore((s) => s.apply);
  const rosterPersistent = useRosterStore((s) => s.persistent);
  const rosterBlocked = useRosterStore((s) => s.blocked);
  const loadRoster = useRosterStore((s) => s.load);
  const loadHistory = useHistoryStore((s) => s.load);
  const initAuth = useAuthStore((s) => s.init);
  const [keepAwake] = useBoolPref(KEEP_AWAKE_KEY, true);
  const sessionConflict = useSessionConflict();
  const [view, setView] = useState<'home' | 'setup' | 'saved' | 'settings' | 'history'>('home');
  // Who's playing is opened from Home, with the slot's plan or none for a one-off session. It stays mounted
  // (hidden) while Saved players or Settings are open on top of it, so a half-filled form survives the trip.
  const [setupOpen, setSetupOpen] = useState(false);
  const [plan, setPlan] = useState<SessionPlan | undefined>(undefined);
  // Saved players can be opened from Setup or from Settings; Settings and Past sessions can be opened from Home
  // or Setup (Past sessions also from Settings). Back returns to whichever it came from.
  const [savedFrom, setSavedFrom] = useState<'setup' | 'settings'>('setup');
  const [settingsFrom, setSettingsFrom] = useState<'home' | 'setup'>('home');
  const [historyFrom, setHistoryFrom] = useState<'home' | 'settings'>('settings');
  const openSaved = (from: 'setup' | 'settings') => {
    setSavedFrom(from);
    setView('saved');
  };
  const openSettings = () => {
    setSettingsFrom(view === 'setup' || (view === 'saved' && savedFrom === 'setup') ? 'setup' : 'home');
    setView('settings');
  };
  const openHistory = (from: 'home' | 'settings') => {
    setHistoryFrom(from);
    setView('history');
  };
  const openSetup = (p: SessionPlan | undefined) => {
    setPlan(p);
    setSetupOpen(true);
    setView('setup');
  };

  // When the session goes away (Start new session), the app lands on Home with a clean Who's playing.
  const [hadSession, setHadSession] = useState(!!session);
  if (hadSession !== !!session) {
    setHadSession(!!session);
    if (!session) {
      setView('home');
      setSetupOpen(false);
      setPlan(undefined);
    }
  }

  useEffect(() => {
    // A failing roster load is already reflected by the store's `persistent` flag.
    loadRoster().catch(() => {});
  }, [loadRoster]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    void initAuth();
  }, [initAuth]);

  // The screen stays on for as long as a session is running, however many screens the organizer visits.
  useWakeLock(!!session && !session.endedAt && keepAwake);

  // Keeps saved players backed up while signed in. It does nothing without a backend or a signed-in organizer.
  useEffect(() => startSyncCoordinator(), []);

  const overlay =
    view === 'saved' ? (
      <SavedPlayersScreen onBack={() => setView(savedFrom)} />
    ) : view === 'settings' ? (
      <SettingsScreen onBack={() => setView(settingsFrom)} onManage={() => openSaved('settings')} onHistory={() => openHistory('settings')} />
    ) : view === 'history' ? (
      <PastSessionsScreen onBack={() => setView(historyFrom)} />
    ) : null;

  let screen;
  if (!session) {
    screen = (
      <>
        {setupOpen && (
          <div hidden={view !== 'setup'}>
            <SignInBanner onSignIn={openSettings} />
            <SetupScreen
              plan={plan}
              onBack={() => {
                setSetupOpen(false);
                setPlan(undefined);
                setView('home');
              }}
              onManage={() => openSaved('setup')}
            />
          </div>
        )}
        {view === 'home' && (
          <>
            <SignInBanner onSignIn={openSettings} />
            <HomeScreen onStart={openSetup} onHistory={() => openHistory('home')} />
          </>
        )}
        {overlay}
      </>
    );
  } else if (overlay) {
    screen = overlay;
  } else if (session.endedAt) {
    screen = <SummaryScreen session={session} />;
  } else {
    screen = <LiveScreen session={session} onSettings={openSettings} />;
  }

  // The live screen has its own slim top bar, so the app's title bar is left out to give the court the room.
  const live = !!session && !session.endedAt && !overlay;

  return (
    <div className="app">
      {!live && (
        <header className="app-header">
          <span className="app-title">PIKLMatch</span>
          {view !== 'settings' && view !== 'history' && <AccountButton onClick={openSettings} />}
        </header>
      )}
      {updateReady && (
        <p className="notice" role="status">
          A new version is ready.{' '}
          <button type="button" className="btn btn-small" onClick={() => applyUpdate?.()}>
            Reload now
          </button>
        </p>
      )}
      {saveFailed && (
        <p className="notice" role="alert">
          Not saved — this browser is blocking storage. The session still works, but a refresh will lose it.
        </p>
      )}
      {sessionConflict && (
        <p className="notice" role="status">
          This session was changed in another window.{' '}
          <button type="button" className="btn btn-small" onClick={() => window.location.reload()}>
            Reload
          </button>
        </p>
      )}
      {rosterBlocked && (
        <p className="notice" role="status">
          Close other tabs of this app to load your saved players.
        </p>
      )}
      {!rosterPersistent && (
        <p className="notice" role="status">
          Saved players can't be stored in this browser, so names will be forgotten when the app closes.
        </p>
      )}
      <main>
        <ErrorBoundary>{screen}</ErrorBoundary>
      </main>
    </div>
  );
}
```

Replace the whole of `src/ui/SetupScreen.tsx` with:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { attendanceByRoster, regularsForWeekday, sortByAttendance } from '../store/attendance';
import { useHistoryStore } from '../store/historyStore';
import { lastSessionIds } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { effectiveSlot, formatClock, formatRange, useSlotsStore } from '../store/slots';
import { getDefaultMode, useDefaultMode } from './matchmaking';
import { AUTO_START_KEY, COURTS_KEY, getBoolPref, getNumPref, REGULARS_FIRST_KEY, setNumPref, useBoolPref } from './prefs';
import type { SessionPlan } from './HomeScreen';
import { PlayerAvatar } from './PlayerAvatar';
import { WEEKDAY_NAMES } from './weekdays';

const MIN_PLAYERS = 4;
const MAX_COURTS = 12;

interface Props {
  onManage: () => void;
  /** The slot this session starts from. Without one it is a one-off session. */
  plan?: SessionPlan;
  /** Shows a Back button when given. */
  onBack?: () => void;
}

const norm = (name: string) => name.trim().toLowerCase();

/** "Saturday open play": enough to tell sessions apart without asking for a name. */
function defaultSessionName(weekday: number): string {
  return `${WEEKDAY_NAMES[weekday]} open play`;
}

export function SetupScreen({ onManage, plan, onBack }: Props) {
  const saved = useRosterStore((s) => s.players);
  const history = useHistoryStore((s) => s.entries);
  const [regularsFirst] = useBoolPref(REGULARS_FIRST_KEY, true);
  // The people who come most often go first, so the usual crowd is at the top of a long list.
  const roster = useMemo(() => (regularsFirst ? sortByAttendance(saved, attendanceByRoster(history)) : saved), [saved, history, regularsFirst]);
  const weekday = plan?.weekday ?? new Date().getDay();
  const slot = useSlotsStore((s) => s.slots.find((x) => x.id === plan?.slotId));
  const tonight = useSlotsStore((s) => s.tonight);
  const clearTonight = useSlotsStore((s) => s.clearTonight);
  const weekdayIds = useMemo(() => {
    const here = new Set(saved.map((p) => p.id));
    return regularsForWeekday(history, weekday).filter((id) => here.has(id));
  }, [saved, history, weekday]);
  const addToRoster = useRosterStore((s) => s.add);
  const start = useSessionStore((s) => s.start);
  const [mode] = useDefaultMode();

  // What the plan says about where and when, for the line under the title.
  const eff = slot ? effectiveSlot(slot, tonight) : undefined;
  const plannedEnd = plan?.plannedEndAt === undefined ? undefined : new Date(plan.plannedEndAt);
  const when =
    eff && (eff.startMin !== undefined || eff.endMin !== undefined)
      ? formatRange(eff.startMin, eff.endMin)
      : plannedEnd
        ? `Until ${formatClock(plannedEnd.getHours() * 60 + plannedEnd.getMinutes())}`
        : undefined;
  const planLine = [plan?.venue, when].filter(Boolean).join(' · ');

  const [courtCount, setCourtCount] = useState(() => getNumPref(COURTS_KEY, 2, 1, MAX_COURTS));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  // Adds run one after another, so typing on while a name is being saved cannot create doubles.
  const adding = useRef<Promise<void>>(Promise.resolve());

  // A start error belongs to the selection it was raised for.
  useEffect(() => {
    setStartError(null);
  }, [selected]);

  const lastIds = lastSessionIds(roster);
  const chosen = roster.filter((p) => selected.has(p.id));
  const canStart = chosen.length >= MIN_PLAYERS;
  const typed = query.trim();
  const exact = roster.find((p) => norm(p.name) === norm(typed));
  const shown = typed ? roster.filter((p) => norm(p.name).includes(norm(typed))) : roster;
  const canAdd = typed !== '' && !exact;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Saves each name and picks it. Names that already exist are just picked. */
  function addNames(names: string[]) {
    const lines = names.map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    adding.current = adding.current.then(async () => {
      const ids: string[] = [];
      let failure: string | null = null;
      for (const line of lines) {
        try {
          ids.push((await addToRoster(line)).id);
        } catch (e) {
          failure = e instanceof Error ? e.message : 'Could not add that player.';
        }
      }
      setSelected((prev) => new Set([...prev, ...ids]));
      setError(failure);
    });
  }

  function submitQuery() {
    if (!typed) return;
    // Enter picks the player the typing points at, or adds a new one.
    if (exact) setSelected((prev) => new Set(prev).add(exact.id));
    else addNames([typed]);
    setQuery('');
  }

  function startSession() {
    const res = start({
      name: defaultSessionName(weekday),
      mode: getDefaultMode(),
      courtCount,
      autoStart: getBoolPref(AUTO_START_KEY, false),
      players: chosen.map((p) => ({ name: p.name, rosterId: p.id })),
      venue: plan?.venue,
      plannedEndAt: plan?.plannedEndAt,
    });
    if (res.ok) {
      setNumPref(COURTS_KEY, courtCount);
      // The this-time-only edits were for this session, so they end with it.
      if (plan) clearTonight(plan.slotId);
    } else setStartError(res.error);
  }

  return (
    <div className="stack setup">
      {onBack && (
        <div>
          <button type="button" className="btn" onClick={onBack}>
            Back
          </button>
        </div>
      )}
      <div className="setup-head">
        <h1 className="screen-title">Who’s playing?</h1>
        <span className="setup-count" aria-live="polite">
          {chosen.length} selected
        </span>
      </div>
      {planLine && <p className="muted setup-plan">{planLine}</p>}

      <input
        className="field"
        type="text"
        aria-label="Search or add players"
        placeholder={roster.length > 0 ? 'Search or add a name' : 'Add a name, then press Enter'}
        autoComplete="off"
        enterKeyHint="done"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitQuery();
          }
        }}
        onPaste={(e) => {
          // A pasted list becomes one player per line.
          const text = e.clipboardData.getData('text');
          if (!text.includes('\n')) return;
          e.preventDefault();
          addNames(text.split('\n'));
          setQuery('');
        }}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {roster.length === 0 && <p className="muted setup-note">Add the people who play regularly. They are saved for next time.</p>}
      {mode === 'queue' && <p className="muted setup-note">Simple queue matchmaking. Change it in Settings.</p>}

      {roster.length > 0 && (
        <div className="quick">
          {lastIds.length > 0 && (
            <button type="button" className="btn btn-small" onClick={() => setSelected(new Set(lastIds))}>
              Same as last time ({lastIds.length})
            </button>
          )}
          {weekdayIds.length >= MIN_PLAYERS && (
            <button type="button" className="btn btn-small" onClick={() => setSelected(new Set(weekdayIds))}>
              {WEEKDAY_NAMES[weekday]} regulars ({weekdayIds.length})
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setSelected(new Set(roster.map((p) => p.id)))}>
            Select all
          </button>
          {selected.size > 0 && (
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          )}
        </div>
      )}

      {(shown.length > 0 || canAdd) && (
        <ul className="pick-grid" aria-label="Saved players">
          {canAdd && (
            <li>
              <button type="button" className="pick pick-add" onClick={submitQuery}>
                + Add “{typed}”
              </button>
            </li>
          )}
          {shown.map((p) => (
            <li key={p.id}>
              <label className="pick">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                <PlayerAvatar name={p.name} rosterId={p.id} size="sm" />
                <span className="row-name">{p.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {typed !== '' && shown.length === 0 && !canAdd && <p className="muted">No one matches.</p>}

      {roster.length > 0 && (
        <button type="button" className="btn btn-ghost btn-small edit-players" onClick={onManage}>
          Edit players
        </button>
      )}

      <div className="sticky-bar start-bar">
        <div className="start-row">
          <div className="stepper stepper-sm" role="group" aria-label="Courts">
            <button
              type="button"
              className="btn"
              aria-label="Fewer courts"
              disabled={courtCount <= 1}
              onClick={() => setCourtCount((c) => c - 1)}
            >
              −
            </button>
            <output aria-live="polite" aria-label="Courts">
              <span className="stepper-value">{courtCount}</span>
              <span className="stepper-caption">{courtCount === 1 ? 'court' : 'courts'}</span>
            </output>
            <button
              type="button"
              className="btn"
              aria-label="More courts"
              disabled={courtCount >= MAX_COURTS}
              onClick={() => setCourtCount((c) => c + 1)}
            >
              +
            </button>
          </div>
          <button
            type="button"
            className={`btn btn-block start-btn${canStart ? ' btn-live' : ''}`}
            disabled={!canStart}
            onClick={startSession}
          >
            {canStart ? `Start ${chosen.length} players` : `Pick at least ${MIN_PLAYERS}`}
          </button>
        </div>
        {startError && (
          <p className="error" role="alert">
            {startError}
          </p>
        )}
      </div>
    </div>
  );
}
```

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/styles/app.css`:

```diff
diff --git a/src/styles/app.css b/src/styles/app.css
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -1710 +1710,2 @@ caption {
 .slot-card .btn-start { flex: 1; }
+.setup-plan { margin-top: -12px; }
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/homeWiring.test.tsx src/ui/App.test.tsx src/ui/setupScreen.test.tsx`
Expected: all pass. Then the full suite below must pass too: it runs the 18 changed test files.

Then run `npx tsc --noEmit && npx vitest run`.
Expected: `tsc` prints nothing and the suite shows 1001 tests across 98 files.

- [ ] **Step 5: Commit**

```bash
git add src/styles/app.css src/test/renderAtSetup.tsx src/ui/App.test.tsx src/ui/App.tsx src/ui/SetupScreen.tsx src/ui/addPlayerButton.test.tsx src/ui/controlActions.test.tsx src/ui/finishWithResult.test.tsx src/ui/homeWiring.test.tsx src/ui/liveScreen.test.tsx src/ui/managePlayers.test.tsx src/ui/oneUndo.test.tsx src/ui/photos.test.tsx src/ui/readyStep.test.tsx src/ui/regulars.test.tsx src/ui/savedPlayers.test.tsx src/ui/sessionConflict.test.tsx src/ui/sessionPrefs.test.tsx src/ui/settings.test.tsx src/ui/setupScreen.test.tsx src/ui/syncUi.test.tsx src/ui/waitingSheetTop.test.tsx src/ui/whyWaiting.test.tsx
git commit -m "Land on Home and start a session from a slot"
```

### Task 6: Let the organizer extend a running session

When a session has a planned end, the live header shows "Ends 9:00 pm". Tapping it offers +15 min, +30 min and +1 hour. Extending changes only that session's end. Nothing ends a session by itself. Undo restores the old end.

**Files:**
- Modify: `src/styles/app.css`
- Create: `src/ui/ExtendSheet.test.tsx`
- Create: `src/ui/ExtendSheet.tsx`
- Modify: `src/ui/LiveScreen.tsx`
- Modify: `src/ui/liveScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/ExtendSheet.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endSession } from '../engine';
import { makeCtx, newTestSession } from '../engine/testing';
import { useSessionStore } from '../store/sessionStore';
import { ExtendSheet } from './ExtendSheet';

const END = new Date(2026, 10, 10, 21, 0).getTime();
const plannedEnd = () => useSessionStore.getState().session?.plannedEndAt;

beforeEach(() => {
  localStorage.clear();
  const session = { ...newTestSession(['A', 'B', 'C', 'D']), plannedEndAt: END };
  useSessionStore.setState({ session, undoStack: [], saveFailed: false, lastAction: null });
});

describe('ExtendSheet', () => {
  it('is a sheet called Extend the session with three choices', () => {
    render(<ExtendSheet onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Extend the session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+15 min' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+30 min' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+1 hour' })).toBeInTheDocument();
  });

  it.each([
    ['+15 min', 15, 'Extended by 15 minutes'],
    ['+30 min', 30, 'Extended by 30 minutes'],
    ['+1 hour', 60, 'Extended by 1 hour'],
  ])('%s moves the end by exactly that long, labels it and closes', async (name, minutes, label) => {
    const onClose = vi.fn();
    render(<ExtendSheet onClose={onClose} />);
    await userEvent.setup().click(screen.getByRole('button', { name }));
    expect(plannedEnd()).toBe(END + minutes * 60_000);
    expect(useSessionStore.getState().lastAction?.label).toBe(label);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('can be undone back to the old end', async () => {
    render(<ExtendSheet onClose={() => {}} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '+30 min' }));
    act(() => useSessionStore.getState().undo());
    expect(plannedEnd()).toBe(END);
  });

  it('closes on Escape and changes nothing', async () => {
    const onClose = vi.fn();
    render(<ExtendSheet onClose={onClose} />);
    await userEvent.setup().keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(plannedEnd()).toBe(END);
    expect(useSessionStore.getState().undoStack).toHaveLength(0);
  });

  it('shows the reason as an alert and stays open when the session cannot be extended', async () => {
    const session = useSessionStore.getState().session!;
    useSessionStore.setState({ session: endSession(session, makeCtx()) });
    const onClose = vi.fn();
    render(<ExtendSheet onClose={onClose} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '+15 min' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/ended/i);
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/ui/liveScreen.test.tsx`:

```diff
diff --git a/src/ui/liveScreen.test.tsx b/src/ui/liveScreen.test.tsx
--- a/src/ui/liveScreen.test.tsx
+++ b/src/ui/liveScreen.test.tsx
@@ -356 +356,56 @@ describe('the waiting sheet', () => {
 });
+
+describe('extending the session', () => {
+  const END = new Date(2026, 10, 10, 21, 0).getTime();
+  const setEnd = (plannedEndAt?: number) =>
+    act(() => useSessionStore.setState({ session: { ...useSessionStore.getState().session!, plannedEndAt } }));
+  const plannedEnd = () => useSessionStore.getState().session?.plannedEndAt;
+  const chip = () => screen.queryByRole('button', { name: /extend the session/i });
+
+  it('shows no chip when the session has no planned end', async () => {
+    await startSession(userEvent.setup(), FIVE);
+    expect(chip()).not.toBeInTheDocument();
+  });
+
+  it('shows the planned end as a chip that says what tapping does', async () => {
+    await startSession(userEvent.setup(), FIVE);
+    setEnd(END);
+    expect(chip()).toHaveTextContent('Ends 9:00 pm');
+    expect(screen.getByRole('button', { name: 'Ends 9:00 pm, extend the session' })).toBeInTheDocument();
+  });
+
+  it('shows no chip once the session has ended', async () => {
+    await startSession(userEvent.setup(), FIVE);
+    setEnd(END);
+    expect(chip()).toBeInTheDocument();
+    act(() => useSessionStore.setState({ session: { ...useSessionStore.getState().session!, endedAt: END } }));
+    expect(chip()).not.toBeInTheDocument();
+  });
+
+  it('opens the sheet, extends, updates the chip and offers Undo', async () => {
+    const user = userEvent.setup();
+    await startSession(user, FIVE);
+    setEnd(END);
+    await user.click(chip()!);
+    expect(screen.getByRole('dialog', { name: 'Extend the session' })).toBeInTheDocument();
+    await user.click(screen.getByRole('button', { name: '+30 min' }));
+    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
+    expect(plannedEnd()).toBe(END + 30 * 60_000);
+    expect(chip()).toHaveTextContent('Ends 9:30 pm');
+    expect(screen.getByRole('status')).toHaveTextContent('Extended by 30 minutes');
+    await user.click(screen.getByRole('button', { name: 'Undo' }));
+    expect(plannedEnd()).toBe(END);
+    expect(chip()).toHaveTextContent('Ends 9:00 pm');
+  });
+
+  it('closes the sheet on Escape without changing the end', async () => {
+    const user = userEvent.setup();
+    await startSession(user, FIVE);
+    setEnd(END);
+    await user.click(chip()!);
+    expect(screen.getByRole('dialog', { name: 'Extend the session' })).toBeInTheDocument();
+    await user.keyboard('{Escape}');
+    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
+    expect(plannedEnd()).toBe(END);
+  });
+});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/ExtendSheet.test.tsx src/ui/liveScreen.test.tsx`
Expected: `ExtendSheet.test.tsx` fails to load, and 4 tests in `liveScreen.test.tsx` fail because there is no chip. The tests that only check for absence pass before the code; they are guards.

- [ ] **Step 3: Write the code**

Create `src/ui/ExtendSheet.tsx`:

```tsx
import { useState } from 'react';
import { extendSession } from '../engine';
import { useSessionStore } from '../store/sessionStore';
import { Sheet } from './Sheet';

const CHOICES = [
  { label: '+15 min', minutes: 15, said: '15 minutes' },
  { label: '+30 min', minutes: 30, said: '30 minutes' },
  { label: '+1 hour', minutes: 60, said: '1 hour' },
];

/** Moves the planned end of the running session later, with a way back through Undo. */
export function ExtendSheet({ onClose }: { onClose: () => void }) {
  const apply = useSessionStore((s) => s.apply);
  const [error, setError] = useState<string | null>(null);

  function extend(minutes: number, said: string) {
    const res = apply((s, ctx) => extendSession(s, minutes, ctx), `Extended by ${said}`);
    if (res.ok) onClose();
    else setError(res.error);
  }

  return (
    <Sheet title="Extend the session" onClose={onClose}>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="stack">
        {CHOICES.map((c) => (
          <button key={c.label} type="button" className="btn btn-block" onClick={() => extend(c.minutes, c.said)}>
            {c.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
```

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/styles/app.css`, `src/ui/LiveScreen.tsx`:

```diff
diff --git a/src/styles/app.css b/src/styles/app.css
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -1711 +1711,4 @@ caption {
 .setup-plan { margin-top: -12px; }
+
+/* The planned end in the live header */
+.end-chip { padding: 4px 12px; font-size: 13px; font-weight: 600; white-space: nowrap; }
diff --git a/src/ui/LiveScreen.tsx b/src/ui/LiveScreen.tsx
--- a/src/ui/LiveScreen.tsx
+++ b/src/ui/LiveScreen.tsx
@@ -4,2 +4,3 @@ import type { GameResult, Session } from '../engine';
 import { useRosterStore } from '../store/rosterStore';
+import { formatClock } from '../store/slots';
 import { useSessionStore, type SessionAction } from '../store/sessionStore';
@@ -9,2 +10,3 @@ import { CourtCard } from './CourtCard';
 import { CourtTabs } from './CourtTabs';
+import { ExtendSheet } from './ExtendSheet';
 import { LiveMenu } from './LiveMenu';
@@ -17,2 +19,7 @@ import { WaitingSheet } from './WaitingSheet';
 
+function clockOf(ms: number): string {
+  const d = new Date(ms);
+  return formatClock(d.getHours() * 60 + d.getMinutes());
+}
+
 export function LiveScreen({ session, onSettings }: { session: Session; onSettings: () => void }) {
@@ -29,2 +36,3 @@ export function LiveScreen({ session, onSettings }: { session: Session; onSettin
   const [adding, setAdding] = useState(false);
+  const [extending, setExtending] = useState(false);
   /** The court whose Game finished button was pressed, while the result sheet is open. */
@@ -90,2 +98,4 @@ export function LiveScreen({ session, onSettings }: { session: Session; onSettin
 
+  // The planned end as a local clock time, while the session is still running.
+  const endsAt = session.plannedEndAt !== undefined && session.endedAt === undefined ? clockOf(session.plannedEndAt) : null;
   const sorted = [...session.courts].sort((a, b) => a.number - b.number);
@@ -123,2 +133,7 @@ export function LiveScreen({ session, onSettings }: { session: Session; onSettin
         <div className="live-actions">
+          {endsAt !== null && (
+            <button type="button" className="chip end-chip" aria-label={`Ends ${endsAt}, extend the session`} onClick={() => setExtending(true)}>
+              Ends {endsAt}
+            </button>
+          )}
           <LiveMenu
@@ -196,2 +211,3 @@ export function LiveScreen({ session, onSettings }: { session: Session; onSettin
       )}
+      {extending && <ExtendSheet onClose={() => setExtending(false)} />}
       {adding && <AddPlayerSheet session={session} onClose={() => setAdding(false)} />}
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/ExtendSheet.test.tsx src/ui/liveScreen.test.tsx`
Expected: both files pass.

Then run `npx tsc --noEmit && npx vitest run`.
Expected: `tsc` prints nothing and the suite shows 1013 tests across 99 files.

- [ ] **Step 5: Commit**

```bash
git add src/styles/app.css src/ui/ExtendSheet.test.tsx src/ui/ExtendSheet.tsx src/ui/LiveScreen.tsx src/ui/liveScreen.test.tsx
git commit -m "Let the organizer extend a running session"
```

### Task 7: Show the venue on the summary, Past sessions and the picture

The venue is part of what the session was, so it follows the session: a muted line under the name on the summary, after the date in a Past sessions row, and after the date on the shared picture. Nothing changes when there is no venue.

**Files:**
- Modify: `src/test/historyFixtures.ts`
- Modify: `src/ui/PastSessionsScreen.tsx`
- Modify: `src/ui/SummaryScreen.tsx`
- Modify: `src/ui/cardDraw.test.ts`
- Modify: `src/ui/cardDraw.ts`
- Modify: `src/ui/cardModel.test.ts`
- Modify: `src/ui/cardModel.ts`
- Modify: `src/ui/pastSessions.test.tsx`
- Modify: `src/ui/summaryScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/test/historyFixtures.ts`, `src/ui/cardDraw.test.ts`, `src/ui/cardModel.test.ts`, `src/ui/pastSessions.test.tsx`, `src/ui/summaryScreen.test.tsx`:

```diff
diff --git a/src/test/historyFixtures.ts b/src/test/historyFixtures.ts
--- a/src/test/historyFixtures.ts
+++ b/src/test/historyFixtures.ts
@@ -6,6 +6,6 @@ import { addRosterPlayer } from '../store/rosterDb';
 /** A finished session of saved players, on the day given (month is 0-based). */
-export async function pastSession(names: string[], roster: Map<string, string>, y: number, m: number, d: number, name = 'Open play') {
+export async function pastSession(names: string[], roster: Map<string, string>, y: number, m: number, d: number, name = 'Open play', venue?: string) {
   const ctx = makeCtx(1, new Date(y, m, d, 18).getTime());
   let s = newTestSession(names, { courts: 1 }, ctx);
-  s = { ...s, id: `past-${y}-${m}-${d}-${name}`, name, players: s.players.map((p) => ({ ...p, rosterId: roster.get(p.name) })) };
+  s = { ...s, id: `past-${y}-${m}-${d}-${name}`, name, ...(venue ? { venue } : {}), players: s.players.map((p) => ({ ...p, rosterId: roster.get(p.name) })) };
   s = finishGame(s, s.courts[0].id, { ...ctx, now: ctx.now + 600_000 });
diff --git a/src/ui/cardDraw.test.ts b/src/ui/cardDraw.test.ts
--- a/src/ui/cardDraw.test.ts
+++ b/src/ui/cardDraw.test.ts
@@ -65,2 +65,24 @@ describe('drawCard', () => {
 
+  it('writes the venue after the day when there is one', () => {
+    const { ctx, calls } = recorder();
+    drawCard(ctx, model([ann], { venue: 'Tacloban Sports Hall' }), new Map());
+    expect(texts(calls)).toContain('Wed 4 Nov · Tacloban Sports Hall · 12 games · 3h 5m');
+  });
+
+  it('writes the day line exactly as before when there is no venue', () => {
+    const { ctx, calls } = recorder();
+    drawCard(ctx, model([ann]), new Map());
+    const dayLine = texts(calls).filter((t) => t.startsWith('Wed 4 Nov'));
+    expect(dayLine).toEqual(['Wed 4 Nov · 12 games · 3h 5m']);
+  });
+
+  it('cuts a venue that is too long for the width with an ellipsis', () => {
+    const { ctx, calls } = recorder();
+    drawCard(ctx, model([ann], { venue: 'The Very Long Name Sports And Recreation Complex '.repeat(4).trim() }), new Map());
+    const dayLine = texts(calls).find((t) => t.startsWith('Wed 4 Nov'))!;
+    expect(dayLine.endsWith('…')).toBe(true);
+    expect(dayLine.length * 10).toBeLessThanOrEqual(CARD_WIDTH - 72 * 2);
+    expect(dayLine).toContain('The Very Long');
+  });
+
   it('uses the dark colours for a dark card', () => {
diff --git a/src/ui/cardModel.test.ts b/src/ui/cardModel.test.ts
--- a/src/ui/cardModel.test.ts
+++ b/src/ui/cardModel.test.ts
@@ -21,2 +21,12 @@ describe('buildCardModel', () => {
 
+  it('carries the venue, trimmed, when the session has one', () => {
+    const m = buildCardModel({ ...played(), venue: '  Tacloban Sports Hall ' }, { results: false, theme: 'light' });
+    expect(m.venue).toBe('Tacloban Sports Hall');
+  });
+
+  it('leaves the venue out when there is none or it is blank', () => {
+    expect('venue' in buildCardModel(played(), { results: false, theme: 'light' })).toBe(false);
+    expect('venue' in buildCardModel({ ...played(), venue: '   ' }, { results: false, theme: 'light' })).toBe(false);
+  });
+
   it('lists every player, most games first, with their games', () => {
diff --git a/src/ui/pastSessions.test.tsx b/src/ui/pastSessions.test.tsx
--- a/src/ui/pastSessions.test.tsx
+++ b/src/ui/pastSessions.test.tsx
@@ -61,2 +61,25 @@ describe('Past sessions', () => {
 
+describe('Past sessions venue', () => {
+  async function openList(user: ReturnType<typeof userEvent.setup>) {
+    render(<App />);
+    await openSettings(user);
+    await user.click(screen.getByRole('button', { name: 'Past sessions' }));
+    return within(await screen.findByRole('list', { name: 'Past sessions' })).getAllByRole('button');
+  }
+
+  it('puts the venue between the date and the games when one is set', async () => {
+    const names = ['Ann', 'Ben', 'Cy', 'Dee', 'Eve'];
+    await pastSession(names, await seed(names), 2026, 10, 4, 'Hall night', 'Tacloban Sports Hall');
+    const rows = await openList(userEvent.setup());
+    expect(rows[0]).toHaveTextContent('Wed 4 Nov · Tacloban Sports Hall · 1 game · 5 players');
+  });
+
+  it('leaves the row as it was when there is no venue', async () => {
+    const names = ['Ann', 'Ben', 'Cy', 'Dee', 'Eve'];
+    await pastSession(names, await seed(names), 2026, 10, 4, 'Plain night');
+    const rows = await openList(userEvent.setup());
+    expect(rows[0]).toHaveTextContent(/^Plain nightWed 4 Nov · 1 game · 5 players$/);
+  });
+});
+
 describe('ending a session keeps it', () => {
diff --git a/src/ui/summaryScreen.test.tsx b/src/ui/summaryScreen.test.tsx
--- a/src/ui/summaryScreen.test.tsx
+++ b/src/ui/summaryScreen.test.tsx
@@ -31,2 +31,17 @@ function finished(games = 1) {
 
+describe('summary venue', () => {
+  it('shows the venue as a muted line under the session name when set', () => {
+    render(<SummaryScreen session={{ ...finished(1), venue: 'Tacloban Sports Hall' }} />);
+    const venue = document.querySelector('.sum-venue')!;
+    expect(venue).toHaveTextContent('Tacloban Sports Hall');
+    expect(venue).toHaveClass('muted');
+    expect(venue.previousElementSibling).toHaveTextContent('Test');
+  });
+
+  it('shows no venue line when there is none', () => {
+    render(<SummaryScreen session={finished(1)} />);
+    expect(document.querySelector('.sum-venue')).toBeNull();
+  });
+});
+
 describe('summary highlights', () => {
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/summaryScreen.test.tsx src/ui/pastSessions.test.tsx src/ui/cardModel.test.ts src/ui/cardDraw.test.ts`
Expected: five tests fail (the card model keeps the venue, the card draws it and cuts a long one, the summary shows it, a Past sessions row shows it). The "no venue" tests pass before the code; they guard the old behaviour.

- [ ] **Step 3: Write the code**

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/ui/PastSessionsScreen.tsx`, `src/ui/SummaryScreen.tsx`, `src/ui/cardDraw.ts`, `src/ui/cardModel.ts`:

```diff
diff --git a/src/ui/PastSessionsScreen.tsx b/src/ui/PastSessionsScreen.tsx
--- a/src/ui/PastSessionsScreen.tsx
+++ b/src/ui/PastSessionsScreen.tsx
@@ -32,3 +32,3 @@ export function PastSessionsScreen({ onBack }: { onBack: () => void }) {
                 <span className="muted">
-                  {shortDate(e.endedAt)} · {e.games} {e.games === 1 ? 'game' : 'games'} · {e.session.players.length} players
+                  {shortDate(e.endedAt)} · {e.session.venue ? `${e.session.venue} · ` : ''}{e.games} {e.games === 1 ? 'game' : 'games'} · {e.session.players.length} players
                 </span>
diff --git a/src/ui/SummaryScreen.tsx b/src/ui/SummaryScreen.tsx
--- a/src/ui/SummaryScreen.tsx
+++ b/src/ui/SummaryScreen.tsx
@@ -147,2 +147,3 @@ export function SummaryScreen({ session, onBack }: { session: Session; onBack?:
           <p className="muted">{session.name}</p>
+          {session.venue && <p className="muted sum-venue">{session.venue}</p>}
           {line && <p className="sum-line">{line}</p>}
diff --git a/src/ui/cardDraw.ts b/src/ui/cardDraw.ts
--- a/src/ui/cardDraw.ts
+++ b/src/ui/cardDraw.ts
@@ -112,3 +112,6 @@ export function drawCard(ctx: DrawingContext, model: CardModel, photos: CardPhot
   drawTitle(ctx, model.title, palette, 170);
-  write(ctx, `${model.date} · ${model.facts}`, MARGIN, 236, 38, 500, palette.muted);
+  // The venue sits right after the day; a long one is cut like the title.
+  ctx.font = `500 38px ${FONT}`;
+  const dayLine = [model.date, model.venue, model.facts].filter(Boolean).join(' · ');
+  write(ctx, fit(ctx, dayLine, CONTENT_WIDTH), MARGIN, 236, 38, 500, palette.muted);
 
diff --git a/src/ui/cardModel.ts b/src/ui/cardModel.ts
--- a/src/ui/cardModel.ts
+++ b/src/ui/cardModel.ts
@@ -39,2 +39,4 @@ export interface CardModel {
   date: string;
+  /** Where it was played, when the session says. */
+  venue?: string;
   facts: string;
@@ -57,2 +59,3 @@ export function buildCardModel(session: Session, options: { results: boolean; th
   if (stats.games > 0) facts.push(engine.formatDuration(stats.playingMs));
+  const venue = session.venue?.trim();
   return {
@@ -60,2 +63,3 @@ export function buildCardModel(session: Session, options: { results: boolean; th
     date: shortDate(session.createdAt),
+    ...(venue ? { venue } : {}),
     facts: facts.join(' · '),
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/summaryScreen.test.tsx src/ui/pastSessions.test.tsx src/ui/cardModel.test.ts src/ui/cardDraw.test.ts`
Expected: all four files pass.

Then run `npx tsc --noEmit && npx vitest run`.
Expected: `tsc` prints nothing and the suite shows 1022 tests across 99 files.

- [ ] **Step 5: Commit**

```bash
git add src/test/historyFixtures.ts src/ui/PastSessionsScreen.tsx src/ui/SummaryScreen.tsx src/ui/cardDraw.test.ts src/ui/cardDraw.ts src/ui/cardModel.test.ts src/ui/cardModel.ts src/ui/pastSessions.test.tsx src/ui/summaryScreen.test.tsx
git commit -m "Show the venue on the summary, Past sessions and the picture"
```

### Task 8: Cover the case where the session has ended

The mutation run in Task 10 found one break the earlier tests could not catch: the "Ends" chip staying on screen after the session ended. The app swaps to the summary when a session ends, so a test through the whole app never sees it. This test renders the live screen directly with an ended session.

**Files:**
- Modify: `src/ui/liveScreen.test.tsx`

- [ ] **Step 1: Add the test**

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/ui/liveScreen.test.tsx`:

```diff
diff --git a/src/ui/liveScreen.test.tsx b/src/ui/liveScreen.test.tsx
--- a/src/ui/liveScreen.test.tsx
+++ b/src/ui/liveScreen.test.tsx
@@ -1,2 +1,2 @@
-import { act, fireEvent, screen, within } from '@testing-library/react';
+import { act, fireEvent, render, screen, within } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
@@ -10,2 +10,4 @@ import { useSessionStore } from '../store/sessionStore';
 import { renderAtSetup } from '../test/renderAtSetup';
+import { newTestSession } from '../engine/testing';
+import { LiveScreen } from './LiveScreen';
 
@@ -376,7 +378,7 @@ describe('extending the session', () => {
 
-  it('shows no chip once the session has ended', async () => {
-    await startSession(userEvent.setup(), FIVE);
-    setEnd(END);
+  it('shows no chip on a session that has ended, even with a planned end', () => {
+    const base = { ...newTestSession(['A', 'B', 'C', 'D']), plannedEndAt: END };
+    const { rerender } = render(<LiveScreen session={base} onSettings={() => {}} />);
     expect(chip()).toBeInTheDocument();
-    act(() => useSessionStore.setState({ session: { ...useSessionStore.getState().session!, endedAt: END } }));
+    rerender(<LiveScreen session={{ ...base, endedAt: END }} onSettings={() => {}} />);
     expect(chip()).not.toBeInTheDocument();
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/ui/liveScreen.test.tsx`
Expected: passes. It passes straight away because the code is already right; its job is to fail when the break "chip shown after the session ended" is made. Task 10 runs that break.

- [ ] **Step 3: Check the whole project**

Run `npx tsc --noEmit && npx vitest run`.
Expected: `tsc` prints nothing and the suite shows 1022 tests across 99 files.

- [ ] **Step 4: Commit**

```bash
git add src/ui/liveScreen.test.tsx
git commit -m "Cover a gap found by the mutation check"
```

### Task 9: Keep the session title readable beside the end time

The browser check at 360 px found that the "Ends" chip took so much of the header that the session title was cut to "Tuesday op...". The end time moves onto the muted line under the title, as a text button with a 44 px tap area that does not make the header taller. No new test: the labels and roles are unchanged, so the Task 6 tests still cover it, and the layout is checked in the browser in Task 10.

**Files:**
- Modify: `src/styles/app.css`
- Modify: `src/ui/LiveScreen.tsx`

- [ ] **Step 1: Make the change**

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/styles/app.css`, `src/ui/LiveScreen.tsx`:

```diff
diff --git a/src/styles/app.css b/src/styles/app.css
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -1713,2 +1713,4 @@ caption {
 /* The planned end in the live header */
-.end-chip { padding: 4px 12px; font-size: 13px; font-weight: 600; white-space: nowrap; }
+.live-sub { display: flex; align-items: center; gap: 8px; }
+/* A text button with a 44 px tap area that does not make the header taller */
+.end-link { background: none; border: 0; color: inherit; font: inherit; font-size: 13px; font-weight: 600; text-decoration: underline; padding: 14px 4px; margin: -14px 0; white-space: nowrap; cursor: pointer; }
diff --git a/src/ui/LiveScreen.tsx b/src/ui/LiveScreen.tsx
--- a/src/ui/LiveScreen.tsx
+++ b/src/ui/LiveScreen.tsx
@@ -128,12 +128,14 @@ export function LiveScreen({ session, onSettings }: { session: Session; onSettin
           <h1 className="screen-title">{session.name}</h1>
-          <span className="muted">
-            {session.history.length} {session.history.length === 1 ? 'game' : 'games'} played
-          </span>
+          <div className="live-sub">
+            <span className="muted">
+              {session.history.length} {session.history.length === 1 ? 'game' : 'games'} played
+            </span>
+            {endsAt !== null && (
+              <button type="button" className="end-link" aria-label={`Ends ${endsAt}, extend the session`} onClick={() => setExtending(true)}>
+                Ends {endsAt}
+              </button>
+            )}
+          </div>
         </div>
         <div className="live-actions">
-          {endsAt !== null && (
-            <button type="button" className="chip end-chip" aria-label={`Ends ${endsAt}, extend the session`} onClick={() => setExtending(true)}>
-              Ends {endsAt}
-            </button>
-          )}
           <LiveMenu
```

- [ ] **Step 2: Check the whole project**

Run `npx tsc --noEmit && npx vitest run`.
Expected: `tsc` prints nothing and the suite shows 1022 tests across 99 files.

- [ ] **Step 3: Commit**

```bash
git add src/styles/app.css src/ui/LiveScreen.tsx
git commit -m "Keep the session title readable beside the end time"
```

### Task 10: Check everything, then look at it

**Files:**
- No new files. A script outside the repo, and a spec update that is already committed with this plan.

- [ ] **Step 1: Run the whole project**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Expected: 1022 tests pass across 99 files, `tsc` prints nothing, the build finishes and writes `dist/sw.js`. The base was 905 tests across 93 files. A different count means something was skipped or added.

- [ ] **Step 2: Mutation check**

Save this script as `/tmp/mutate-home.py` (outside the repo) and run it from the repo root with `python3 /tmp/mutate-home.py`. It first checks that the named test files pass. Then, for each break, it changes one line, runs the test files that must fail, and puts the line back. Every line must say KILLED, and the last line must say `53 of 53 killed`. A break that survives means a test is missing: add it before going on.


```python
#!/usr/bin/env python3
"""Deliberate breaks for the Home feature. Run from the repo root: python3 /tmp/mutate-home.py
Each break is applied, the named test files run, and the file is put back. Every break must be KILLED."""
import subprocess, sys

BREAKS = [
    ('extendSession accepts 241 minutes',
     'src/engine/session.ts',
     'minutes > 240',
     'minutes > 241',
     ['src/engine/extend.test.ts']),
    ('nextSlot walks backwards through the week',
     'src/store/slots.ts',
     '(today.getDay() + d) % 7',
     '(today.getDay() - d + 7) % 7',
     ['src/store/slots.test.ts']),
    ('formatClock shows 12 pm as 0 pm',
     'src/store/slots.ts',
     'h % 12 || 12',
     'h % 12',
     ['src/store/slots.test.ts']),
    ('addVenue skips the duplicate check',
     'src/store/slots.ts',
     '    if (existing) return existing;\n',
     '',
     ['src/store/slots.test.ts']),
    ('parseSlots keeps invalid slots',
     'src/store/slots.ts',
     'slots: data.slots.filter(isSlot)',
     'slots: data.slots',
     ['src/store/slots.test.ts']),
    ('saveSlot does not persist',
     'src/store/slots.ts',
     '    set({ slots: next });\n    persist({ slots: next, venues });\n',
     '    set({ slots: next });\n',
     ['src/store/slots.test.ts']),
    ('isSession stops checking plannedEndAt',
     'src/store/persistence.ts',
     '(x.plannedEndAt === undefined || isNum(x.plannedEndAt))',
     'true',
     ['src/store/persistence.test.ts']),
    ('extendSession ignores the existing planned end',
     'src/engine/session.ts',
     '(s.plannedEndAt ?? ctx.now)',
     '(ctx.now)',
     ['src/engine/extend.test.ts']),
    ('big card picks the wrong slot',
     'src/ui/HomeScreen.tsx',
     'const big = nextSlot(slots, now);',
     'const big = slots[slots.length - 1];',
     ['src/ui/HomeScreen.test.tsx']),
    ('this-time scope persists',
     'src/ui/HomeScreen.tsx',
     '      setTonight(editing.id, patch);\n    }\n    setEditingId',
     '      saveSlot(editing.id, patch);\n    }\n    setEditingId',
     ['src/ui/HomeScreen.test.tsx']),
    ('always scope does not persist',
     'src/ui/HomeScreen.tsx',
     '      saveSlot(editing.id, patch);\n      //',
     '      setTonight(editing.id, patch);\n      //',
     ['src/ui/HomeScreen.test.tsx']),
    ('always scope keeps the tonight copy',
     'src/ui/HomeScreen.tsx',
     '      clearTonight(editing.id);\n    } else',
     '    } else',
     ['src/ui/HomeScreen.test.tsx']),
    ('Start ignores tonight values',
     'src/ui/HomeScreen.tsx',
     '    const eff = effectiveSlot(slot, tonight);\n    const plan',
     '    const eff = slot;\n    const plan',
     ['src/ui/HomeScreen.test.tsx', 'src/ui/homeWiring.test.tsx']),
    ('plannedEndAt computed with no end',
     'src/ui/HomeScreen.tsx',
     'if (eff.endMin !== undefined) plan.plannedEndAt = timestampAt(eff.endMin, Date.now());',
     'plan.plannedEndAt = timestampAt(eff.endMin ?? 0, Date.now());',
     ['src/ui/HomeScreen.test.tsx']),
    ('plan venue dropped',
     'src/ui/HomeScreen.tsx',
     'if (eff.venue !== undefined) plan.venue = eff.venue;',
     '',
     ['src/ui/HomeScreen.test.tsx']),
    ('small cards include the big slot',
     'src/ui/HomeScreen.tsx',
     'const others = slots.filter((s) => s.id !== big?.id);',
     'const others = slots;',
     ['src/ui/HomeScreen.test.tsx']),
    ('label never says Today',
     'src/ui/HomeScreen.tsx',
     "slot.weekday === now.getDay() ? 'Today' : day",
     'day',
     ['src/ui/HomeScreen.test.tsx']),
    ('tag always shown',
     'src/ui/HomeScreen.tsx',
     '{tonight[slot.id] && <span',
     '{true && <span',
     ['src/ui/HomeScreen.test.tsx']),
    ('end before start not rejected',
     'src/ui/EditSlotSheet.tsx',
     'endMin <= startMin',
     'false && endMin <= startMin',
     ['src/ui/EditSlotSheet.test.tsx']),
    ('end equal to start allowed',
     'src/ui/EditSlotSheet.tsx',
     'endMin <= startMin',
     'endMin < startMin',
     ['src/ui/EditSlotSheet.test.tsx']),
    ('13th venue selected anyway',
     'src/ui/EditSlotSheet.tsx',
     '    if (!name) return;\n    setVenue(name);',
     '    setVenue(name || newVenue.trim());',
     ['src/ui/EditSlotSheet.test.tsx']),
    ('tap again does not clear',
     'src/ui/EditSlotSheet.tsx',
     'setVenue(venue === v ? undefined : v)',
     'setVenue(v)',
     ['src/ui/EditSlotSheet.test.tsx']),
    ('scope defaults to always',
     'src/ui/EditSlotSheet.tsx',
     "useState<SlotScope>('this-time')",
     "useState<SlotScope>('always')",
     ['src/ui/EditSlotSheet.test.tsx']),
    ('cleared time saved as 0',
     'src/ui/EditSlotSheet.tsx',
     'return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;',
     'return m ? Number(m[1]) * 60 + Number(m[2]) : 0;',
     ['src/ui/EditSlotSheet.test.tsx']),
    ('save sends this-time for always',
     'src/ui/EditSlotSheet.tsx',
     'onSave({ startMin, endMin, venue }, scope);',
     "onSave({ startMin, endMin, venue }, 'this-time');",
     ['src/ui/EditSlotSheet.test.tsx']),
    ('plan weekday ignored',
     'src/ui/SetupScreen.tsx',
     'const weekday = plan?.weekday ?? new Date().getDay();',
     'const weekday = new Date().getDay();',
     ['src/ui/homeWiring.test.tsx']),
    ('venue not given to createSession',
     'src/ui/SetupScreen.tsx',
     '      venue: plan?.venue,\n',
     '',
     ['src/ui/homeWiring.test.tsx']),
    ('plannedEndAt not given to createSession',
     'src/ui/SetupScreen.tsx',
     '      plannedEndAt: plan?.plannedEndAt,\n',
     '',
     ['src/ui/homeWiring.test.tsx']),
    ('tonight not cleared on start',
     'src/ui/SetupScreen.tsx',
     'if (plan) clearTonight(plan.slotId);',
     '',
     ['src/ui/homeWiring.test.tsx']),
    ('Back always shown',
     'src/ui/SetupScreen.tsx',
     '{onBack && (',
     '{(onBack || true) && (',
     ['src/ui/homeWiring.test.tsx']),
    ('reset does not return Home',
     'src/ui/App.tsx',
     "      setView('home');\n      setSetupOpen(false);",
     '      setSetupOpen(false);',
     ['src/ui/homeWiring.test.tsx', 'src/ui/App.test.tsx']),
    ('Back from Settings goes to Setup',
     'src/ui/App.tsx',
     '<SettingsScreen onBack={() => setView(settingsFrom)}',
     "<SettingsScreen onBack={() => setView('setup')}",
     ['src/ui/homeWiring.test.tsx']),
    ('Past sessions from Home goes back to Settings',
     'src/ui/App.tsx',
     "onHistory={() => openHistory('home')}",
     "onHistory={() => openHistory('settings')}",
     ['src/ui/homeWiring.test.tsx']),
    ('Setup Back goes nowhere',
     'src/ui/App.tsx',
     "                setSetupOpen(false);\n                setPlan(undefined);\n                setView('home');",
     '                setSetupOpen(false);',
     ['src/ui/homeWiring.test.tsx']),
    ('landing view is setup',
     'src/ui/App.tsx',
     "useState<'home' | 'setup' | 'saved' | 'settings' | 'history'>('home')",
     "useState<'home' | 'setup' | 'saved' | 'settings' | 'history'>('setup')",
     ['src/ui/homeWiring.test.tsx', 'src/ui/App.test.tsx']),
    ('chip shown after the session ended',
     'src/ui/LiveScreen.tsx',
     '&& session.endedAt === undefined ? clockOf',
     '? clockOf',
     ['src/ui/liveScreen.test.tsx']),
    ('chip clock off by an hour',
     'src/ui/LiveScreen.tsx',
     'd.getHours() * 60',
     '(d.getHours() + 1) * 60',
     ['src/ui/liveScreen.test.tsx']),
    ('chip shown with no planned end',
     'src/ui/LiveScreen.tsx',
     '{endsAt !== null && (',
     '{true && (',
     ['src/ui/liveScreen.test.tsx']),
    ('+30 adds 15',
     'src/ui/ExtendSheet.tsx',
     'minutes: 30, said',
     'minutes: 15, said',
     ['src/ui/ExtendSheet.test.tsx']),
    ('+1 hour adds 30',
     'src/ui/ExtendSheet.tsx',
     'minutes: 60,',
     'minutes: 30,',
     ['src/ui/ExtendSheet.test.tsx']),
    ('label wrong',
     'src/ui/ExtendSheet.tsx',
     '`Extended by ${said}`',
     '`Extended ${said}`',
     ['src/ui/ExtendSheet.test.tsx']),
    ('sheet does not close on success',
     'src/ui/ExtendSheet.tsx',
     'if (res.ok) onClose();',
     'if (res.ok) void 0;',
     ['src/ui/ExtendSheet.test.tsx']),
    ('error swallowed',
     'src/ui/ExtendSheet.tsx',
     'else setError(res.error);',
     'else void 0;',
     ['src/ui/ExtendSheet.test.tsx']),
    ('chip opens nothing',
     'src/ui/LiveScreen.tsx',
     'onClick={() => setExtending(true)}',
     'onClick={() => {}}',
     ['src/ui/liveScreen.test.tsx']),
    ('summary shows a venue line when unset',
     'src/ui/SummaryScreen.tsx',
     '{session.venue && <p',
     '{true && <p',
     ['src/ui/summaryScreen.test.tsx']),
    ('summary venue line above name',
     'src/ui/SummaryScreen.tsx',
     '<p className="muted">{session.name}</p>\n          {session.venue && <p className="muted sum-venue">{session.venue}</p>}',
     '{session.venue && <p className="muted sum-venue">{session.venue}</p>}\n          <p className="muted">{session.name}</p>',
     ['src/ui/summaryScreen.test.tsx']),
    ('past-row order changed',
     'src/ui/PastSessionsScreen.tsx',
     "{shortDate(e.endedAt)} · {e.session.venue ? `${e.session.venue} · ` : ''}{e.games}",
     "{e.session.venue ? `${e.session.venue} · ` : ''}{shortDate(e.endedAt)} · {e.games}",
     ['src/ui/pastSessions.test.tsx']),
    ('past-row venue always shown',
     'src/ui/PastSessionsScreen.tsx',
     "e.session.venue ? `${e.session.venue} · ` : ''",
     '`${e.session.venue} · `',
     ['src/ui/pastSessions.test.tsx']),
    ('card model venue not trimmed',
     'src/ui/cardModel.ts',
     'session.venue?.trim()',
     'session.venue',
     ['src/ui/cardModel.test.ts']),
    ('card model venue always set',
     'src/ui/cardModel.ts',
     '...(venue ? { venue } : {}),',
     'venue,',
     ['src/ui/cardModel.test.ts']),
    ('card draws venue when unset',
     'src/ui/cardDraw.ts',
     '[model.date, model.venue, model.facts].filter(Boolean)',
     "[model.date, model.venue ?? 'Unknown', model.facts].filter(Boolean)",
     ['src/ui/cardDraw.test.ts']),
    ('long venue not cut',
     'src/ui/cardDraw.ts',
     'fit(ctx, dayLine, CONTENT_WIDTH)',
     'dayLine',
     ['src/ui/cardDraw.test.ts']),
    ('card venue after facts',
     'src/ui/cardDraw.ts',
     '[model.date, model.venue, model.facts]',
     '[model.date, model.facts, model.venue]',
     ['src/ui/cardDraw.test.ts']),
]

def run(tests):
    p = subprocess.run(['npx', 'vitest', 'run', *tests], capture_output=True, text=True)
    return p.returncode

def main():
    every = sorted({t for *_, ts in BREAKS for t in ts})
    if run(every) != 0:
        sys.exit('The tests must pass before any break is tried.')
    survived = []
    for name, path, old, new, tests in BREAKS:
        src = open(path).read()
        if src.count(old) != 1:
            sys.exit(f'Cannot place the break "{name}": found {src.count(old)} matches in {path}')
        open(path, 'w').write(src.replace(old, new))
        try:
            killed = run(tests) != 0
        finally:
            open(path, 'w').write(src)
        print(('KILLED   ' if killed else 'SURVIVED ') + name, flush=True)
        if not killed:
            survived.append(name)
    print(f'{len(BREAKS) - len(survived)} of {len(BREAKS)} killed')
    sys.exit(1 if survived else 0)

main()
```

The first eight breaks cover Tasks 1 and 2, the next 27 cover Tasks 3 to 5, and the last 18 cover Tasks 6 and 7 (the 53 breaks are the ones that were run when the code was built). The break "chip shown after the session ended" is only killed once Task 8's test is in.

- [ ] **Step 3: Look at it in a browser at 360 px wide**

Start `npx vite --port 5198 --strictPort`, open `http://localhost:5198/`, run `localStorage.clear()` in the page console and reload, then set the viewport to 360 by 740.

1. Home shows three cards: the next weekday large with its primary button, the other two smaller. Each shows "Add a time" and "Add a venue". "Start a one-off session" is below.
2. Tap Edit on one card. The sheet shows two time fields, a venue field with "Add venue", and "Just this time" selected. Enter a start and end time, add a venue, choose "Always for ...", Save. The card now shows the range (for example "7:00 to 9:00 pm") and the venue.
3. Tap the card's Start button. Who's playing shows the venue and range under the title. Pick at least four players and start. The live header shows the full session title, and under it "N games played" and an underlined "Ends 9:00 pm".
4. Tap the end time. The sheet shows +15 min, +30 min and +1 hour. Tap +30 min. The end moves 30 minutes and the Undo bar says "Extended by 30 minutes".
5. End the session. The summary shows the venue under the session name. Share as picture would draw the venue after the date.
6. Run `localStorage.clear()` again.

Reset the viewport to desktop and stop the server when done.

- [ ] **Step 4: Push and merge only when Clyde says so**

Push and merge only when Clyde says "push and merge". Production is the branch `claude/pickleball-matchmaking-app-i4baca`, updated by fast-forward. If it has moved, rebase `home` onto it and run Step 1 again before pushing.

- [ ] **Step 5: Phone check (Clyde's, on a real phone)**

On the live site after the merge:

1. Home shows Tuesday, Thursday and Saturday. Edit one: set a time and a venue, choose "Always", Save. Close the app and open it again. The time and venue are still there.
2. Edit another with "Just this time". Close and reopen. It is back to what it was before.
3. Start a session from a slot, finish a game, and extend with +30 min. The end time moves and Undo works.
4. End the session. The venue shows on the summary and in Past sessions. Share as picture shows the venue after the date.

- [ ] **Step 6: After the merge, remove the worktrees**

```bash
git -C /Users/clydealegro/Vibe/pickleball-match-app/pickleball-match-app worktree remove /Users/clydealegro/Vibe/pickleball-match-app/pickleball-match-app-home
git -C /Users/clydealegro/Vibe/pickleball-match-app/pickleball-match-app worktree remove /Users/clydealegro/Vibe/pickleball-match-app/pickleball-match-app-home-proved
git -C /Users/clydealegro/Vibe/pickleball-match-app/pickleball-match-app worktree prune
git -C /Users/clydealegro/Vibe/pickleball-match-app/pickleball-match-app branch -D home-proved
```

Use `--force` only after diffing the tree against the production branch and finding every change already landed.

---

## Self-review

- **Decisions covered.** 1 and 2: Task 2. 3 and 4: Tasks 2 to 4. 5: Task 4. 6: Tasks 1 and 6. 7: Task 5. 8: Task 7. 9: Task 5.
- **Placeholders.** None. Every step has its code, its patch, or its command.
- **Names.** `extendSession`, `venue`, `plannedEndAt`, `nextSlot`, `formatClock`, `formatRange`, `timestampAt`, `useSlotsStore`, `effectiveSlot`, `EditSlotSheet`, `HomeScreen`, `ExtendSheet` and `renderAtSetup` are spelled the same in every task that uses them.

## Risks to watch

- **Home adds a tap for someone who just wants to play.** The big card's Start button is on Home itself, so the path is one tap to Who's playing. "Start a one-off session" is below the cards.
- **A session started from a slot on a different day keeps its slot's name** ("Tuesday open play") but gets the real date. The picture shows the real date. This is intended: the slot is what the session was.
- **Slots are per device.** Two organizers on two phones see their own times and venues until slots sync.
- **The slots store reads `localStorage` when the module loads.** Tests reset it with `setState`.
- **Existing tests changed in Task 5:** 18 files now open a one-off session first, 16 of them through `renderAtSetup`. They check the same behaviour as before.

## Execution handoff

Plan complete. Two ways to run it:

1. **Subagent-driven (recommended).** A fresh subagent per task with a review between tasks.
2. **Inline.** Run the tasks in this session with checkpoints.
