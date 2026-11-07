# PIKLMatch Phase 2a: the Ready step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Games wait for the organizer's Start. A new session opens with its courts Ready, a finished game leaves its court Ready, the clock runs from the moment Start is pressed, and a player who is missing can be taken out before the game begins. A setting brings back today's auto-start.

**Architecture:** A court gains a third status, `ready`, holding a `lineup` (four players, no clock). `fillCourts` makes Ready courts when a session says `autoStart: false`, and Playing ones otherwise, so sessions saved before this change, and every older test, behave exactly as before. `startCourt` and `startAllReady` turn Ready into Playing. The saved-session check learns the new status in its own task, because it would otherwise discard such a session on reload.

**Tech Stack:** React 18, TypeScript, Zustand, Vitest with Testing Library, Vite. No new dependencies.

Spec: `docs/superpowers/specs/2026-11-07-organizer-experience-phases.md`, Phase 2, Part 2a.

**How the code in this plan was proved.** Every file and diff below was built once in a scratch copy of the repository at commit `63d7221`, with the full suite passing (637 tests, up from 581). The engine rules and the screens were mutation-checked: each deliberate breakage was caught, except one equivalent one noted in the self-review. Apply a diff from the project root with `patch -p1 < the-diff-file`, or by hand: each hunk shows its context.

**Conventions.** Run commands from `pickleball-match-app/` (the folder with `package.json`). Stage files by name, never with `git add -A`. No AI attribution lines in commit messages. After the last task, run the Ralph loop before merging.

---
## Task 1: Steady a flaky sync test

One older test fails about one run in four on some machines: the fake sync client has no tables, so the real sync round reports an error a moment later and can overwrite the state the test just set. Fix it first so every later "all tests pass" can be trusted.

**Files:**
- Modify: `src/ui/syncUi.test.tsx`

- [ ] **Step 1: Apply this change to `src/ui/syncUi.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/syncUi.test.tsx
+++ b/src/ui/syncUi.test.tsx
@@ -224,8 +224,13 @@
     const { user, sync } = await startApp({ client: fakeClient(true) });
     await openSettings(user);
     await screen.findByText('ann@example.com');
-    act(() => sync.setState({ status: 'otherAccount' }));
-    const alert = await screen.findByRole('alert');
+    // The fake client has no tables, so the real sync round reports an error a moment later and can overwrite this
+    // state. Setting it again until it holds is what makes the test steady.
+    await vi.waitFor(() => {
+      act(() => sync.setState({ status: 'otherAccount' }));
+      expect(screen.getByRole('alert')).toHaveTextContent(/different account/i);
+    });
+    const alert = screen.getByRole('alert');
     expect(within(alert).getByText(/different account/i)).toBeInTheDocument();
     expect(screen.getByRole('button', { name: /clear saved players on this device/i })).toBeInTheDocument();
   });
```

- [ ] **Step 2: Run the tests**

```bash
for i in 1 2 3 4 5 6 7 8 9 10; do npx vitest run src/ui/syncUi.test.tsx -t "another-account" || exit 1; done
```

Expected: PASS.

- [ ] **Step 3: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/ui/syncUi.test.tsx
git commit -m "Make the another-account sync test wait for the state to hold"
```

## Task 2: Ready courts in the engine

A court can now hold a lineup that has not started. With a session that says autoStart is false, every place that used to start a game makes a Ready court instead, and a new startCourt turns it into a running game and starts the clock. Sessions that do not say anything behave exactly as before.

**Files:**
- Create: `src/engine/lineup.ts`, `src/engine/start.ts`
- Modify: `src/engine/errors.ts`, `types.ts`, `pool.ts`, `fill.ts`, `session.ts`, `index.ts`, `invariants.ts`, `testing.ts`
- Test: `src/engine/readyCourt.test.ts`

- [ ] **Step 1: Create `src/engine/readyCourt.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { addCourt } from './courts';
import { finishGame } from './game';
import { assertInvariants } from './invariants';
import { lineupIds } from './lineup';
import { orderedWaiting, reservedIds } from './pool';
import { previewNext } from './preview';
import { addPlayer } from './session';
import { startAllReady, startCourt } from './start';
import { setPlayerStatus } from './status';
import { expectEngineError, idOf, makeCtx, newTestSession } from './testing';
import type { Session } from './types';

const NAMES8 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const hold = (names: string[], opts: { courts?: number; mode?: 'fairness' | 'queue' } = {}) =>
  newTestSession(names, { courts: 1, autoStart: false, ...opts });

describe('a session that waits for Start', () => {
  it('opens its courts as Ready, with a lineup, no game and no clock', () => {
    const s = hold(['A', 'B', 'C', 'D', 'E']);
    const court = s.courts[0];
    expect(court.status).toBe('ready');
    expect(court.game).toBeUndefined();
    expect(lineupIds(court)).toHaveLength(4);
    expect(court.lineup!.team1).toHaveLength(2);
    assertInvariants(s);
  });

  it('keeps the proposed four out of the waiting list, and the rest waiting', () => {
    const s = hold(['A', 'B', 'C', 'D', 'E']);
    expect([...reservedIds(s)].sort()).toEqual([...lineupIds(s.courts[0])].sort());
    expect(orderedWaiting(s)).toHaveLength(1);
    expect(s.queueOrder).toHaveLength(1);
  });

  it('never proposes the same player to two courts', () => {
    const s = hold(NAMES8, { courts: 2 });
    expect(s.courts.map((c) => c.status)).toEqual(['ready', 'ready']);
    const all = s.courts.flatMap((c) => lineupIds(c));
    expect(new Set(all).size).toBe(8);
    assertInvariants(s);
  });

  it('starts games by themselves when the session does not say otherwise, as before', () => {
    const s = newTestSession(['A', 'B', 'C', 'D'], { courts: 1 });
    expect(s.courts[0].status).toBe('playing');
    expect(s.autoStart).toBeUndefined();
    const explicit = newTestSession(['A', 'B', 'C', 'D'], { courts: 1, autoStart: true });
    expect(explicit.courts[0].status).toBe('playing');
  });
});

describe('startCourt', () => {
  it('turns Ready into a running game with the same teams, and stamps the clock when Start is pressed', () => {
    const s = hold(['A', 'B', 'C', 'D']);
    const lineup = s.courts[0].lineup!;
    const started = startCourt(s, s.courts[0].id, makeCtx(1, 5_000));
    const court = started.courts[0];
    expect(court.status).toBe('playing');
    expect(court.lineup).toBeUndefined();
    expect(court.game).toEqual({ team1: lineup.team1, team2: lineup.team2, startedAt: 5_000 });
    assertInvariants(started);
  });

  it('refuses a court that is not Ready, and an unknown court', () => {
    const playing = newTestSession(['A', 'B', 'C', 'D'], { courts: 1 });
    expectEngineError(() => startCourt(playing, playing.courts[0].id, makeCtx()), 'NOT_READY');
    const empty = hold(['A', 'B']);
    expectEngineError(() => startCourt(empty, empty.courts[0].id, makeCtx()), 'NOT_READY');
    expectEngineError(() => startCourt(empty, 'nope', makeCtx()), 'NOT_FOUND');
  });

  it('does not change the input session', () => {
    const s = hold(['A', 'B', 'C', 'D']);
    const before = JSON.stringify(s);
    startCourt(s, s.courts[0].id, makeCtx());
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('startAllReady', () => {
  it('starts every Ready court at one moment and leaves playing and empty courts alone', () => {
    let s = hold(NAMES8, { courts: 3 });
    expect(s.courts.map((c) => c.status)).toEqual(['ready', 'ready', 'empty']);
    s = startCourt(s, s.courts[0].id, makeCtx(1, 1_000));
    s = { ...s, courts: s.courts.map((c) => c) };
    const started = startAllReady(s, makeCtx(1, 9_000));
    expect(started.courts.map((c) => c.status)).toEqual(['playing', 'playing', 'empty']);
    expect(started.courts[0].game!.startedAt).toBe(1_000);
    expect(started.courts[1].game!.startedAt).toBe(9_000);
    assertInvariants(started);
  });

  it('says so when nothing is Ready', () => {
    const s = newTestSession(NAMES8, { courts: 2 });
    expectEngineError(() => startAllReady(s, makeCtx()), 'NOT_READY');
  });
});

describe('nothing starts by itself when the session waits for Start', () => {
  const started = (s: Session) => startAllReady(s, makeCtx(1, 2_000));

  it('finishing a game makes the court Ready with the next four', () => {
    let s = started(hold(NAMES8));
    s = finishGame(s, s.courts[0].id, makeCtx(1, 60_000));
    expect(s.courts[0].status).toBe('ready');
    expect(s.courts[0].game).toBeUndefined();
    expect(lineupIds(s.courts[0])).toHaveLength(4);
    expect(s.history).toHaveLength(1);
    assertInvariants(s);
  });

  it('finishing a game with too few waiting leaves the court empty', () => {
    let s = started(hold(['A', 'B', 'C', 'D']));
    s = setPlayerStatus(s, idOf(s, 'A'), 'break', makeCtx());
    s = finishGame(s, s.courts[0].id, makeCtx(1, 60_000));
    expect(s.courts[0].status).toBe('empty');
    assertInvariants(s);
  });

  it('a late arrival who completes a lineup makes a Ready court, not a game', () => {
    let s = hold(['A', 'B', 'C']);
    expect(s.courts[0].status).toBe('empty');
    s = addPlayer(s, { name: 'D' }, makeCtx());
    expect(s.courts[0].status).toBe('ready');
    assertInvariants(s);
  });

  it('adding a court with four waiting makes it Ready', () => {
    let s = started(hold(NAMES8));
    s = addCourt(s, makeCtx());
    expect(s.courts[1].status).toBe('ready');
    assertInvariants(s);
  });
});

describe('the preview of the next game', () => {
  it('ignores Ready courts, so the reserved four are never offered twice', () => {
    let s = hold(NAMES8, { courts: 2 });
    expect(previewNext(s)).toBeNull();
    s = startCourt(s, s.courts[0].id, makeCtx(1, 100));
    s = addPlayer(s, { name: 'I' }, makeCtx());
    s = addPlayer(s, { name: 'J' }, makeCtx());
    s = addPlayer(s, { name: 'K' }, makeCtx());
    s = addPlayer(s, { name: 'L' }, makeCtx());
    const next = previewNext(s)!;
    expect(next.courtNumber).toBe(1);
    expect(next.playerIds).toHaveLength(4);
    for (const id of next.playerIds) expect(reservedIds(s).has(id)).toBe(false);
  });
});

describe('the invariants know about Ready courts', () => {
  const broken = (change: (s: Session) => void) => {
    const s = hold(['A', 'B', 'C', 'D', 'E']);
    change(s);
    return () => assertInvariants(s);
  };

  it('reject a Ready court that also has a game', () => {
    expect(broken((s) => (s.courts[0].game = { team1: ['x', 'y'], team2: ['z', 'w'], startedAt: 1 }))).toThrow();
  });

  it('reject a Ready court marked closing', () => {
    expect(broken((s) => (s.courts[0].closing = true))).toThrow();
  });

  it('reject a player who is both in a lineup and waiting', () => {
    expect(broken((s) => s.queueOrder.push(lineupIds(s.courts[0])[0]))).toThrow();
  });

  it('reject a lineup that holds someone on a break', () => {
    expect(broken((s) => (s.players.find((p) => p.id === lineupIds(s.courts[0])[0])!.status = 'break'))).toThrow();
  });

  it('accept a healthy Ready session', () => {
    expect(broken(() => {})).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/engine/readyCourt.test.ts
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 3: Create `src/engine/lineup.ts`**

```ts
import type { Court, PlayerId, Session } from './types';

/** The four players in a Ready lineup, team 1 first. Empty when the court has none. */
export function lineupIds(court: Court): PlayerId[] {
  return court.lineup ? [...court.lineup.team1, ...court.lineup.team2] : [];
}

/**
 * Empties a Ready court and puts its players back at the front of the queue, in lineup order. `leaving` is a player who
 * is going on a break or leaving, so they are not queued.
 * MUTATES `s`: callers must pass a clone.
 */
export function releaseLineup(s: Session, court: Court, leaving?: PlayerId): void {
  const ids = lineupIds(court).filter((id) => id !== leaving);
  court.status = 'empty';
  delete court.lineup;
  s.queueOrder = [...ids, ...s.queueOrder.filter((id) => !ids.includes(id))];
}
```

- [ ] **Step 4: Create `src/engine/start.ts`**

```ts
import { cloneSession } from './clone';
import { EngineError } from './errors';
import type { Court, Ctx, Session } from './types';

/** MUTATES `s`. Turns a Ready court into a running game and starts its clock. */
function begin(court: Court, ctx: Ctx): void {
  if (court.status !== 'ready' || !court.lineup) {
    throw new EngineError('NOT_READY', 'This court has no game ready to start.');
  }
  court.game = { team1: court.lineup.team1, team2: court.lineup.team2, startedAt: ctx.now };
  court.status = 'playing';
  delete court.lineup;
}

export function startCourt(s: Session, courtId: string, ctx: Ctx): Session {
  const n = cloneSession(s);
  const court = n.courts.find((c) => c.id === courtId);
  if (!court) throw new EngineError('NOT_FOUND', 'Court not found.');
  begin(court, ctx);
  return n;
}

export function startAllReady(s: Session, ctx: Ctx): Session {
  const n = cloneSession(s);
  const ready = n.courts.filter((c) => c.status === 'ready').sort((a, b) => a.number - b.number);
  if (ready.length === 0) throw new EngineError('NOT_READY', 'No court has a game ready to start.');
  for (const court of ready) begin(court, ctx);
  return n;
}
```

- [ ] **Step 5: Apply this change to `src/engine/errors.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/errors.ts
+++ b/src/engine/errors.ts
@@ -5,6 +5,7 @@
   | 'LAST_COURT'
   | 'NOT_FOUND'
   | 'NOT_PLAYING'
+  | 'NOT_READY'
   | 'CANNOT_RETURN';
 
 export class EngineError extends Error {
```

- [ ] **Step 6: Apply this change to `src/engine/types.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -26,13 +26,21 @@
   startedAt: number;
 }
 
+/** Four players proposed for a court, waiting for the organizer to press Start. No clock runs yet. */
+export interface Lineup {
+  team1: Team;
+  team2: Team;
+}
+
 export interface Court {
   id: string;
   number: number;
-  status: 'empty' | 'playing';
+  /** `ready` holds a `lineup` that has not started; `playing` holds a `game`. */
+  status: 'empty' | 'ready' | 'playing';
   /** Remove this court when its current game ends. */
   closing: boolean;
   game?: Game;
+  lineup?: Lineup;
 }
 
 export interface FinishedGame {
@@ -56,6 +64,11 @@
   gameSeq: number;
   createdAt: number;
   endedAt?: number;
+  /**
+   * False means every game waits for the organizer's Start. Missing or true means games start by themselves, which is
+   * how sessions saved before the Ready step behave.
+   */
+  autoStart?: boolean;
 }
 
 /** Everything non-deterministic is injected so tests can control it. */
@@ -75,4 +88,5 @@
   mode: Mode;
   courtCount: number;
   players: NewPlayerInput[];
+  autoStart?: boolean;
 }
```

- [ ] **Step 7: Apply this change to `src/engine/pool.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/pool.ts
+++ b/src/engine/pool.ts
@@ -1,4 +1,5 @@
 import { EngineError } from './errors';
+import { lineupIds } from './lineup';
 import type { Player, PlayerId, Session } from './types';
 
 export function playerById(s: Session, id: PlayerId): Player {
@@ -17,10 +18,18 @@
   return ids;
 }
 
-/** Active players who are not currently on a court. */
+/** Players held back in a Ready lineup. They are not waiting and not yet playing. */
+export function reservedIds(s: Session): Set<PlayerId> {
+  const ids = new Set<PlayerId>();
+  for (const court of s.courts) for (const id of lineupIds(court)) ids.add(id);
+  return ids;
+}
+
+/** Active players who are neither in a running game nor held in a Ready lineup. */
 export function availablePlayers(s: Session): Player[] {
   const busy = onCourtIds(s);
-  return s.players.filter((p) => p.status === 'active' && !busy.has(p.id));
+  const reserved = reservedIds(s);
+  return s.players.filter((p) => p.status === 'active' && !busy.has(p.id) && !reserved.has(p.id));
 }
 
 /** Fewest games first, then waited longest, then the stable random tie key. */
```

- [ ] **Step 8: Apply this change to `src/engine/fill.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/fill.ts
+++ b/src/engine/fill.ts
@@ -3,7 +3,8 @@
 import type { Ctx, Session, Team } from './types';
 
 /**
- * Starts a game on every empty court that can be filled.
+ * Fills every empty court that can be filled. With auto-start (the default for sessions that do not say otherwise) the
+ * game starts at once. Without it the court becomes Ready and waits for the organizer's Start.
  * MUTATES `s` — callers must pass a clone.
  *
  * Both modes take the first 4 of `orderedWaiting`. Fairness mode then picks the
@@ -23,8 +24,13 @@
             [ids[2], ids[3]],
           ]
         : bestSplit(four, ctx.rng);
-    court.status = 'playing';
-    court.game = { team1, team2, startedAt: ctx.now };
+    if (s.autoStart === false) {
+      court.status = 'ready';
+      court.lineup = { team1, team2 };
+    } else {
+      court.status = 'playing';
+      court.game = { team1, team2, startedAt: ctx.now };
+    }
     s.queueOrder = s.queueOrder.filter((id) => !ids.includes(id));
   }
 }
```

- [ ] **Step 9: Apply this change to `src/engine/session.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/session.ts
+++ b/src/engine/session.ts
@@ -46,6 +46,7 @@
     history: [],
     gameSeq: 0,
     createdAt: ctx.now,
+    ...(input.autoStart === undefined ? {} : { autoStart: input.autoStart }),
   };
   // Players are inserted first and courts filled once, so a whole group starts together.
   for (const p of input.players) insertPlayer(s, p, ctx);
```

- [ ] **Step 10: Apply this change to `src/engine/index.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/index.ts
+++ b/src/engine/index.ts
@@ -3,6 +3,7 @@
 export type { EngineErrorCode } from './errors';
 export { createSession, addPlayer, endSession } from './session';
 export { finishGame } from './game';
+export { startCourt, startAllReady } from './start';
 export { setPlayerStatus } from './status';
 export type { StatusTarget } from './status';
 export { addCourt, removeCourt } from './courts';
```

- [ ] **Step 11: Apply this change to `src/engine/invariants.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/invariants.ts
+++ b/src/engine/invariants.ts
@@ -1,4 +1,5 @@
 import { expect } from 'vitest';
+import { lineupIds } from './lineup';
 import { availablePlayers, onCourtIds } from './pool';
 import type { Session } from './types';
 
@@ -15,15 +16,27 @@
   expect(new Set(gameIds).size).toBe(gameIds.length);
   expect(onCourtIds(s).size).toBe(gameIds.length);
 
-  // Every player appears at most once across the queue and the courts.
-  const everywhere = [...s.queueOrder, ...gameIds];
+  // A Ready court holds four players and no game; a playing court holds a game and no lineup.
+  const lineupPlayers = s.courts.flatMap((c) => lineupIds(c));
+  for (const c of s.courts) {
+    if (c.status === 'ready') {
+      expect(c.game).toBeUndefined();
+      expect(lineupIds(c)).toHaveLength(4);
+    } else {
+      expect(c.lineup).toBeUndefined();
+    }
+  }
+
+  // Every player appears at most once across the queue, the running games and the Ready lineups.
+  const everywhere = [...s.queueOrder, ...gameIds, ...lineupPlayers];
   expect(new Set(everywhere).size).toBe(everywhere.length);
 
-  // Players on break or who left are neither waiting nor playing.
+  // Players on break or who left are neither waiting, playing nor held in a lineup.
   for (const p of s.players) {
     if (p.status === 'break' || p.status === 'left') {
       expect(s.queueOrder).not.toContain(p.id);
       expect(gameIds).not.toContain(p.id);
+      expect(lineupPlayers).not.toContain(p.id);
     }
   }
 
```

- [ ] **Step 12: Apply this change to `src/engine/testing.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/testing.ts
+++ b/src/engine/testing.ts
@@ -8,7 +8,7 @@
 
 export function newTestSession(
   names: string[],
-  opts: { courts?: number; mode?: Mode } = {},
+  opts: { courts?: number; mode?: Mode; autoStart?: boolean } = {},
   ctx: Ctx = makeCtx(),
 ): Session {
   return createSession(
@@ -17,6 +17,7 @@
       mode: opts.mode ?? 'fairness',
       courtCount: opts.courts ?? 1,
       players: names.map((name) => ({ name })),
+      autoStart: opts.autoStart,
     },
     ctx,
   );
```

- [ ] **Step 13: Run the tests**

```bash
npx vitest run src/engine
```

Expected: PASS.

- [ ] **Step 14: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/engine/lineup.ts src/engine/start.ts src/engine/errors.ts src/engine/types.ts src/engine/pool.ts src/engine/fill.ts src/engine/session.ts src/engine/index.ts src/engine/invariants.ts src/engine/testing.ts src/engine/readyCourt.test.ts
git commit -m "Add Ready courts to the engine: a lineup that waits for Start"
```

## Task 3: A break or leave on a Ready lineup

Nothing has been played on a Ready court, so a player who goes on a break or leaves is taken out at once and the next waiting player steps in. With nobody waiting, the court goes back to empty.

**Files:**
- Modify: `src/engine/status.ts`
- Test: `src/engine/readyStatus.test.ts`

- [ ] **Step 1: Create `src/engine/readyStatus.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { assertInvariants } from './invariants';
import { lineupIds } from './lineup';
import { orderedWaiting } from './pool';
import { startAllReady } from './start';
import { setPlayerStatus } from './status';
import { idOf, makeCtx, newTestSession } from './testing';

const hold = (names: string[], opts: { courts?: number; mode?: 'fairness' | 'queue' } = {}) =>
  newTestSession(names, { courts: 1, autoStart: false, ...opts });

describe('a break or leave on a Ready lineup', () => {
  it('takes effect at once and the next waiting player takes the place', () => {
    let s = hold(['A', 'B', 'C', 'D', 'E']);
    const out = lineupIds(s.courts[0])[1];
    const outName = s.players.find((p) => p.id === out)!.name;
    const waiting = orderedWaiting(s)[0].id;
    s = setPlayerStatus(s, out, 'break', makeCtx());
    const player = s.players.find((p) => p.id === out)!;
    expect(player.status).toBe('break');
    expect(player.pendingStatus).toBeUndefined();
    expect(lineupIds(s.courts[0])).toContain(waiting);
    expect(lineupIds(s.courts[0])).not.toContain(out);
    expect(s.courts[0].lineup!.team1[1]).toBe(waiting);
    expect(outName).toBeTruthy();
    assertInvariants(s);
  });

  it('works the same for leaving', () => {
    let s = hold(['A', 'B', 'C', 'D', 'E']);
    const out = lineupIds(s.courts[0])[0];
    s = setPlayerStatus(s, out, 'left', makeCtx());
    expect(s.players.find((p) => p.id === out)!.status).toBe('left');
    expect(lineupIds(s.courts[0])).toHaveLength(4);
    assertInvariants(s);
  });

  it('with nobody to take the place, empties the court and returns the other three to the front of the queue', () => {
    let s = hold(['A', 'B', 'C', 'D'], { mode: 'queue' });
    const [first, second, third, fourth] = lineupIds(s.courts[0]);
    s = setPlayerStatus(s, second, 'break', makeCtx());
    expect(s.courts[0].status).toBe('empty');
    expect(s.courts[0].lineup).toBeUndefined();
    expect(s.queueOrder).toEqual([first, third, fourth]);
    assertInvariants(s);
  });

  it('still defers a break for a player in a running game', () => {
    let s = startAllReady(hold(['A', 'B', 'C', 'D']), makeCtx());
    const id = idOf(s, 'A');
    s = setPlayerStatus(s, id, 'break', makeCtx());
    expect(s.players.find((p) => p.id === id)!.pendingStatus).toBe('break');
    assertInvariants(s);
  });
});

describe('a player returning from a break', () => {
  it('a player coming back from a break who completes a lineup makes a Ready court', () => {
    let s = hold(['A', 'B', 'C', 'D']);
    s = setPlayerStatus(s, idOf(s, 'A'), 'break', makeCtx());
    expect(s.courts[0].status).toBe('empty');
    s = setPlayerStatus(s, idOf(s, 'A'), 'active', makeCtx());
    expect(s.courts[0].status).toBe('ready');
    assertInvariants(s);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/engine/readyStatus.test.ts
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 3: Apply this change to `src/engine/status.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/status.ts
+++ b/src/engine/status.ts
@@ -1,14 +1,16 @@
 import { cloneSession } from './clone';
 import { EngineError } from './errors';
 import { fillCourts } from './fill';
-import { lateArrivalGames, onCourtIds, playerById } from './pool';
+import { lineupIds, releaseLineup } from './lineup';
+import { lateArrivalGames, onCourtIds, orderedWaiting, playerById } from './pool';
 import type { Ctx, PlayerId, PlayerStatus, Session } from './types';
 
 export type StatusTarget = PlayerStatus;
 
 /**
- * Break / leave: immediate for waiting players; for a player on court it is
- * recorded as `pendingStatus` and applied when their game ends.
+ * Break / leave: immediate for waiting players and for players in a Ready lineup (the next waiting player takes
+ * their place, or the court goes back to empty); for a player in a running game it is recorded as `pendingStatus`
+ * and applied when the game ends.
  * Active: returns a player from break (treated like a late arrival) or cancels
  * a pending break/leave. A player who left cannot return.
  */
@@ -45,6 +47,23 @@
     return n;
   }
 
+  const readyCourt = n.courts.find((c) => c.status === 'ready' && lineupIds(c).includes(p.id));
+  if (readyCourt?.lineup) {
+    p.status = target;
+    const replacement = orderedWaiting(n)[0];
+    if (replacement) {
+      const swap = (team: [string, string]): [string, string] => [
+        team[0] === p.id ? replacement.id : team[0],
+        team[1] === p.id ? replacement.id : team[1],
+      ];
+      readyCourt.lineup = { team1: swap(readyCourt.lineup.team1), team2: swap(readyCourt.lineup.team2) };
+      n.queueOrder = n.queueOrder.filter((id) => id !== replacement.id);
+    } else {
+      releaseLineup(n, readyCourt, p.id);
+    }
+    return n;
+  }
+
   p.status = target;
   n.queueOrder = n.queueOrder.filter((id) => id !== p.id);
   return n;
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/engine
```

Expected: PASS.

- [ ] **Step 5: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/engine/status.ts src/engine/readyStatus.test.ts
git commit -m "Take a player out of a Ready lineup at once on a break or leave"
```

## Task 4: Removing a Ready court, and the fuzz test

Removing a Ready court takes it away at once and sends its four back to the front of the waiting list (they may fill another empty court), which needs the context for the random split, so `removeCourt` gains a third argument. The random-operations test now runs with and without auto-start and presses Start too.

**Files:**
- Modify: `src/engine/courts.ts`, `src/ui/LiveScreen.tsx`, `src/engine/fuzz.test.ts`, `courts.test.ts`, `status.test.ts`, `game.test.ts`
- Test: `src/engine/readyCourts.test.ts`

- [ ] **Step 1: Create `src/engine/readyCourts.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { removeCourt } from './courts';
import { assertInvariants } from './invariants';
import { lineupIds } from './lineup';
import { endSession } from './session';
import { expectEngineError, makeCtx, newTestSession } from './testing';

const NAMES8 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const hold = (names: string[], opts: { courts?: number; mode?: 'fairness' | 'queue' } = {}) =>
  newTestSession(names, { courts: 1, autoStart: false, ...opts });

describe('removing and ending around Ready courts', () => {
  it('removes a Ready court at once and puts its four back to wait', () => {
    let s = hold(NAMES8, { courts: 2 });
    s = removeCourt(s, s.courts[1].id, makeCtx());
    expect(s.courts).toHaveLength(1);
    expect(s.courts[0].status).toBe('ready');
    expect(s.queueOrder).toHaveLength(4);
    assertInvariants(s);
  });

  it('lets the returned four fill another empty court as a Ready lineup', () => {
    let s = hold(['A', 'B', 'C', 'D'], { courts: 3 });
    expect(s.courts.map((c) => c.status)).toEqual(['ready', 'empty', 'empty']);
    s = removeCourt(s, s.courts[0].id, makeCtx());
    expect(s.courts).toHaveLength(2);
    expect(s.courts.map((c) => c.status)).toEqual(['ready', 'empty']);
    assertInvariants(s);
  });

  it('still keeps the last open court', () => {
    const s = hold(['A', 'B', 'C', 'D']);
    expectEngineError(() => removeCourt(s, s.courts[0].id, makeCtx()), 'LAST_COURT');
  });

  it('ends a session that still has a Ready lineup without recording a game for it', () => {
    let s = hold(['A', 'B', 'C', 'D', 'E']);
    s = endSession(s, makeCtx(1, 9_000));
    expect(s.endedAt).toBe(9_000);
    expect(s.history).toHaveLength(0);
    expect(s.players.every((p) => p.gamesPlayed === 0)).toBe(true);
    assertInvariants(s);
  });
});

describe('returning a Ready lineup to the queue', () => {
  it('puts the four ahead of everyone already waiting, in lineup order', () => {
    let s = hold(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'], { courts: 2, mode: 'queue' });
    const waitingBefore = [...s.queueOrder];
    const lineup = lineupIds(s.courts[1]);
    expect(waitingBefore).toHaveLength(2);
    s = removeCourt(s, s.courts[1].id, makeCtx());
    expect(s.queueOrder).toEqual([...lineup, ...waitingBefore]);
    assertInvariants(s);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/engine/readyCourts.test.ts
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 3: Apply this change to `src/engine/courts.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/courts.ts
+++ b/src/engine/courts.ts
@@ -1,6 +1,7 @@
 import { cloneSession } from './clone';
 import { EngineError } from './errors';
 import { fillCourts } from './fill';
+import { releaseLineup } from './lineup';
 import type { Ctx, Court, Session } from './types';
 
 export function addCourt(s: Session, ctx: Ctx): Session {
@@ -13,11 +14,11 @@
 }
 
 /**
- * Empty court: removed immediately. Court in play: marked `closing` and removed
- * when its game ends. Calling again on a closing court cancels the closing.
- * At least one court must stay open.
+ * Empty or Ready court: removed immediately (a Ready lineup goes back to the front of the waiting list, and may fill
+ * another empty court). Court in play: marked `closing` and removed when its game ends. Calling again on a closing
+ * court cancels the closing. At least one court must stay open.
  */
-export function removeCourt(s: Session, courtId: string): Session {
+export function removeCourt(s: Session, courtId: string, ctx: Ctx): Session {
   const n = cloneSession(s);
   const court = n.courts.find((c) => c.id === courtId);
   if (!court) throw new EngineError('NOT_FOUND', 'Court not found.');
@@ -28,7 +29,11 @@
   if (n.courts.filter((c) => !c.closing).length <= 1) {
     throw new EngineError('LAST_COURT', 'At least one court must stay open.');
   }
-  if (court.status === 'empty') {
+  if (court.status === 'ready') {
+    releaseLineup(n, court);
+    n.courts = n.courts.filter((c) => c.id !== court.id);
+    fillCourts(n, ctx);
+  } else if (court.status === 'empty') {
     n.courts = n.courts.filter((c) => c.id !== court.id);
   } else {
     court.closing = true;
```

- [ ] **Step 4: Apply this change to `src/ui/LiveScreen.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/LiveScreen.tsx
+++ b/src/ui/LiveScreen.tsx
@@ -124,7 +124,7 @@
                 ? [
                     {
                       label: selected.closing ? `Keep court ${selected.number} open` : `Remove court ${selected.number}`,
-                      onSelect: () => run((s) => engine.removeCourt(s, selected.id)),
+                      onSelect: () => run((s, ctx) => engine.removeCourt(s, selected.id, ctx)),
                     },
                   ]
                 : []),
```

- [ ] **Step 5: Apply this change to `src/engine/courts.test.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/courts.test.ts
+++ b/src/engine/courts.test.ts
@@ -23,32 +23,32 @@
   it('removes an empty court immediately', () => {
     const s = newTestSession(['A', 'B', 'C', 'D'], { courts: 2 });
     const empty = s.courts.find((c) => c.status === 'empty')!;
-    const next = removeCourt(s, empty.id);
+    const next = removeCourt(s, empty.id, makeCtx());
     expect(next.courts).toHaveLength(1);
   });
 
   it('marks a court in play as closing, and a second call cancels it', () => {
     const s = newTestSession(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], { courts: 2 });
-    const closing = removeCourt(s, s.courts[1].id);
+    const closing = removeCourt(s, s.courts[1].id, makeCtx());
     expect(closing.courts).toHaveLength(2);
     expect(closing.courts[1].closing).toBe(true);
-    const reopened = removeCourt(closing, s.courts[1].id);
+    const reopened = removeCourt(closing, s.courts[1].id, makeCtx());
     expect(reopened.courts[1].closing).toBe(false);
   });
 
   it('refuses to remove the last open court', () => {
     const s = newTestSession(['A', 'B', 'C', 'D'], { courts: 1 });
-    expectEngineError(() => removeCourt(s, s.courts[0].id), 'LAST_COURT');
+    expectEngineError(() => removeCourt(s, s.courts[0].id, makeCtx()), 'LAST_COURT');
   });
 
   it('counts closing courts as not open when protecting the last court', () => {
     const s = newTestSession(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], { courts: 2 });
-    const closing = removeCourt(s, s.courts[1].id);
-    expectEngineError(() => removeCourt(closing, closing.courts[0].id), 'LAST_COURT');
+    const closing = removeCourt(s, s.courts[1].id, makeCtx());
+    expectEngineError(() => removeCourt(closing, closing.courts[0].id, makeCtx()), 'LAST_COURT');
   });
 
   it('throws for an unknown court', () => {
     const s = newTestSession(['A'], { courts: 1 });
-    expectEngineError(() => removeCourt(s, 'nope'), 'NOT_FOUND');
+    expectEngineError(() => removeCourt(s, 'nope', makeCtx()), 'NOT_FOUND');
   });
 });
```

- [ ] **Step 6: Apply this change to `src/engine/status.test.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/status.test.ts
+++ b/src/engine/status.test.ts
@@ -103,7 +103,7 @@
     const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
     let s = newTestSession(names, { courts: 2 });
     const court2 = s.courts[1];
-    s = removeCourt(s, court2.id);
+    s = removeCourt(s, court2.id, makeCtx());
     expect(s.courts[1].closing).toBe(true);
     const game = s.courts[1].game!;
     const four = [...game.team1, ...game.team2];
```

- [ ] **Step 7: Apply this change to `src/engine/game.test.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/game.test.ts
+++ b/src/engine/game.test.ts
@@ -48,7 +48,7 @@
     const ctx = makeCtx();
     let s = newTestSession(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], { courts: 2 }, ctx);
     const second = s.courts[1];
-    s = removeCourt(s, second.id);
+    s = removeCourt(s, second.id, makeCtx());
     expect(s.courts[1].closing).toBe(true);
 
     const next = finishGame(s, second.id, makeCtx(3));
```

- [ ] **Step 8: Apply this change to `src/engine/fuzz.test.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/fuzz.test.ts
+++ b/src/engine/fuzz.test.ts
@@ -5,11 +5,12 @@
 import { assertInvariants } from './invariants';
 import { mulberry32 } from './rng';
 import { addPlayer } from './session';
+import { startAllReady, startCourt } from './start';
 import { setPlayerStatus } from './status';
 import { makeCtx, newTestSession } from './testing';
 import type { Mode, PlayerStatus, Session } from './types';
 
-const TOLERATED = new Set(['CANNOT_RETURN', 'LAST_COURT', 'NOT_PLAYING']);
+const TOLERATED = new Set(['CANNOT_RETURN', 'LAST_COURT', 'NOT_PLAYING', 'NOT_READY']);
 const TARGETS: PlayerStatus[] = ['active', 'break', 'left'];
 const STEPS = 250;
 
@@ -17,20 +18,26 @@
   return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
 }
 
-describe.each<Mode>(['fairness', 'queue'])('operation fuzzing (%s mode)', (mode) => {
+// Games start by themselves (a session that does not say, as before) or wait for the organizer's Start.
+describe.each<[Mode, boolean | undefined]>([
+  ['fairness', undefined],
+  ['queue', undefined],
+  ['fairness', false],
+  ['queue', false],
+])('operation fuzzing (%s mode, autoStart %s)', (mode, autoStart) => {
   for (const seed of [1, 2, 3, 4, 5]) {
     it(`keeps every invariant over ${STEPS} random operations (seed ${seed})`, () => {
       const rng = mulberry32(seed);
       const base = makeCtx(seed, 0);
       const names = Array.from({ length: 9 }, (_, i) => `P${i + 1}`);
-      let s: Session = newTestSession(names, { courts: 2, mode }, base);
+      let s: Session = newTestSession(names, { courts: 2, mode, autoStart }, base);
       assertInvariants(s);
       let nextName = names.length + 1;
       let applied = 0;
 
       for (let step = 1; step <= STEPS; step++) {
         const ctx = { ...base, now: step * 60_000 };
-        const kind = Math.floor(rng() * 5);
+        const kind = Math.floor(rng() * 6);
         try {
           switch (kind) {
             case 0: {
@@ -49,8 +56,14 @@
               if (s.courts.length >= 5) continue;
               s = addCourt(s, ctx);
               break;
-            default:
-              s = removeCourt(s, pick(s.courts, rng).id);
+            case 4:
+              s = removeCourt(s, pick(s.courts, rng).id, ctx);
+              break;
+            default: {
+              const ready = s.courts.filter((c) => c.status === 'ready');
+              if (ready.length === 0) continue;
+              s = rng() < 0.5 ? startCourt(s, pick(ready, rng).id, ctx) : startAllReady(s, ctx);
+            }
           }
         } catch (e) {
           if (e instanceof EngineError && TOLERATED.has(e.code)) continue;
```

- [ ] **Step 9: Run the tests**

```bash
npx vitest run src/engine
```

Expected: PASS.

- [ ] **Step 10: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/engine/courts.ts src/ui/LiveScreen.tsx src/engine/courts.test.ts src/engine/status.test.ts src/engine/game.test.ts src/engine/fuzz.test.ts src/engine/readyCourts.test.ts
git commit -m "Remove a Ready court at once and extend the fuzz test to Ready courts"
```

## Task 5: Saved sessions accept Ready courts

The check that decides whether a saved session can be loaded rejects any court whose status it does not know. Without this task, a session with a Ready court would be thrown away, with its undo history, the next time the page reloads.

**Files:**
- Modify: `src/store/persistence.ts`, `src/store/persistence.test.ts`

- [ ] **Step 1: Apply this change to `src/store/persistence.test.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/store/persistence.test.ts
+++ b/src/store/persistence.test.ts
@@ -95,3 +95,44 @@
     expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).undoStack.length).toBeLessThanOrEqual(5);
   });
 });
+
+describe('a session with a Ready court', () => {
+  function ready() {
+    const s = newTestSession(['A', 'B', 'C', 'D', 'E'], { courts: 1, autoStart: false });
+    expect(s.courts[0].status).toBe('ready');
+    return s;
+  }
+
+  it('survives a reload with its lineup, and keeps the setting', () => {
+    const s = ready();
+    expect(savePersisted({ session: s, undoStack: [] })).toBe(true);
+    const loaded = loadPersisted();
+    expect(loaded?.session).toEqual(s);
+    expect(loaded?.session?.autoStart).toBe(false);
+  });
+
+  it('is kept in the undo stack too', () => {
+    const s = ready();
+    savePersisted({ session: s, undoStack: [s] });
+    expect(loadPersisted()?.undoStack).toHaveLength(1);
+  });
+
+  it('is rejected when the Ready court has no valid lineup', () => {
+    const s = ready();
+    const broken = JSON.parse(JSON.stringify(s));
+    delete broken.courts[0].lineup;
+    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, session: broken, undoStack: [] }));
+    expect(loadPersisted()).toBeNull();
+    broken.courts[0].lineup = { team1: ['a'], team2: ['b', 'c'] };
+    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, session: broken, undoStack: [] }));
+    expect(loadPersisted()).toBeNull();
+  });
+
+  it('still rejects a court with an unknown status', () => {
+    const s = ready();
+    const broken = JSON.parse(JSON.stringify(s));
+    broken.courts[0].status = 'paused';
+    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, session: broken, undoStack: [] }));
+    expect(loadPersisted()).toBeNull();
+  });
+});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/store/persistence.test.ts
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 3: Apply this change to `src/store/persistence.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/store/persistence.ts
+++ b/src/store/persistence.ts
@@ -17,14 +17,19 @@
   return isObject(x) && isTeam(x.team1) && isTeam(x.team2) && isNum(x.startedAt);
 }
 
+function isLineup(x: unknown): boolean {
+  return isObject(x) && isTeam(x.team1) && isTeam(x.team2);
+}
+
 function isCourt(x: unknown): boolean {
   return (
     isObject(x) &&
     typeof x.id === 'string' &&
     isNum(x.number) &&
-    (x.status === 'empty' || x.status === 'playing') &&
+    (x.status === 'empty' || x.status === 'ready' || x.status === 'playing') &&
     typeof x.closing === 'boolean' &&
-    (x.status !== 'playing' || isGame(x.game))
+    (x.status !== 'playing' || isGame(x.game)) &&
+    (x.status !== 'ready' || isLineup(x.lineup))
   );
 }
 
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/store
```

Expected: PASS.

- [ ] **Step 5: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/store/persistence.ts src/store/persistence.test.ts
git commit -m "Let saved sessions hold Ready courts"
```

## Task 6: The Ready step on screen

A new session opens with Ready courts. The court card shows who is up next and a lime Start game button; the tab says Ready instead of a clock; the menu can start every Ready court at once; a finished game leaves its court Ready with a toast and Undo; a break on a Ready player is fixed at once. Settings gets "Start the next game by itself" (off). Older tests that are about the live screen keep auto-start on.

**Files:**
- Modify: `prefs.ts`, `SetupScreen.tsx`, `SettingsScreen.tsx`, `CourtCard.tsx`, `CourtTabs.tsx`, `finishMessage.ts`, `WaitingSheet.tsx`, `LiveScreen.tsx`, `app.css` and nine older test files
- Test: `src/ui/readyStep.test.tsx`, `src/ui/finishMessage.test.ts`

- [ ] **Step 1: Create `src/ui/readyStep.test.tsx`**

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import App from './App';

type User = ReturnType<typeof userEvent.setup>;

// No auto-start preference is set here, so these tests run the real default: games wait for Start.
beforeEach(async () => {
  localStorage.clear();
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.fromCharCode(65 + i)}`).join('{enter}');

async function startSession(user: User, count: number) {
  render(<App />);
  await user.type(screen.getByLabelText('Search or add players'), names(count));
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('button', { name: `Start ${count} players` }));
}
const panel = (n = 1) => screen.getByRole('tabpanel', { name: `Court ${n}` });
const startButton = () => within(screen.getByRole('tabpanel')).getByRole('button', { name: /^Start game/ });
const tabs = () => screen.getAllByRole('tab');
const toastEl = () => document.querySelector<HTMLElement>('.toast');
const court = (n: number) => useSessionStore.getState().session!.courts[n - 1];

describe('a new session', () => {
  it('opens with the first game Ready, not running', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    expect(within(panel()).getByText('Next up')).toBeInTheDocument();
    expect(within(panel()).getAllByRole('button', { name: /^P/ })).toHaveLength(4);
    expect(within(panel()).queryByRole('button', { name: /^Game finished/ })).not.toBeInTheDocument();
    expect(startButton()).toBeInTheDocument();
    expect(tabs()[0].textContent).toBe('Court 1Ready');
    expect(tabs()[0]).toHaveClass('is-ready');
    expect(tabs()[0]).not.toHaveClass('is-live');
    expect(court(1).status).toBe('ready');
    expect(court(1).game).toBeUndefined();
  });

  it('records that it waits for Start, so a later change in Settings does not alter it', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    expect(useSessionStore.getState().session!.autoStart).toBe(false);
  });
});

describe('pressing Start', () => {
  it('starts the game with the same four, and the clock runs from that moment', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    const lineup = court(1).lineup!;
    const before = Date.now();
    await user.click(startButton());
    const c = court(1);
    expect(c.status).toBe('playing');
    expect(c.lineup).toBeUndefined();
    expect(c.game!.team1).toEqual(lineup.team1);
    expect(c.game!.team2).toEqual(lineup.team2);
    expect(c.game!.startedAt).toBeGreaterThanOrEqual(before);
    expect(within(panel()).queryByText('Next up')).not.toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: /^Game finished/ })).toBeInTheDocument();
    expect(tabs()[0].textContent).toMatch(/^Court 1\d+:\d\d$/);
  });

  it('is one undo step, back to Ready', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    await user.click(startButton());
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(court(1).status).toBe('ready');
    expect(startButton()).toBeInTheDocument();
  });
});

describe('finishing a game', () => {
  it('makes the court Ready with the next four and says so, with an Undo that restores the game', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    await user.click(startButton());
    const startedAt = court(1).game!.startedAt;
    await user.click(within(panel()).getByRole('button', { name: /^Game finished/ }));
    expect(court(1).status).toBe('ready');
    expect(toastEl()!.textContent).toMatch(/^Court 1 is ready: P\w and P\w vs P\w and P\wUndo$/);
    expect(startButton()).toBeInTheDocument();
    await user.click(within(toastEl()!).getByRole('button', { name: 'Undo' }));
    expect(court(1).status).toBe('playing');
    expect(court(1).game!.startedAt).toBe(startedAt);
  });
});

describe('pressing Start on one of two Ready courts', () => {
  it('starts only that court and leaves the other Ready', async () => {
    const user = userEvent.setup();
    await startSession(user, 8);
    await user.click(startButton());
    expect(court(1).status).toBe('playing');
    expect(court(2).status).toBe('ready');
    expect(tabs()[0]).toHaveClass('is-live');
    expect(tabs()[1]).toHaveClass('is-ready');
  });
});

describe('Start all ready courts', () => {
  it('is offered in the menu once two courts are Ready, and starts them together', async () => {
    const user = userEvent.setup();
    await startSession(user, 8);
    expect(tabs().map((t) => t.textContent)).toEqual(['Court 1Ready', 'Court 2Ready']);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Start all ready courts' }));
    expect(court(1).status).toBe('playing');
    expect(court(2).status).toBe('playing');
    expect(court(1).game!.startedAt).toBe(court(2).game!.startedAt);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.queryByRole('button', { name: 'Start all ready courts' })).not.toBeInTheDocument();
  });

  it('is not offered with only one Ready court', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.queryByRole('button', { name: 'Start all ready courts' })).not.toBeInTheDocument();
  });
});

describe('fixing a no-show before the game starts', () => {
  it('a break on a Ready player takes effect at once and the waiting player steps in', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    const waitingName = within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('button')[0].textContent!.match(/P[A-Z]/)![0];
    const tile = within(panel()).getAllByRole('button', { name: /^P/ })[0];
    const outName = tile.textContent!.match(/P[A-Z]/)![0];
    await user.click(tile);
    await user.click(await screen.findByRole('button', { name: 'Take a break' }));
    const names = within(panel()).getAllByRole('button', { name: /^P/ }).map((b) => b.textContent!.match(/P[A-Z]/)![0]);
    expect(names).toContain(waitingName);
    expect(names).not.toContain(outName);
    const onBreak = within(screen.getByRole('list', { name: 'On break' }));
    expect(onBreak.getAllByRole('listitem')).toHaveLength(1);
    expect(onBreak.getByRole('button').textContent).toContain(outName);
    expect(court(1).status).toBe('ready');
    expect(useSessionStore.getState().session!.players.find((p) => p.name === outName)!.pendingStatus).toBeUndefined();
  });
});

describe('the Waiting sheet', () => {
  it('says the courts are ready when every court holds a lineup and four more are waiting', async () => {
    const user = userEvent.setup();
    await startSession(user, 12);
    expect(screen.getByText('Courts are ready. Press Start.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Start all ready courts' }));
    expect(screen.queryByText('Courts are ready. Press Start.')).not.toBeInTheDocument();
    expect(screen.getByText(/^Next game, court \d$/)).toBeInTheDocument();
  });
});

describe('removing a Ready court', () => {
  it('takes it away at once and the four go back to waiting', async () => {
    const user = userEvent.setup();
    await startSession(user, 8);
    await user.click(tabs()[1]);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Remove court 2' }));
    expect(tabs()).toHaveLength(1);
    expect(within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('listitem')).toHaveLength(4);
  });
});

describe('Settings: Start the next game by itself', () => {
  it('is off by default, remembers a change, and makes new sessions start at once', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    const auto = screen.getByRole('switch', { name: 'Start the next game by itself' });
    expect(auto).not.toBeChecked();
    await user.click(auto);
    expect(localStorage.getItem('pickleball.autoStart')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.type(screen.getByLabelText('Search or add players'), names(5));
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Start 5 players' }));
    await waitFor(() => expect(court(1).status).toBe('playing'));
    expect(within(panel()).getByRole('button', { name: /^Game finished/ })).toBeInTheDocument();
    expect(useSessionStore.getState().session!.autoStart).toBe(true);
  });
});
```

- [ ] **Step 2: Apply this change to `src/ui/finishMessage.test.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/finishMessage.test.ts
+++ b/src/ui/finishMessage.test.ts
@@ -1,5 +1,6 @@
 import { describe, expect, it } from 'vitest';
 import { finishGame } from '../engine/game';
+import { startCourt } from '../engine/start';
 import { makeCtx, mkPlayer, mkSession, newTestSession } from '../engine/testing';
 import { finishMessage } from './finishMessage';
 
@@ -30,3 +31,14 @@
     expect(finishMessage(four, 7)).toBe('Court 7 closed.');
   });
 });
+
+describe('finishMessage for a court that waits for Start', () => {
+  it('names the lineup as ready, not as playing', () => {
+    const ctx = makeCtx();
+    let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve'], { courts: 1, autoStart: false }, ctx);
+    s = startCourt(s, s.courts[0].id, ctx);
+    s = finishGame(s, s.courts[0].id, ctx);
+    expect(s.courts[0].status).toBe('ready');
+    expect(finishMessage(s, 1)).toMatch(/^Court 1 is ready: \w+ and \w+ vs \w+ and \w+$/);
+  });
+});
```

- [ ] **Step 3: Run the tests**

```bash
npx vitest run src/ui/readyStep.test.tsx src/ui/finishMessage.test.ts
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 4: Apply this change to `src/ui/prefs.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/prefs.ts
+++ b/src/ui/prefs.ts
@@ -4,6 +4,7 @@
 export const KEEP_AWAKE_KEY = 'pickleball.keepAwake';
 export const VIBRATE_KEY = 'pickleball.vibrate';
 export const COURTS_KEY = 'pickleball.courts';
+export const AUTO_START_KEY = 'pickleball.autoStart';
 
 const listeners = new Set<() => void>();
 const memory = new Map<string, string>();
```

- [ ] **Step 5: Apply this change to `src/ui/SetupScreen.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/SetupScreen.tsx
+++ b/src/ui/SetupScreen.tsx
@@ -3,7 +3,7 @@
 import { useRosterStore } from '../store/rosterStore';
 import { useSessionStore } from '../store/sessionStore';
 import { getDefaultMode, useDefaultMode } from './matchmaking';
-import { COURTS_KEY, getNumPref, setNumPref } from './prefs';
+import { AUTO_START_KEY, COURTS_KEY, getBoolPref, getNumPref, setNumPref } from './prefs';
 import { PlayerAvatar } from './PlayerAvatar';
 
 const MIN_PLAYERS = 4;
@@ -88,6 +88,7 @@
       name: defaultSessionName(),
       mode: getDefaultMode(),
       courtCount,
+      autoStart: getBoolPref(AUTO_START_KEY, false),
       players: chosen.map((p) => ({ name: p.name, rosterId: p.id })),
     });
     if (res.ok) setNumPref(COURTS_KEY, courtCount);
```

- [ ] **Step 6: Apply this change to `src/ui/SettingsScreen.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/SettingsScreen.tsx
+++ b/src/ui/SettingsScreen.tsx
@@ -4,7 +4,7 @@
 import { useSyncStore } from '../sync/syncStore';
 import { SyncStatusLine } from './SyncStatusLine';
 import { useDefaultMode } from './matchmaking';
-import { KEEP_AWAKE_KEY, useBoolPref, VIBRATE_KEY } from './prefs';
+import { AUTO_START_KEY, KEEP_AWAKE_KEY, useBoolPref, VIBRATE_KEY } from './prefs';
 import { useTheme } from './useTheme';
 
 interface Props {
@@ -20,6 +20,7 @@
   const [mode, setMode] = useDefaultMode();
   const [keepAwake, setKeepAwake] = useBoolPref(KEEP_AWAKE_KEY, true);
   const [vibrate, setVibrate] = useBoolPref(VIBRATE_KEY, true);
+  const [autoStart, setAutoStart] = useBoolPref(AUTO_START_KEY, false);
   const [working, setWorking] = useState(false);
   const [outcome, setOutcome] = useState<{ result: DataResult; done: string } | null>(null);
 
@@ -93,6 +94,11 @@
           <input type="checkbox" role="switch" checked={vibrate} onChange={(e) => setVibrate(e.target.checked)} />
         </label>
         <p className="muted">The buzz only works on phones and browsers that allow it.</p>
+        <label className="switch-row">
+          <span>Start the next game by itself</span>
+          <input type="checkbox" role="switch" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
+        </label>
+        <p className="muted">Off: you press Start for each game, so players have time to reach the court. On: a game starts the moment the last one finishes. It applies to new sessions.</p>
       </section>
 
       <section className="card stack" aria-labelledby="players-title">
```

- [ ] **Step 7: Apply this change to `src/ui/CourtCard.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/CourtCard.tsx
+++ b/src/ui/CourtCard.tsx
@@ -6,12 +6,14 @@
   court: Court;
   playersById: Map<string, Player>;
   onFinish: () => void;
+  onStart: () => void;
   onSelectPlayer: (id: string) => void;
 }
 
-/** The court in focus: who is playing, and the one thing you do every game, finish it. */
-export function CourtCard({ court, playersById, onFinish, onSelectPlayer }: Props) {
+/** The court in focus: who is playing, or who is up next and waiting for Start, and the one thing to do next. */
+export function CourtCard({ court, playersById, onFinish, onStart, onSelectPlayer }: Props) {
   const game = court.game;
+  const lineup = court.lineup;
 
   function team(ids: [string, string], number: 1 | 2) {
     const players = ids.flatMap((id) => playersById.get(id) ?? []);
@@ -37,6 +39,15 @@
           <span className="vs">vs</span>
           {team(game.team2, 2)}
         </div>
+      ) : lineup ? (
+        <>
+          <p className="ready-label">Next up</p>
+          <div className="match">
+            {team(lineup.team1, 1)}
+            <span className="vs">vs</span>
+            {team(lineup.team2, 2)}
+          </div>
+        </>
       ) : (
         <p className="muted court-empty">Waiting for players</p>
       )}
@@ -48,6 +59,12 @@
           Game finished<span className="sr-only"> on court {court.number}</span>
         </button>
       )}
+
+      {lineup && (
+        <button type="button" className="btn btn-live btn-block btn-finish" onClick={onStart}>
+          Start game<span className="sr-only"> on court {court.number}</span>
+        </button>
+      )}
     </section>
   );
 }
```

- [ ] **Step 8: Apply this change to `src/ui/CourtTabs.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/CourtTabs.tsx
+++ b/src/ui/CourtTabs.tsx
@@ -44,11 +44,15 @@
             aria-selected={selected}
             aria-controls={courtPanelId(court.id)}
             tabIndex={selected ? 0 : -1}
-            className={`court-tab${selected ? ' is-selected' : ''}${court.game ? ' is-live' : ''}`}
+            className={`court-tab${selected ? ' is-selected' : ''}${court.game ? ' is-live' : ''}${court.status === 'ready' ? ' is-ready' : ''}`}
             onClick={() => onSelect(court.id)}
           >
             <span className="court-tab-name">Court {court.number}</span>
-            {court.game ? <Timer startedAt={court.game.startedAt} labelled={false} /> : <span className="court-tab-state">Open</span>}
+            {court.game ? (
+              <Timer startedAt={court.game.startedAt} labelled={false} />
+            ) : (
+              <span className="court-tab-state">{court.status === 'ready' ? 'Ready' : 'Open'}</span>
+            )}
           </button>
         );
       })}
```

- [ ] **Step 9: Apply this change to `src/ui/finishMessage.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/finishMessage.ts
+++ b/src/ui/finishMessage.ts
@@ -3,7 +3,7 @@
 
 const join = (names: string[]) => names.join(' and ');
 
-/** What changed on a court after a game finished, written to be read out: the new lineup, or why there is none. */
+/** What changed on a court after a game finished, written to be read out: the new game or the lineup ready to start, or why there is none. */
 export function finishMessage(after: Session, courtNumber: number): string {
   const court = after.courts.find((c) => c.number === courtNumber);
   if (!court) return `Court ${courtNumber} closed.`;
@@ -11,6 +11,9 @@
   if (court.game) {
     return `Court ${courtNumber}: ${join(names(court.game.team1))} vs ${join(names(court.game.team2))}`;
   }
+  if (court.lineup) {
+    return `Court ${courtNumber} is ready: ${join(names(court.lineup.team1))} vs ${join(names(court.lineup.team2))}`;
+  }
   const missing = Math.max(0, 4 - engine.orderedWaiting(after).length);
   return missing > 0
     ? `Court ${courtNumber} finished. Waiting for ${missing} more ${missing === 1 ? 'player' : 'players'}.`
```

- [ ] **Step 10: Apply this change to `src/ui/WaitingSheet.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/WaitingSheet.tsx
+++ b/src/ui/WaitingSheet.tsx
@@ -27,10 +27,15 @@
   const next = engine.previewNext(session);
   const byId = new Map(session.players.map((p) => [p.id, p]));
   const peek = next ? next.playerIds.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])) : waiting.slice(0, 4);
+  // Every open court holding a lineup that has not started: the reason there is no court for the next four.
+  const openCourts = session.courts.filter((c) => !c.closing);
+  const allReady = openCourts.length > 0 && openCourts.every((c) => c.status === 'ready');
   const nextLabel = next
     ? `Next game, court ${next.courtNumber}`
     : waiting.length >= 4
-      ? 'No open court to play on'
+      ? allReady
+        ? 'Courts are ready. Press Start.'
+        : 'No open court to play on'
       : `Need ${4 - waiting.length} more waiting to fill the next game`;
 
   function onKeyDown(event: KeyboardEvent<HTMLElement>) {
```

- [ ] **Step 11: Apply this change to `src/ui/LiveScreen.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/LiveScreen.tsx
+++ b/src/ui/LiveScreen.tsx
@@ -66,6 +66,10 @@
     }
   }
 
+  function startCourt(courtId: string) {
+    run((s, ctx) => engine.startCourt(s, courtId, ctx));
+  }
+
   function undoLast() {
     undo();
     setToast(null);
@@ -80,6 +84,7 @@
   }
 
   const sorted = [...session.courts].sort((a, b) => a.number - b.number);
+  const readyCount = sorted.filter((c) => c.status === 'ready').length;
   // A court that is gone (removed once its game ended) falls back to the first one.
   const selected = sorted.find((c) => c.id === courtId) ?? sorted[0];
 
@@ -119,6 +124,7 @@
           <LiveMenu
             items={[
               { label: 'Add player', onSelect: openAdd },
+              ...(readyCount >= 2 ? [{ label: 'Start all ready courts', onSelect: () => run((s, ctx) => engine.startAllReady(s, ctx)) }] : []),
               { label: 'Add court', onSelect: () => run((s, ctx) => engine.addCourt(s, ctx)) },
               ...(selected
                 ? [
@@ -150,6 +156,7 @@
                   court={selected}
                   playersById={playersById}
                   onFinish={() => finishCourt(selected.id, selected.number)}
+                  onStart={() => startCourt(selected.id)}
                   onSelectPlayer={selectPlayer}
                 />
               </div>
```

- [ ] **Step 12: Add this to the end of `src/styles/app.css`**

```css

/* ---------- Ready step ---------- */
.ready-label {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.court-tab.is-ready .court-tab-state {
  color: var(--ink);
  font-weight: 800;
}
```

- [ ] **Step 13: Apply this change to `src/ui/App.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/App.test.tsx
+++ b/src/ui/App.test.tsx
@@ -14,6 +14,7 @@
 
 beforeEach(async () => {
   localStorage.clear();
+  localStorage.setItem('pickleball.autoStart', 'true'); // these tests are about the live screen, not the Ready step
   delete document.documentElement.dataset.theme;
   useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
   useUpdateStore.setState({ ready: false, apply: null });
```

- [ ] **Step 14: Apply this change to `src/ui/liveScreen.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/liveScreen.test.tsx
+++ b/src/ui/liveScreen.test.tsx
@@ -13,6 +13,7 @@
 
 beforeEach(async () => {
   localStorage.clear();
+  localStorage.setItem('pickleball.autoStart', 'true'); // these tests are about the live screen, not the Ready step
   useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
   useUpdateStore.setState({ ready: false, apply: null });
   await resetRosterDbForTests();
```

- [ ] **Step 15: Apply this change to `src/ui/managePlayers.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/managePlayers.test.tsx
+++ b/src/ui/managePlayers.test.tsx
@@ -8,6 +8,7 @@
 
 beforeEach(async () => {
   localStorage.clear();
+  localStorage.setItem('pickleball.autoStart', 'true'); // these tests are about the live screen, not the Ready step
   useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
   await resetRosterDbForTests();
   useRosterStore.setState({ players: [], loaded: false });
```

- [ ] **Step 16: Apply this change to `src/ui/liveToast.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/liveToast.test.tsx
+++ b/src/ui/liveToast.test.tsx
@@ -10,6 +10,7 @@
 
 beforeEach(async () => {
   localStorage.clear();
+  localStorage.setItem('pickleball.autoStart', 'true'); // these tests are about the live screen, not the Ready step
   useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
   await resetRosterDbForTests();
   useRosterStore.setState({ players: [], loaded: false });
```

- [ ] **Step 17: Apply this change to `src/ui/addPlayerButton.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/addPlayerButton.test.tsx
+++ b/src/ui/addPlayerButton.test.tsx
@@ -10,6 +10,7 @@
 
 beforeEach(async () => {
   localStorage.clear();
+  localStorage.setItem('pickleball.autoStart', 'true'); // these tests are about the live screen, not the Ready step
   useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
   await resetRosterDbForTests();
   useRosterStore.setState({ players: [], loaded: false });
```

- [ ] **Step 18: Apply this change to `src/ui/sessionPrefs.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/sessionPrefs.test.tsx
+++ b/src/ui/sessionPrefs.test.tsx
@@ -8,6 +8,7 @@
 
 beforeEach(async () => {
   localStorage.clear();
+  localStorage.setItem('pickleball.autoStart', 'true'); // these tests are about the live screen, not the Ready step
   useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
   await resetRosterDbForTests();
   useRosterStore.setState({ players: [], loaded: false });
```

- [ ] **Step 19: Apply this change to `src/ui/photos.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/photos.test.tsx
+++ b/src/ui/photos.test.tsx
@@ -20,6 +20,7 @@
 
 beforeEach(async () => {
   localStorage.clear();
+  localStorage.setItem('pickleball.autoStart', 'true'); // these tests are about the live screen, not the Ready step
   useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
   useUpdateStore.setState({ ready: false, apply: null });
   await resetRosterDbForTests();
```

- [ ] **Step 20: Apply this change to `src/ui/sessionConflict.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/sessionConflict.test.tsx
+++ b/src/ui/sessionConflict.test.tsx
@@ -10,6 +10,7 @@
 
 beforeEach(async () => {
   localStorage.clear();
+  localStorage.setItem('pickleball.autoStart', 'true'); // these tests are about the live screen, not the Ready step
   useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
   await resetRosterDbForTests();
   useRosterStore.setState({ players: [], loaded: false });
```

- [ ] **Step 21: Apply this change to `src/ui/whyWaiting.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/whyWaiting.test.tsx
+++ b/src/ui/whyWaiting.test.tsx
@@ -10,6 +10,7 @@
 
 beforeEach(async () => {
   localStorage.clear();
+  localStorage.setItem('pickleball.autoStart', 'true'); // these tests are about the live screen, not the Ready step
   useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
   await resetRosterDbForTests();
   useRosterStore.setState({ players: [], loaded: false });
```

- [ ] **Step 22: Run the tests**

```bash
npx vitest run src/ui
```

Expected: PASS.

- [ ] **Step 23: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/ui/prefs.ts src/ui/SetupScreen.tsx src/ui/SettingsScreen.tsx src/ui/CourtCard.tsx src/ui/CourtTabs.tsx src/ui/finishMessage.ts src/ui/WaitingSheet.tsx src/ui/LiveScreen.tsx src/styles/app.css src/ui/readyStep.test.tsx src/ui/finishMessage.test.ts src/ui/App.test.tsx src/ui/liveScreen.test.tsx src/ui/managePlayers.test.tsx src/ui/liveToast.test.tsx src/ui/addPlayerButton.test.tsx src/ui/sessionPrefs.test.tsx src/ui/photos.test.tsx src/ui/sessionConflict.test.tsx src/ui/whyWaiting.test.tsx
git commit -m "Show the Ready step on the court card with a Start button, and add the auto-start setting"
```

## Task 7: Check it at phone width and on a phone, then merge

- [ ] **Step 1: Build and look at it at 360 by 780**

```bash
npm run build
```

Expected: clean build. In a browser at 360 by 780: start a session from a saved roster of eight or more players and check the courts open Ready ("Next up", a lime Start game button, the tab says Ready), press Start on one court and see the clock run and Game finished appear, finish it and see the toast say the court is ready, open the menu and use Start all ready courts, tap a player on a Ready court and take a break to see the next waiting player step in at once, and with every court Ready check the Waiting sheet says "Courts are ready. Press Start."

- [ ] **Step 2: Run the Ralph loop** on the finished change (tests, build, the checks above), and fix what it finds.

- [ ] **Step 3: Merge to production** after the owner says go: push `photos`, then fast-forward `claude/pickleball-matchmaking-app-i4baca`, as in earlier phases.

- [ ] **Step 4: Check on the owner's phone.** At the courts: a session opens Ready; Start begins a game and the clock; finishing leaves the court Ready; a missing player is taken out before Start; Start all ready courts; the Settings switch to start games by itself. Not verifiable without a phone: whether the extra tap per game feels right when courts finish together.

- [ ] **Step 5: Todoist.** Complete the Phase 2a plan task and add a task for the phone check, with the list above.

## Self-review

- **Spec coverage (2a):** Ready courts and reservation, Task 2. Break or leave on a Ready lineup, Task 3. Removing a Ready court, Task 4. The saved-session check, Task 5. The court card, tab, Start all, toast and Waiting sheet label, the Auto-start setting and the first games opening Ready, Task 6. Ending a session with a Ready lineup is covered in Task 4 (nothing is recorded, invariants hold).
- **One change from the spec wording:** ending a session leaves Ready lineups as they are instead of dropping them. Releasing them would leave an empty court with four or more waiting, which the engine's own rule forbids, and the summary only shows finished games.
- **Equivalent mutation:** one engine breakage survives because it changes nothing observable: the `status !== 'ready'` half of the guard in `start.ts` (a lineup only exists on a Ready court, which the invariants enforce).
- **Placeholders:** none. Every step has its code or diff.
- **Names:** `lineupIds`, `releaseLineup`, `reservedIds`, `startCourt`, `startAllReady`, `AUTO_START_KEY` are defined once and used by the same names.
