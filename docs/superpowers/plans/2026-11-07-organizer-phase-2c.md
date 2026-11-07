# PIKLMatch Phase 2c: control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the organizer fix real life without breaking the fairness numbers: swap a player in or out (before a game starts or during one), mark a player not here, put a waiting player at the front of the line, and send one to the back for a turn. Every action is one Undo step and says what it did.

**Architecture:** `Session` gains an optional `pinned` list (waiting players asked to play next). `orderedWaiting` puts them first, and every place that places a player on a court, or takes a player out of the waiting list, drops them from it. `swapPlayers` trades two players' places and `notHere` composes a swap and a break. Two read-only helpers (`locatePlayer`, `swapCandidates`) feed a picker in the player sheet. Games are still credited to whoever is on court when they finish.

**Tech Stack:** React 18, TypeScript, Zustand, Vitest with Testing Library, Vite. No new dependencies.

Spec: `docs/superpowers/specs/2026-11-07-organizer-experience-phases.md`, Phase 2, Part 2c.

**Choices made in this plan.**
- **Skip in fairness mode** only reorders players with the same number of games, as the spec says. The skipped player goes last among an exact tie too, by nudging their random tie key.
- **A swapped-off player with a pending break or leave** gets it applied at once, because they are no longer in the game it was waiting for.
- **Swapping two players on the same team** is refused as pointless. Swapping a waiting player with another waiting player is refused: their order is the line.
- **Not here with nobody waiting** is refused with "No one is waiting to take their place." and changes nothing.
- **The "Next" tag** shows in the waiting list only. The preview faces already show pinned players first, so they need no extra mark.

**How the code in this plan was proved.** Every file and diff below was built once in a scratch copy of the repository at commit `7520393`, with the full suite passing (801 tests, up from 726, three runs in a row) and mutation-checked (21 deliberate breakages, all caught; one equivalent breakage was removed by simplifying the code). The random-operations test ran 150 seeds of 400 steps on the finished engine. The player sheet and the picker were looked at in a browser at 360 by 780. Apply a diff from the project root with `patch -p1 < the-diff-file`, or by hand: each hunk shows its context.

**Conventions.** Run commands from `pickleball-match-app/` (the folder with `package.json`). Stage files by name, never with `git add -A`. No AI attribution lines in commit messages. After the last task, run the Ralph loop before merging.

---
## Task 1: Play next and skip a turn in the engine

A waiting player can be put at the front of the line ("play next") or sent to the back for a turn ("skip"). The list of players asked to play next is part of the session, is respected by every place that fills a court, and is dropped when a player is placed, goes on a break or leaves. The random-operations test in Task 3 found one place that forgot (a break in a Ready lineup bringing in a player who had been asked to play next); it is fixed here and has its own test.

**Files:**
- Create: `src/engine/pins.ts`
- Modify: `src/engine/types.ts`, `errors.ts`, `pool.ts`, `fill.ts`, `status.ts`, `explain.ts`, `invariants.ts`, `index.ts`, `src/store/persistence.ts`, `src/store/persistence.test.ts`, `src/engine/readyStatus.test.ts`
- Test: `src/engine/pins.test.ts`

- [ ] **Step 1: Create `src/engine/pins.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { finishGame } from './game';
import { mkPlayer, mkSession } from './fixtures';
import { assertInvariants } from './invariants';
import { explainWaiting } from './explain';
import { playNext, skipTurn } from './pins';
import { orderedWaiting } from './pool';
import { startAllReady } from './start';
import { setPlayerStatus } from './status';
import { expectEngineError, idOf, makeCtx, newTestSession } from './testing';
import type { Mode } from './types';

const NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
/** Four on court 1, five waiting (E to I). */
const nine = (mode: Mode = 'fairness', autoStart?: boolean) => newTestSession(NAMES, { courts: 1, mode, autoStart });
const waitingNames = (s: ReturnType<typeof nine>) => orderedWaiting(s).map((p) => p.name);

describe.each<Mode>(['fairness', 'queue'])('playNext (%s mode)', (mode) => {
  it('puts a waiting player at the front of the line', () => {
    const s = nine(mode);
    const last = waitingNames(s).at(-1)!;
    const next = playNext(s, idOf(s, last));
    expect(waitingNames(next)[0]).toBe(last);
    expect(next.pinned).toEqual([idOf(s, last)]);
    assertInvariants(next);
  });

  it('keeps several players in the order they were asked', () => {
    let s = nine(mode);
    const [a, b, c, d, e] = waitingNames(s);
    s = playNext(s, idOf(s, e));
    s = playNext(s, idOf(s, c));
    expect(waitingNames(s).slice(0, 2)).toEqual([e, c]);
    expect(waitingNames(s).slice(2)).toEqual([a, b, d]);
    assertInvariants(s);
  });

  it('does nothing when asked twice', () => {
    let s = nine(mode);
    const id = idOf(s, waitingNames(s)[3]);
    s = playNext(s, id);
    expect(playNext(s, id)).toEqual(s);
  });

  it('changes nobody’s games or counts, and not the input', () => {
    const s = nine(mode);
    const before = JSON.stringify(s);
    const next = playNext(s, idOf(s, waitingNames(s)[4]));
    expect(next.players).toEqual(s.players);
    expect(next.courts).toEqual(s.courts);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('is for waiting players only', () => {
    const s = nine(mode);
    const playing = s.courts[0].game!.team1[0];
    expectEngineError(() => playNext(s, playing), 'NOT_WAITING'); // in a game
    const waiting = idOf(s, waitingNames(s)[0]);
    const onBreak = setPlayerStatus(s, waiting, 'break', makeCtx());
    expectEngineError(() => playNext(onBreak, waiting), 'NOT_WAITING');
    const left = setPlayerStatus(s, waiting, 'left', makeCtx());
    expectEngineError(() => playNext(left, waiting), 'NOT_WAITING');
    expectEngineError(() => playNext(s, 'nobody'), 'NOT_FOUND');
  });

  it('puts them on the next court, and the list is gone once they are placed', () => {
    let s = nine(mode);
    const chosen = waitingNames(s).at(-1)!;
    s = playNext(s, idOf(s, chosen));
    s = finishGame(s, s.courts[0].id, makeCtx(1, 60_000));
    const game = s.courts[0].game!;
    const names = [...game.team1, ...game.team2].map((id) => s.players.find((p) => p.id === id)!.name);
    expect(names).toContain(chosen);
    expect(s.pinned).toBeUndefined();
    assertInvariants(s);
  });

  it('puts them in a Ready lineup the same way', () => {
    let s = startAllReady(nine(mode, false), makeCtx(1, 1_000));
    const chosen = waitingNames(s).at(-1)!;
    s = playNext(s, idOf(s, chosen));
    s = finishGame(s, s.courts[0].id, makeCtx(1, 60_000));
    expect(s.courts[0].status).toBe('ready');
    const lineup = [...s.courts[0].lineup!.team1, ...s.courts[0].lineup!.team2];
    expect(lineup).toContain(idOf(s, chosen));
    expect(s.pinned).toBeUndefined();
    assertInvariants(s);
  });

  it('with more than four asked, the first four play and the rest stay asked', () => {
    let s = nine(mode);
    const ids = waitingNames(s).map((n) => idOf(s, n));
    for (const id of ids) s = playNext(s, id);
    s = finishGame(s, s.courts[0].id, makeCtx(1, 60_000));
    const playing = [...s.courts[0].game!.team1, ...s.courts[0].game!.team2];
    expect(playing.sort()).toEqual(ids.slice(0, 4).sort());
    expect(s.pinned).toEqual([ids[4]]);
    assertInvariants(s);
  });

  it('is dropped when the player goes on a break or leaves', () => {
    let s = nine(mode);
    const id = idOf(s, waitingNames(s)[2]);
    s = playNext(s, id);
    const onBreak = setPlayerStatus(s, id, 'break', makeCtx());
    expect(onBreak.pinned).toBeUndefined();
    assertInvariants(onBreak);
    const left = setPlayerStatus(s, id, 'left', makeCtx());
    expect(left.pinned).toBeUndefined();
    assertInvariants(left);
  });

  it('does not change a lineup that is already Ready', () => {
    let s = nine(mode, false);
    const lineup = JSON.stringify(s.courts[0].lineup);
    s = playNext(s, idOf(s, waitingNames(s).at(-1)!));
    expect(JSON.stringify(s.courts[0].lineup)).toBe(lineup);
    assertInvariants(s);
  });
});

describe('skipTurn', () => {
  it('moves a waiting player to the back among players with the same number of games, in fairness mode', () => {
    const players = ['a', 'b', 'c', 'd', 'e'].map((id, i) => mkPlayer(id, { gamesPlayed: 1, lastFinishedSeq: 3, tieKey: (i + 1) / 10 }));
    let s = mkSession(players, { gameSeq: 3 });
    expect(orderedWaiting(s).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    s = skipTurn(s, 'a');
    expect(orderedWaiting(s).map((p) => p.id)).toEqual(['b', 'c', 'd', 'e', 'a']);
    assertInvariants(s);
  });

  it('goes behind someone who finished a game just now, even with the same games', () => {
    const s = mkSession(
      [mkPlayer('a', { gamesPlayed: 1, lastFinishedSeq: 1 }), mkPlayer('b', { gamesPlayed: 1, lastFinishedSeq: 9 }), mkPlayer('c', { gamesPlayed: 1, lastFinishedSeq: 5 }), mkPlayer('d', { gamesPlayed: 1, lastFinishedSeq: 7 })],
      { gameSeq: 9 },
    );
    expect(orderedWaiting(skipTurn(s, 'a')).map((p) => p.id).at(-1)).toBe('a');
  });

  it('cannot put anyone behind players with more games, so fairness still owes them a game', () => {
    const s = mkSession(
      [mkPlayer('a', { gamesPlayed: 0 }), mkPlayer('b', { gamesPlayed: 1 }), mkPlayer('c', { gamesPlayed: 2 }), mkPlayer('d', { gamesPlayed: 2 })],
      { gameSeq: 4 },
    );
    const skipped = skipTurn(s, 'a');
    expect(orderedWaiting(skipped).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(skipped.players.find((p) => p.id === 'a')!.gamesPlayed).toBe(0);
  });

  it('moves a player to the back of the queue, in queue mode', () => {
    const s = mkSession(['a', 'b', 'c', 'd', 'e'].map((id) => mkPlayer(id)), { mode: 'queue' });
    expect(orderedWaiting(skipTurn(s, 'a')).map((p) => p.id)).toEqual(['b', 'c', 'd', 'e', 'a']);
    expect(orderedWaiting(skipTurn(s, 'c')).map((p) => p.id)).toEqual(['a', 'b', 'd', 'e', 'c']);
  });

  it('takes the player off the play next list', () => {
    let s = nine();
    const id = idOf(s, waitingNames(s)[3]);
    s = playNext(s, id);
    s = skipTurn(s, id);
    expect(s.pinned).toBeUndefined();
    expect(waitingNames(s).at(-1)).toBe(s.players.find((p) => p.id === id)!.name);
    assertInvariants(s);
  });

  it('is for waiting players only, and does not change the input', () => {
    const s = nine();
    expectEngineError(() => skipTurn(s, s.courts[0].game!.team1[0]), 'NOT_WAITING');
    expectEngineError(() => skipTurn(s, 'nobody'), 'NOT_FOUND');
    const before = JSON.stringify(s);
    skipTurn(s, idOf(s, waitingNames(s)[0]));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('explaining a place that was moved', () => {
  it('says you are playing next, and says someone was moved for the players behind', () => {
    let s = nine();
    const names = waitingNames(s);
    s = playNext(s, idOf(s, names[4]));
    expect(explainWaiting(s, idOf(s, names[4]))).toEqual({ position: 1, reason: 'You are playing next.' });
    expect(explainWaiting(s, idOf(s, names[0]))).toEqual({ position: 2, reason: 'Someone was moved to play next.' });
  });

  it('does the same in queue mode', () => {
    let s = nine('queue');
    const names = waitingNames(s);
    s = playNext(s, idOf(s, names[3]));
    expect(explainWaiting(s, idOf(s, names[3]))?.reason).toBe('You are playing next.');
    expect(explainWaiting(s, idOf(s, names[0]))?.reason).toBe('Someone was moved to play next.');
  });

  it('puts the moved player second behind another moved player', () => {
    let s = nine();
    const names = waitingNames(s);
    s = playNext(s, idOf(s, names[4]));
    s = playNext(s, idOf(s, names[2]));
    expect(explainWaiting(s, idOf(s, names[2]))).toEqual({ position: 2, reason: 'You are playing next.' });
    expect(explainWaiting(s, idOf(s, names[0]))).toEqual({ position: 3, reason: 'Someone was moved to play next.' });
  });
});

describe('the invariants know about players asked to play next', () => {
  const broken = (change: (s: ReturnType<typeof nine>) => void) => {
    const s = nine();
    change(s);
    return () => assertInvariants(s);
  };

  it('reject a pinned player who is not waiting', () => {
    expect(broken((s) => (s.pinned = [s.courts[0].game!.team1[0]]))).toThrow();
  });

  it('reject a player pinned twice, and an empty list left behind', () => {
    expect(broken((s) => (s.pinned = [s.queueOrder[0], s.queueOrder[0]]))).toThrow();
    expect(broken((s) => (s.pinned = []))).toThrow();
  });

  it('accept a healthy list', () => {
    expect(broken((s) => (s.pinned = [s.queueOrder[0]]))).not.toThrow();
  });
});
```

- [ ] **Step 2: Apply this change to `src/engine/readyStatus.test.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/readyStatus.test.ts
+++ b/src/engine/readyStatus.test.ts
@@ -1,6 +1,7 @@
 import { describe, expect, it } from 'vitest';
 import { assertInvariants } from './invariants';
 import { lineupIds } from './lineup';
+import { playNext } from './pins';
 import { orderedWaiting } from './pool';
 import { startAllReady } from './start';
 import { setPlayerStatus } from './status';
@@ -64,3 +65,15 @@
     assertInvariants(s);
   });
 });
+
+describe('a break on a Ready lineup when someone was asked to play next', () => {
+  it('brings that player in first, and takes them off the play next list', () => {
+    let s = hold(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
+    const chosen = orderedWaiting(s)[2].id;
+    s = playNext(s, chosen);
+    s = setPlayerStatus(s, lineupIds(s.courts[0])[0], 'break', makeCtx());
+    expect(lineupIds(s.courts[0])).toContain(chosen);
+    expect(s.pinned).toBeUndefined();
+    assertInvariants(s);
+  });
+});
```

- [ ] **Step 3: Apply this change to `src/store/persistence.test.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/store/persistence.test.ts
+++ b/src/store/persistence.test.ts
@@ -166,3 +166,19 @@
     }
   });
 });
+
+describe('a session with players asked to play next', () => {
+  it('survives a reload, and a malformed list is rejected', () => {
+    const s = newTestSession(['A', 'B', 'C', 'D', 'E', 'F'], { courts: 1 }, makeCtx());
+    const waiting = s.queueOrder[0];
+    s.pinned = [waiting];
+    savePersisted({ session: s, undoStack: [] });
+    expect(loadPersisted()?.session).toEqual(s);
+    for (const bad of ['E', [1, 2], { a: 1 }]) {
+      const broken = JSON.parse(JSON.stringify(s));
+      broken.pinned = bad;
+      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, session: broken, undoStack: [] }));
+      expect(loadPersisted()).toBeNull();
+    }
+  });
+});
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/engine/pins.test.ts src/engine/readyStatus.test.ts src/store/persistence.test.ts
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 5: Create `src/engine/pins.ts`**

```ts
import { cloneSession } from './clone';
import { EngineError } from './errors';
import { availablePlayers, playerById } from './pool';
import type { PlayerId, Session } from './types';

/** Takes players off the "play next" list. MUTATES `s`: callers must pass a clone. */
export function unpin(s: Session, ids: PlayerId[]): void {
  if (!s.pinned) return;
  const rest = s.pinned.filter((id) => !ids.includes(id));
  if (rest.length > 0) s.pinned = rest;
  else delete s.pinned;
}

function requireWaiting(s: Session, playerId: PlayerId): void {
  const p = playerById(s, playerId);
  if (!availablePlayers(s).some((q) => q.id === playerId)) {
    throw new EngineError('NOT_WAITING', `${p.name} is not waiting, so this does not apply.`);
  }
}

/**
 * Puts a waiting player at the front of the line, behind anyone already asked to play next. It lasts until they are
 * placed on a court, go on a break or leave. It works in both modes, and does not change anyone's games.
 */
export function playNext(s: Session, playerId: PlayerId): Session {
  const n = cloneSession(s);
  requireWaiting(n, playerId);
  if (n.pinned?.includes(playerId)) return n;
  n.pinned = [...(n.pinned ?? []), playerId];
  return n;
}

/**
 * Passes a waiting player over for this turn: they go to the back of the line. In fairness mode that only reorders
 * players with the same number of games, because fewest games always comes first, so nobody can be cheated out of a
 * game. Takes them off the "play next" list too.
 */
export function skipTurn(s: Session, playerId: PlayerId): Session {
  const n = cloneSession(s);
  requireWaiting(n, playerId);
  const me = playerById(n, playerId);
  unpin(n, [playerId]);

  const others = availablePlayers(n).filter((p) => p.id !== playerId && p.gamesPlayed === me.gamesPlayed);
  // As if they had just finished a game: nobody can have finished later, so they are last among the same games, and
  // last among an exact tie too.
  me.lastFinishedSeq = n.gameSeq;
  const tied = others.filter((p) => p.lastFinishedSeq === me.lastFinishedSeq);
  if (tied.length > 0) me.tieKey = Math.max(me.tieKey, ...tied.map((p) => p.tieKey)) + 0.001;

  n.queueOrder = [...n.queueOrder.filter((id) => id !== playerId), playerId];
  return n;
}
```

- [ ] **Step 6: Apply this change to `src/engine/errors.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/errors.ts
+++ b/src/engine/errors.ts
@@ -7,6 +7,7 @@
   | 'NOT_PLAYING'
   | 'NOT_READY'
   | 'INVALID_RESULT'
+  | 'NOT_WAITING'
   | 'CANNOT_RETURN';
 
 export class EngineError extends Error {
```

- [ ] **Step 7: Apply this change to `src/engine/index.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/index.ts
+++ b/src/engine/index.ts
@@ -14,3 +14,4 @@
 export type { WaitingExplanation } from './explain';
 export { summarize, formatSummaryText, sessionStats, formatDuration, fairnessLine, gameLog, hasResults } from './summary';
 export type { PlayerSummary, SessionStats, GameLogEntry, WinLoss } from './summary';
+export { playNext, skipTurn } from './pins';
```

- [ ] **Step 8: Apply this change to `src/engine/types.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -80,6 +80,8 @@
    * how sessions saved before the Ready step behave.
    */
   autoStart?: boolean;
+  /** Waiting players the organizer asked to play next, in the order they were asked. Always players who are waiting. */
+  pinned?: PlayerId[];
 }
 
 /** Everything non-deterministic is injected so tests can control it. */
```

- [ ] **Step 9: Apply this change to `src/engine/pool.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/pool.ts
+++ b/src/engine/pool.ts
@@ -42,17 +42,27 @@
 }
 
 /**
- * Available players in the order they will be picked.
- * Fairness mode: by priority. Queue mode: FIFO by queueOrder.
+ * Available players in the order they will be picked: the ones the organizer asked to play next first, in the order
+ * they were asked, then everyone else. Fairness mode orders the rest by priority, queue mode by arrival.
  */
 export function orderedWaiting(s: Session): Player[] {
   const pool = availablePlayers(s);
-  if (s.mode === 'fairness') return [...pool].sort(compareByPriority);
-  const byId = new Map(pool.map((p) => [p.id, p]));
-  return s.queueOrder.flatMap((id) => {
-    const p = byId.get(id);
-    return p ? [p] : [];
-  });
+  let rest: Player[];
+  if (s.mode === 'fairness') {
+    rest = [...pool].sort(compareByPriority);
+  } else {
+    const byId = new Map(pool.map((p) => [p.id, p]));
+    rest = s.queueOrder.flatMap((id) => {
+      const p = byId.get(id);
+      return p ? [p] : [];
+    });
+  }
+  const asked = s.pinned ?? [];
+  if (asked.length === 0) return rest;
+  const byId = new Map(rest.map((p) => [p.id, p]));
+  const first = asked.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
+  const firstIds = new Set(first.map((p) => p.id));
+  return [...first, ...rest.filter((p) => !firstIds.has(p.id))];
 }
 
 /** Floor of the average gamesPlayed of active players (optionally excluding one). */
```

- [ ] **Step 10: Apply this change to `src/engine/fill.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/fill.ts
+++ b/src/engine/fill.ts
@@ -1,3 +1,4 @@
+import { unpin } from './pins';
 import { orderedWaiting } from './pool';
 import { bestSplit } from './selection';
 import type { Ctx, Session, Team } from './types';
@@ -32,5 +33,6 @@
       court.game = { team1, team2, startedAt: ctx.now };
     }
     s.queueOrder = s.queueOrder.filter((id) => !ids.includes(id));
+    unpin(s, ids);
   }
 }
```

- [ ] **Step 11: Apply this change to `src/engine/status.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/status.ts
+++ b/src/engine/status.ts
@@ -1,6 +1,7 @@
 import { cloneSession } from './clone';
 import { EngineError } from './errors';
 import { fillCourts } from './fill';
+import { unpin } from './pins';
 import { lineupIds, releaseLineup } from './lineup';
 import { lateArrivalGames, onCourtIds, orderedWaiting, playerById } from './pool';
 import type { Ctx, PlayerId, PlayerStatus, Session } from './types';
@@ -41,6 +42,7 @@
   }
 
   if (p.status === 'left' || p.status === target) return n;
+  unpin(n, [p.id]);
 
   if (onCourtIds(n).has(p.id)) {
     p.pendingStatus = target;
@@ -58,6 +60,7 @@
       ];
       readyCourt.lineup = { team1: swap(readyCourt.lineup.team1), team2: swap(readyCourt.lineup.team2) };
       n.queueOrder = n.queueOrder.filter((id) => id !== replacement.id);
+      unpin(n, [replacement.id]);
     } else {
       releaseLineup(n, readyCourt, p.id);
     }
```

- [ ] **Step 12: Apply this change to `src/engine/explain.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/explain.ts
+++ b/src/engine/explain.ts
@@ -25,6 +25,12 @@
     return { position, reason: `Waiting for ${plural(4 - waiting.length, 'more player')} to start a game.` };
   }
 
+  if (s.pinned?.includes(playerId)) return { position, reason: 'You are playing next.' };
+  // Everyone behind a player who was asked to play next is there because of that, whatever the mode.
+  if (position > 1 && s.pinned?.includes(waiting[index - 1].id)) {
+    return { position, reason: 'Someone was moved to play next.' };
+  }
+
   if (s.mode === 'queue') {
     return { position, reason: position === 1 ? 'Next in the order people arrived.' : 'In the order people arrived.' };
   }
```

- [ ] **Step 13: Apply this change to `src/engine/invariants.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/invariants.ts
+++ b/src/engine/invariants.ts
@@ -40,6 +40,12 @@
     }
   }
 
+  // Everyone asked to play next is waiting, once, and the list is dropped when it is empty.
+  const asked = s.pinned ?? [];
+  expect(new Set(asked).size).toBe(asked.length);
+  for (const id of asked) expect(waiting).toContain(id);
+  if (s.pinned) expect(s.pinned.length).toBeGreaterThan(0);
+
   // Court numbers are unique, and a closing court is always mid-game.
   const numbers = s.courts.map((c) => c.number);
   expect(new Set(numbers).size).toBe(numbers.length);
```

- [ ] **Step 14: Apply this change to `src/store/persistence.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/store/persistence.ts
+++ b/src/store/persistence.ts
@@ -75,7 +75,8 @@
     Array.isArray(x.history) &&
     x.history.every(isFinishedGame) &&
     isNum(x.gameSeq) &&
-    isNum(x.createdAt)
+    isNum(x.createdAt) &&
+    (x.pinned === undefined || (Array.isArray(x.pinned) && x.pinned.every((id) => typeof id === 'string')))
   );
 }
 
```

- [ ] **Step 15: Run the tests**

```bash
npx vitest run src/engine src/store
```

Expected: PASS.

- [ ] **Step 16: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/engine/pins.ts src/engine/pins.test.ts src/engine/errors.ts src/engine/index.ts src/engine/readyStatus.test.ts src/store/persistence.test.ts src/engine/types.ts src/engine/pool.ts src/engine/fill.ts src/engine/status.ts src/engine/explain.ts src/engine/invariants.ts src/store/persistence.ts
git commit -m "Add play next and skip turn to the engine"
```

## Task 2: Swap two players, and Not here

Two players can trade places: a waiting player with someone in a Ready lineup or a running game, or two players on courts. A game credits whoever is on court when it finishes, so a substitute is credited and the player taken off is not. Not here swaps the next waiting player in and puts the absent one on a break, as one step. Two helpers say where a player is and who they could swap with.

**Files:**
- Create: `src/engine/locate.ts`, `src/engine/swap.ts`
- Modify: `src/engine/errors.ts`, `src/engine/index.ts`
- Test: `src/engine/swap.test.ts`

- [ ] **Step 1: Create `src/engine/swap.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { finishGame } from './game';
import { assertInvariants } from './invariants';
import { lineupIds } from './lineup';
import { locatePlayer, swapCandidates } from './locate';
import { playNext } from './pins';
import { orderedWaiting } from './pool';
import { startAllReady, startCourt } from './start';
import { setPlayerStatus } from './status';
import { notHere, swapPlayers } from './swap';
import { expectEngineError, makeCtx, newTestSession } from './testing';
import type { Mode, Session } from './types';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `P${i + 1}`);
/** One court with a Ready lineup and `extra` players waiting. */
const ready = (extra: number, mode: Mode = 'fairness') => newTestSession(ids(4 + extra), { courts: 1, mode, autoStart: false });
/** Same, with the game started. */
const playing = (extra: number, mode: Mode = 'fairness') => startAllReady(ready(extra, mode), makeCtx(1, 1_000));
const firstWaiting = (s: Session) => orderedWaiting(s)[0].id;
const courtIds = (s: Session, i = 0) => (s.courts[i].game ? [...s.courts[i].game!.team1, ...s.courts[i].game!.team2] : lineupIds(s.courts[i]));

describe.each<Mode>(['fairness', 'queue'])('swapping a waiting player onto a Ready lineup (%s mode)', (mode) => {
  it('puts the waiting player in the other’s exact place, and the other back to waiting', () => {
    const s = ready(2, mode);
    const out = s.courts[0].lineup!.team2[1];
    const inId = firstWaiting(s);
    const next = swapPlayers(s, inId, out);
    expect(next.courts[0].lineup!.team2[1]).toBe(inId);
    expect(next.courts[0].lineup!.team1).toEqual(s.courts[0].lineup!.team1);
    expect(orderedWaiting(next).map((p) => p.id)).toContain(out);
    expect(orderedWaiting(next).map((p) => p.id)).not.toContain(inId);
    assertInvariants(next);
  });

  it('works whichever way round the two are named', () => {
    const s = ready(1, mode);
    const out = s.courts[0].lineup!.team1[0];
    const inId = firstWaiting(s);
    expect(swapPlayers(s, out, inId)).toEqual(swapPlayers(s, inId, out));
  });

  it('changes nobody’s games or counts, and not the input', () => {
    const s = ready(1, mode);
    const before = JSON.stringify(s);
    const next = swapPlayers(s, firstWaiting(s), s.courts[0].lineup!.team1[0]);
    expect(next.players).toEqual(s.players);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('who goes to the front of the line when someone is taken off', () => {
  it('is the front of the queue in queue mode', () => {
    const s = ready(3, 'queue');
    const out = s.courts[0].lineup!.team1[0];
    const next = swapPlayers(s, firstWaiting(s), out);
    expect(next.queueOrder[0]).toBe(out);
    assertInvariants(next);
  });

  it('is a place by the usual rule in fairness mode, so a player who has played less comes back sooner', () => {
    const s = ready(3, 'fairness');
    const out = s.courts[0].lineup!.team1[0];
    const next = swapPlayers(s, firstWaiting(s), out);
    expect(orderedWaiting(next).map((p) => p.id)).toContain(out);
    assertInvariants(next);
  });
});

describe('swapping into a game that is running', () => {
  it('replaces the player in the game, and credits the substitute and not the player taken off, at the finish', () => {
    let s = playing(2);
    const out = s.courts[0].game!.team1[0];
    const sub = firstWaiting(s);
    s = swapPlayers(s, sub, out);
    expect(courtIds(s)).toContain(sub);
    expect(courtIds(s)).not.toContain(out);
    s = finishGame(s, s.courts[0].id, makeCtx(1, 600_000));
    expect(s.players.find((p) => p.id === sub)!.gamesPlayed).toBe(1);
    expect(s.players.find((p) => p.id === out)!.gamesPlayed).toBe(0);
    // Partners and opponents are the four who really played.
    const g = s.history[0];
    expect([...g.team1, ...g.team2]).toContain(sub);
    expect([...g.team1, ...g.team2]).not.toContain(out);
    expect(Object.keys(s.players.find((p) => p.id === sub)!.partnerCounts)).toHaveLength(1);
    expect(Object.keys(s.players.find((p) => p.id === out)!.partnerCounts)).toHaveLength(0);
    assertInvariants(s);
  });

  it('leaves the clock of the game alone', () => {
    const s = playing(1);
    const next = swapPlayers(s, firstWaiting(s), s.courts[0].game!.team2[0]);
    expect(next.courts[0].game!.startedAt).toBe(1_000);
  });

  it('applies a break or leave that the player taken off had asked for at the end of the game', () => {
    let s = playing(2);
    const out = s.courts[0].game!.team1[1];
    s = setPlayerStatus(s, out, 'break', makeCtx());
    expect(s.players.find((p) => p.id === out)!.pendingStatus).toBe('break');
    s = swapPlayers(s, firstWaiting(s), out);
    const p = s.players.find((q) => q.id === out)!;
    expect(p.status).toBe('break');
    expect(p.pendingStatus).toBeUndefined();
    expect(s.queueOrder).not.toContain(out);
    assertInvariants(s);
  });
});

describe('swapping two players who are both on courts', () => {
  it('trades their places across two courts, whether Ready or running', () => {
    let s = newTestSession(ids(8), { courts: 2, autoStart: false });
    s = startCourt1(s);
    const a = s.courts[0].game!.team1[0];
    const b = s.courts[1].lineup!.team2[1];
    const next = swapPlayers(s, a, b);
    expect(next.courts[0].game!.team1[0]).toBe(b);
    expect(next.courts[1].lineup!.team2[1]).toBe(a);
    assertInvariants(next);
  });

  it('moves a player to the other team of the same court', () => {
    const s = ready(0);
    const a = s.courts[0].lineup!.team1[0];
    const b = s.courts[0].lineup!.team2[0];
    const next = swapPlayers(s, a, b);
    expect(next.courts[0].lineup!.team1[0]).toBe(b);
    expect(next.courts[0].lineup!.team2[0]).toBe(a);
    assertInvariants(next);
  });

  it('refuses two partners on the same team', () => {
    const s = ready(0);
    expectEngineError(() => swapPlayers(s, s.courts[0].lineup!.team1[0], s.courts[0].lineup!.team1[1]), 'INVALID_SWAP');
  });
});

describe('a swap that makes no sense', () => {
  it('is refused for two waiting players, the same player twice, and anyone on a break or gone', () => {
    const s = ready(3);
    const [w1, w2] = orderedWaiting(s).map((p) => p.id);
    expectEngineError(() => swapPlayers(s, w1, w2), 'INVALID_SWAP');
    expectEngineError(() => swapPlayers(s, w1, w1), 'INVALID_SWAP');
    const onBreak = setPlayerStatus(s, w2, 'break', makeCtx());
    expectEngineError(() => swapPlayers(onBreak, w2, s.courts[0].lineup!.team1[0]), 'INVALID_SWAP');
    const left = setPlayerStatus(s, w2, 'left', makeCtx());
    expectEngineError(() => swapPlayers(left, s.courts[0].lineup!.team1[0], w2), 'INVALID_SWAP');
    expectEngineError(() => swapPlayers(s, 'nobody', w1), 'NOT_FOUND');
  });

  it('takes a waiting player off the play next list when they are swapped in', () => {
    let s = ready(3);
    const sub = orderedWaiting(s)[2].id;
    s = playNext(s, sub);
    s = swapPlayers(s, sub, s.courts[0].lineup!.team1[0]);
    expect(s.pinned).toBeUndefined();
    assertInvariants(s);
  });
});

describe('notHere', () => {
  it('takes the absent player out of a Ready lineup, brings the next waiting player in, and puts the absent one on a break', () => {
    const s = ready(2);
    const absent = s.courts[0].lineup!.team2[0];
    const replacement = firstWaiting(s);
    const next = notHere(s, absent, makeCtx());
    expect(courtIds(next)).toContain(replacement);
    expect(courtIds(next)).not.toContain(absent);
    expect(next.players.find((p) => p.id === absent)!.status).toBe('break');
    expect(next.queueOrder).not.toContain(absent);
    assertInvariants(next);
  });

  it('does the same inside a running game, and the replacement is credited at the finish', () => {
    let s = playing(1);
    const absent = s.courts[0].game!.team1[0];
    const replacement = firstWaiting(s);
    s = notHere(s, absent, makeCtx());
    expect(s.players.find((p) => p.id === absent)!.status).toBe('break');
    s = finishGame(s, s.courts[0].id, makeCtx(1, 600_000));
    expect(s.players.find((p) => p.id === replacement)!.gamesPlayed).toBe(1);
    expect(s.players.find((p) => p.id === absent)!.gamesPlayed).toBe(0);
    assertInvariants(s);
  });

  it('says so and changes nothing when nobody is waiting', () => {
    const s = ready(0);
    const before = JSON.stringify(s);
    expectEngineError(() => notHere(s, s.courts[0].lineup!.team1[0], makeCtx()), 'NO_REPLACEMENT');
    expect(JSON.stringify(s)).toBe(before);
  });

  it('is for a player on a court', () => {
    const s = ready(2);
    expectEngineError(() => notHere(s, firstWaiting(s), makeCtx()), 'INVALID_SWAP');
    expectEngineError(() => notHere(s, 'nobody', makeCtx()), 'NOT_FOUND');
  });

  it('brings in a player who was asked to play next first, since they are first in line', () => {
    let s = ready(3);
    const chosen = orderedWaiting(s)[2].id;
    s = playNext(s, chosen);
    const next = notHere(s, s.courts[0].lineup!.team1[0], makeCtx());
    expect(courtIds(next)).toContain(chosen);
    expect(next.pinned).toBeUndefined();
  });
});

describe('locatePlayer and swapCandidates', () => {
  it('says where each player is', () => {
    let s = newTestSession(ids(10), { courts: 2, autoStart: false });
    s = startCourt1(s);
    const inGame = s.courts[0].game!.team1[0];
    const inLineup = s.courts[1].lineup!.team2[0];
    const waiting = firstWaiting(s);
    expect(locatePlayer(s, inGame)).toEqual({ kind: 'game', courtNumber: 1, team: 1 });
    expect(locatePlayer(s, inLineup)).toEqual({ kind: 'lineup', courtNumber: 2, team: 2 });
    expect(locatePlayer(s, waiting)).toEqual({ kind: 'waiting' });
    const onBreak = setPlayerStatus(s, waiting, 'break', makeCtx());
    expect(locatePlayer(onBreak, waiting)).toEqual({ kind: 'off' });
  });

  it('offers a court player the waiting players in order and the other court players, never their own partner', () => {
    let s = newTestSession(ids(10), { courts: 2, autoStart: false });
    s = startCourt1(s);
    const me = s.courts[0].game!.team1[0];
    const partner = s.courts[0].game!.team1[1];
    const c = swapCandidates(s, me);
    expect(c.waiting.map((p) => p.id)).toEqual(orderedWaiting(s).map((p) => p.id));
    const others = c.onCourts.map((o) => o.player.id);
    expect(others).not.toContain(me);
    expect(others).not.toContain(partner);
    expect(others).toHaveLength(7 - 1); // 8 on courts, minus themselves and their partner
    expect(c.onCourts.find((o) => o.courtNumber === 2)!.status).toBe('ready');
    expect(c.onCourts.find((o) => o.courtNumber === 1)!.team).toBe(2);
  });

  it('offers a waiting player only the players on courts', () => {
    let s = newTestSession(ids(10), { courts: 2, autoStart: false });
    s = startCourt1(s);
    const c = swapCandidates(s, firstWaiting(s));
    expect(c.waiting).toEqual([]);
    expect(c.onCourts).toHaveLength(8);
  });

  it('offers nothing to a player who is on a break', () => {
    const s = ready(2);
    const w = firstWaiting(s);
    const onBreak = setPlayerStatus(s, w, 'break', makeCtx());
    expect(swapCandidates(onBreak, w)).toEqual({ waiting: [], onCourts: [] });
  });
});

/** Starts the first court only, leaving any others Ready. */
function startCourt1(s: Session): Session {
  return startCourt(s, s.courts[0].id, makeCtx(1, 1_000));
}
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/engine/swap.test.ts
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 3: Create `src/engine/locate.ts`**

```ts
import { availablePlayers, orderedWaiting, playerById } from './pool';
import type { Court, Player, PlayerId, Session } from './types';

export type Place =
  | { kind: 'waiting' }
  | { kind: 'lineup' | 'game'; courtNumber: number; team: 1 | 2 }
  | { kind: 'off' };

/** Which team of a court holds the player, in its running game or its Ready lineup. */
export function teamOf(court: Court, id: PlayerId): 1 | 2 | null {
  const group = court.game ?? court.lineup;
  if (!group) return null;
  if (group.team1.includes(id)) return 1;
  if (group.team2.includes(id)) return 2;
  return null;
}

/** Where a player is right now: waiting, in a Ready lineup, in a running game, or off (on a break or gone). */
export function locatePlayer(s: Session, id: PlayerId): Place {
  for (const court of s.courts) {
    const team = teamOf(court, id);
    if (team) return { kind: court.status === 'ready' ? 'lineup' : 'game', courtNumber: court.number, team };
  }
  return availablePlayers(s).some((p) => p.id === id) ? { kind: 'waiting' } : { kind: 'off' };
}

export interface OnCourt {
  player: Player;
  courtNumber: number;
  status: 'ready' | 'playing';
  team: 1 | 2;
}

export interface SwapCandidates {
  /** Waiting players, in the order they will be picked. Empty for a player who is waiting themselves. */
  waiting: Player[];
  /** Players on courts they could trade places with, never a partner on the same team. */
  onCourts: OnCourt[];
}

/** Everyone a player could swap with, for the picker. */
export function swapCandidates(s: Session, id: PlayerId): SwapCandidates {
  const me = locatePlayer(s, id);
  const onCourts: OnCourt[] = [];
  for (const court of [...s.courts].sort((a, b) => a.number - b.number)) {
    const group = court.game ?? court.lineup;
    if (!group) continue;
    for (const team of [1, 2] as const) {
      for (const pid of team === 1 ? group.team1 : group.team2) {
        const myTeam = (me.kind === 'lineup' || me.kind === 'game') && me.courtNumber === court.number && me.team === team;
        if (pid === id || myTeam) continue;
        onCourts.push({ player: playerById(s, pid), courtNumber: court.number, status: court.status === 'ready' ? 'ready' : 'playing', team });
      }
    }
  }
  const waiting = me.kind === 'waiting' || me.kind === 'off' ? [] : orderedWaiting(s).filter((p) => p.id !== id);
  return { waiting, onCourts: me.kind === 'off' ? [] : onCourts };
}
```

- [ ] **Step 4: Create `src/engine/swap.ts`**

```ts
import { cloneSession } from './clone';
import { EngineError } from './errors';
import { unpin } from './pins';
import { availablePlayers, orderedWaiting, playerById } from './pool';
import { setPlayerStatus } from './status';
import type { Court, Ctx, PlayerId, Session, Team } from './types';

interface Slot {
  court: Court;
  group: 'game' | 'lineup';
  team: 'team1' | 'team2';
  index: 0 | 1;
}

function slotOf(s: Session, id: PlayerId): Slot | null {
  for (const court of s.courts) {
    const group = court.game ? 'game' : court.lineup ? 'lineup' : null;
    if (!group) continue;
    const teams = court[group]!;
    for (const team of ['team1', 'team2'] as const) {
      const index = teams[team].indexOf(id);
      if (index >= 0) return { court, group, team, index: index as 0 | 1 };
    }
  }
  return null;
}

/** MUTATES the session the slot belongs to: puts `id` in the slot. */
function place(slot: Slot, id: PlayerId): void {
  const team: Team = [...slot.court[slot.group]![slot.team]];
  team[slot.index] = id;
  slot.court[slot.group]![slot.team] = team;
}

/**
 * Trades the places of two players. One may be waiting: they take the other's place on a court (in a Ready lineup or a
 * running game), and the one taken off goes back to waiting, at the front of the queue in queue mode. Or both may be on
 * courts, in the same game on different teams or in different games, and trade places. The game in progress is
 * untouched, and a game credits whoever is on court when it finishes: a substitute is credited, the player taken off is
 * not. Nobody's own games or counts change.
 */
export function swapPlayers(s: Session, aId: PlayerId, bId: PlayerId): Session {
  const n = cloneSession(s);
  const a = playerById(n, aId);
  const b = playerById(n, bId);
  if (aId === bId) throw new EngineError('INVALID_SWAP', 'Choose two different players.');
  for (const p of [a, b]) {
    if (p.status !== 'active') throw new EngineError('INVALID_SWAP', `${p.name} is not available to swap.`);
  }
  const slotA = slotOf(n, aId);
  const slotB = slotOf(n, bId);

  if (slotA && slotB) {
    if (slotA.court === slotB.court && slotA.group === slotB.group && slotA.team === slotB.team) {
      throw new EngineError('INVALID_SWAP', `${a.name} and ${b.name} are already on the same team.`);
    }
    place(slotA, bId);
    place(slotB, aId);
    return n;
  }

  if (!slotA && !slotB) {
    throw new EngineError('INVALID_SWAP', 'Swap needs at least one player on a court.');
  }

  // One on a court, one waiting.
  const [outId, inId, slot] = slotA ? [aId, bId, slotA] : [bId, aId, slotB!];
  const waiting = availablePlayers(n).some((p) => p.id === inId);
  if (!waiting) throw new EngineError('INVALID_SWAP', `${playerById(n, inId).name} is not waiting.`);
  place(slot, inId);
  unpin(n, [inId]);
  const out = playerById(n, outId);
  n.queueOrder = n.queueOrder.filter((id) => id !== inId);
  if (out.pendingStatus) {
    // They asked to go on a break or leave when the game ended: taken off the court, that is now.
    out.status = out.pendingStatus;
    delete out.pendingStatus;
  } else {
    n.queueOrder = [outId, ...n.queueOrder];
  }
  return n;
}

/**
 * A player on a court did not turn up, or cannot play: the next waiting player takes their place and they go on a
 * break, as one step. Refused when nobody is waiting.
 */
export function notHere(s: Session, playerId: PlayerId, ctx: Ctx): Session {
  const player = playerById(s, playerId);
  if (!slotOf(s, playerId)) {
    throw new EngineError('INVALID_SWAP', `${player.name} is not on a court.`);
  }
  const next = orderedWaiting(s)[0];
  if (!next) throw new EngineError('NO_REPLACEMENT', 'No one is waiting to take their place.');
  return setPlayerStatus(swapPlayers(s, playerId, next.id), playerId, 'break', ctx);
}
```

- [ ] **Step 5: Apply this change to `src/engine/errors.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/errors.ts
+++ b/src/engine/errors.ts
@@ -8,6 +8,8 @@
   | 'NOT_READY'
   | 'INVALID_RESULT'
   | 'NOT_WAITING'
+  | 'INVALID_SWAP'
+  | 'NO_REPLACEMENT'
   | 'CANNOT_RETURN';
 
 export class EngineError extends Error {
```

- [ ] **Step 6: Apply this change to `src/engine/index.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/index.ts
+++ b/src/engine/index.ts
@@ -15,3 +15,6 @@
 export { summarize, formatSummaryText, sessionStats, formatDuration, fairnessLine, gameLog, hasResults } from './summary';
 export type { PlayerSummary, SessionStats, GameLogEntry, WinLoss } from './summary';
 export { playNext, skipTurn } from './pins';
+export { swapPlayers, notHere } from './swap';
+export { locatePlayer, swapCandidates } from './locate';
+export type { Place, OnCourt, SwapCandidates } from './locate';
```

- [ ] **Step 7: Run the tests**

```bash
npx vitest run src/engine
```

Expected: PASS.

- [ ] **Step 8: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/engine/locate.ts src/engine/swap.ts src/engine/errors.ts src/engine/index.ts src/engine/swap.test.ts
git commit -m "Add swapping two players and Not here to the engine"
```

## Task 3: Random operations include the new actions

The random-operations test now also plays next, skips, swaps and marks players not here, in every mix of mode and auto-start, and checks every invariant after each step.

**Files:**
- Modify: `src/engine/fuzz.test.ts`

- [ ] **Step 1: Apply this change to `src/engine/fuzz.test.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/fuzz.test.ts
+++ b/src/engine/fuzz.test.ts
@@ -3,14 +3,16 @@
 import { EngineError } from './errors';
 import { finishGame } from './game';
 import { assertInvariants } from './invariants';
+import { playNext, skipTurn } from './pins';
 import { mulberry32 } from './rng';
 import { addPlayer } from './session';
 import { startAllReady, startCourt } from './start';
 import { setPlayerStatus } from './status';
+import { notHere, swapPlayers } from './swap';
 import { makeCtx, newTestSession } from './testing';
 import type { Mode, PlayerStatus, Session } from './types';
 
-const TOLERATED = new Set(['CANNOT_RETURN', 'LAST_COURT', 'NOT_PLAYING', 'NOT_READY']);
+const TOLERATED = new Set(['CANNOT_RETURN', 'LAST_COURT', 'NOT_PLAYING', 'NOT_READY', 'NOT_WAITING', 'INVALID_SWAP', 'NO_REPLACEMENT']);
 const TARGETS: PlayerStatus[] = ['active', 'break', 'left'];
 const STEPS = 250;
 
@@ -37,7 +39,7 @@
 
       for (let step = 1; step <= STEPS; step++) {
         const ctx = { ...base, now: step * 60_000 };
-        const kind = Math.floor(rng() * 6);
+        const kind = Math.floor(rng() * 10);
         try {
           switch (kind) {
             case 0: {
@@ -59,11 +61,23 @@
             case 4:
               s = removeCourt(s, pick(s.courts, rng).id, ctx);
               break;
-            default: {
+            case 5: {
               const ready = s.courts.filter((c) => c.status === 'ready');
               if (ready.length === 0) continue;
               s = rng() < 0.5 ? startCourt(s, pick(ready, rng).id, ctx) : startAllReady(s, ctx);
+              break;
             }
+            case 6:
+              s = playNext(s, pick(s.players, rng).id);
+              break;
+            case 7:
+              s = skipTurn(s, pick(s.players, rng).id);
+              break;
+            case 8:
+              s = swapPlayers(s, pick(s.players, rng).id, pick(s.players, rng).id);
+              break;
+            default:
+              s = notHere(s, pick(s.players, rng).id, ctx);
           }
         } catch (e) {
           if (e instanceof EngineError && TOLERATED.has(e.code)) continue;
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/engine/fuzz.test.ts
```

Expected: PASS.

- [ ] **Step 3: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/engine/fuzz.test.ts
git commit -m "Extend the random-operations test to swap, play next, skip and Not here"
```

## Task 4: Swap, play next, skip and Not here on screen

The player sheet gains the new actions. A player on a court can Swap with a waiting player or a player on a court (a picker, one tap) or be marked Not here. A waiting player can Play next, Skip this turn or Swap onto a court. The waiting list tags anyone asked to play next. The Undo bar says what happened.

**Files:**
- Create: `src/ui/swapLabel.ts`, `src/ui/SwapPicker.tsx`
- Modify: `src/ui/PlayerSheet.tsx`, `src/ui/WaitingSheet.tsx`, `src/styles/app.css`
- Test: `src/ui/swapLabel.test.ts`, `src/ui/controlActions.test.tsx`

- [ ] **Step 1: Create `src/ui/swapLabel.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { newTestSession } from '../engine/testing';
import { swapLabel } from './swapLabel';

describe('swapLabel', () => {
  const make = () => {
    const s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jon'], { courts: 2, autoStart: false });
    const onCourt1 = s.courts[0].lineup!.team1[0];
    const onCourt2 = s.courts[1].lineup!.team2[1];
    const waiting = s.queueOrder[0];
    const name = (id: string) => s.players.find((p) => p.id === id)!.name;
    return { s, onCourt1, onCourt2, waiting, name };
  };

  it('says who stepped in for whom, on which court, whichever way round they are named', () => {
    const { s, onCourt1, waiting, name } = make();
    const text = `${name(waiting)} swapped in for ${name(onCourt1)} on Court 1`;
    expect(swapLabel(s, waiting, onCourt1)).toBe(text);
    expect(swapLabel(s, onCourt1, waiting)).toBe(text);
  });

  it('says two court players swapped places', () => {
    const { s, onCourt1, onCourt2, name } = make();
    expect(swapLabel(s, onCourt1, onCourt2)).toBe(`${name(onCourt1)} and ${name(onCourt2)} swapped places`);
  });

  it('names the court the player taken off was on', () => {
    const { s, onCourt2, waiting, name } = make();
    expect(swapLabel(s, waiting, onCourt2)).toBe(`${name(waiting)} swapped in for ${name(onCourt2)} on Court 2`);
  });
});
```

- [ ] **Step 2: Create `src/ui/controlActions.test.tsx`**

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import App from './App';

type User = ReturnType<typeof userEvent.setup>;

// The real default: games wait for Start, so the first games are Ready lineups.
beforeEach(async () => {
  localStorage.clear();
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false, lastAction: null });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => vi.restoreAllMocks());

const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.fromCharCode(65 + i)}`).join('{enter}');

async function startSession(user: User, count: number) {
  render(<App />);
  await user.type(screen.getByLabelText('Search or add players'), names(count));
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('button', { name: `Start ${count} players` }));
}
const session = () => useSessionStore.getState().session!;
const nameOf = (id: string) => session().players.find((p) => p.id === id)!.name;
const bar = () => document.querySelector<HTMLElement>('.undo-bar');
const waitingRows = () => within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('button');
const waitingNames = () => waitingRows().map((b) => b.textContent!.match(/P[A-Z]/)![0]);
const panel = (n = 1) => screen.getByRole('tabpanel', { name: `Court ${n}` });
const courtTile = (name: string) => within(screen.getByRole('tabpanel')).getByRole('button', { name: new RegExp(`^${name}`) });
const lineup = (court = 0) => {
  const c = session().courts[court];
  const g = c.game ?? c.lineup!;
  return [...g.team1, ...g.team2].map(nameOf);
};
async function openSheet(user: User, button: HTMLElement) {
  await user.click(button);
  return screen.findByRole('dialog');
}

describe('the player sheet for a waiting player', () => {
  it('offers Play next, Skip this turn and Swap onto a court, and not Not here', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const dialog = within(await openSheet(user, waitingRows()[0]));
    expect(dialog.getByRole('button', { name: 'Play next' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Skip this turn' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Swap onto a court…' })).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Not here' })).not.toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Swap with…' })).not.toBeInTheDocument();
  });

  it('Play next moves them to the front with a Next tag, says so on the Undo bar, and Undo takes it back', async () => {
    const user = userEvent.setup();
    await startSession(user, 12);
    const before = waitingNames();
    const chosen = before[3];
    await user.click(waitingRows()[3]);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Play next' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bar()!.textContent).toBe(`${chosen} plays nextUndo`);
    expect(waitingNames()[0]).toBe(chosen);
    expect(waitingRows()[0].textContent).toContain('Next');
    expect(session().pinned).toHaveLength(1);
    await user.click(within(bar()!).getByRole('button', { name: 'Undo' }));
    expect(session().pinned).toBeUndefined();
    expect(waitingNames()).toEqual(before);
  });

  it('shows Playing next instead of the button, and the reason, for a player who was asked', async () => {
    const user = userEvent.setup();
    await startSession(user, 12);
    await user.click(waitingRows()[2]);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Play next' }));
    const dialog = within(await openSheet(user, waitingRows()[0]));
    expect(dialog.getByText('Playing next.')).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Play next' })).not.toBeInTheDocument();
    expect(dialog.getByText(/You are playing next\./)).toBeInTheDocument();
  });

  it('Skip this turn sends them to the back of the line and says so', async () => {
    const user = userEvent.setup();
    await startSession(user, 12);
    const first = waitingNames()[0];
    await user.click(waitingRows()[0]);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Skip this turn' }));
    expect(bar()!.textContent).toBe(`${first} skipped a turnUndo`);
    expect(waitingNames().at(-1)).toBe(first);
  });
});

describe('the player sheet for a player on a court', () => {
  it('offers Swap with and Not here, with what Not here does, and not Play next', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const who = lineup()[0];
    const dialog = within(await openSheet(user, courtTile(who)));
    expect(dialog.getByRole('button', { name: 'Swap with…' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Not here' })).toBeInTheDocument();
    expect(dialog.getByText(`Swaps in the next waiting player and puts ${who} on a break.`)).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Play next' })).not.toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Skip this turn' })).not.toBeInTheDocument();
  });

  it('Not here brings in the next waiting player and puts the absent one on a break, as one Undo step', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const absent = lineup()[1];
    const replacement = waitingNames()[0];
    const stack = useSessionStore.getState().undoStack.length;
    await user.click(courtTile(absent));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Not here' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(lineup()).toContain(replacement);
    expect(lineup()).not.toContain(absent);
    const onBreak = within(screen.getByRole('list', { name: 'On break' }));
    expect(onBreak.getByRole('button').textContent).toContain(absent);
    expect(bar()!.textContent).toBe(`${absent} not here, the next player steps inUndo`);
    expect(useSessionStore.getState().undoStack.length).toBe(stack + 1);
    await user.click(within(bar()!).getByRole('button', { name: 'Undo' }));
    expect(lineup()).toContain(absent);
  });

  it('Not here says so and keeps the sheet open when nobody is waiting', async () => {
    const user = userEvent.setup();
    await startSession(user, 4);
    await user.click(courtTile(lineup()[0]));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Not here' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No one is waiting to take their place.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(session().courts[0].status).toBe('ready');
  });

  it('works inside a game that is running too', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    await user.click(screen.getByRole('button', { name: /^Start game/ }));
    const absent = lineup()[0];
    const replacement = waitingNames()[0];
    await user.click(courtTile(absent));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Not here' }));
    expect(lineup()).toContain(replacement);
    expect(session().courts[0].status).toBe('playing');
  });
});

describe('the swap picker', () => {
  it('from a court player lists the waiting players first and then the players on courts, and Back returns', async () => {
    const user = userEvent.setup();
    await startSession(user, 10);
    const me = lineup(0)[0];
    await user.click(screen.getAllByRole('tab')[0]);
    await user.click(await within(panel(1)).findByRole('button', { name: new RegExp(`^${me}`) }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Swap with…' }));
    const dialog = within(screen.getByRole('dialog', { name: `Swap ${me}` }));
    const waiting = dialog.getByRole('list', { name: 'Swap with a waiting player' });
    const onCourt = dialog.getByRole('list', { name: 'Swap with a player on a court' });
    expect(within(waiting).getAllByRole('button').map((b) => b.textContent!.match(/P[A-Z]/)![0])).toEqual(waitingNames());
    expect(within(onCourt).getAllByRole('button')).toHaveLength(8 - 2); // 8 on courts, minus themselves and their partner
    expect(onCourt.textContent).toContain('Court 2, team 1, ready');
    await user.click(dialog.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog', { name: me })).toBeInTheDocument();
  });

  it('swaps with a waiting player in one tap, and says who stepped in', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const me = lineup()[2];
    const inName = waitingNames()[0];
    await user.click(courtTile(me));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Swap with…' }));
    await user.click(within(screen.getByRole('list', { name: 'Swap with a waiting player' })).getByRole('button', { name: new RegExp(inName) }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bar()!.textContent).toBe(`${inName} swapped in for ${me} on Court 1Undo`);
    expect(lineup()).toContain(inName);
    expect(waitingNames()).toContain(me);
  });

  it('swaps two players on different courts, and says they swapped places', async () => {
    const user = userEvent.setup();
    await startSession(user, 10);
    const me = lineup(0)[0];
    const other = lineup(1)[3];
    await user.click(await within(panel(1)).findByRole('button', { name: new RegExp(`^${me}`) }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Swap with…' }));
    await user.click(within(screen.getByRole('list', { name: 'Swap with a player on a court' })).getByRole('button', { name: new RegExp(other) }));
    expect(bar()!.textContent).toBe(`${me} and ${other} swapped placesUndo`);
    expect(lineup(0)).toContain(other);
    expect(lineup(1)).toContain(me);
  });

  it('from a waiting player lists only the players on courts, and swaps them onto a court', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const me = waitingNames()[1];
    const swapOut = lineup()[0];
    await user.click(waitingRows()[1]);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Swap onto a court…' }));
    const dialog = within(screen.getByRole('dialog', { name: `Swap ${me}` }));
    expect(dialog.queryByRole('list', { name: 'Swap with a waiting player' })).not.toBeInTheDocument();
    expect(within(dialog.getByRole('list', { name: 'Swap with a player on a court' })).getAllByRole('button')).toHaveLength(4);
    await user.click(within(dialog.getByRole('list', { name: 'Swap with a player on a court' })).getByRole('button', { name: new RegExp(swapOut) }));
    expect(bar()!.textContent).toBe(`${me} swapped in for ${swapOut} on Court 1Undo`);
    expect(lineup()).toContain(me);
  });

  it('keeps a swap that was asked to play next honest: the player stepping in is no longer asked', async () => {
    const user = userEvent.setup();
    await startSession(user, 12);
    await user.click(waitingRows()[1]);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Play next' }));
    const chosen = waitingNames()[0];
    await user.click(waitingRows()[0]);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Swap onto a court…' }));
    const target = lineup()[0];
    await user.click(within(screen.getByRole('list', { name: 'Swap with a player on a court' })).getByRole('button', { name: new RegExp(target) }));
    await waitFor(() => expect(lineup()).toContain(chosen));
    expect(session().pinned).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
npx vitest run src/ui/swapLabel.test.ts src/ui/controlActions.test.tsx
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 4: Create `src/ui/swapLabel.ts`**

```ts
import * as engine from '../engine';
import type { Session } from '../engine';

/** What the Undo bar says after two players trade places: who stepped in for whom, on which court. */
export function swapLabel(session: Session, aId: string, bId: string): string {
  const name = (id: string) => session.players.find((p) => p.id === id)?.name ?? 'Player';
  const a = engine.locatePlayer(session, aId);
  const b = engine.locatePlayer(session, bId);
  const onCourt = (p: ReturnType<typeof engine.locatePlayer>) => p.kind === 'lineup' || p.kind === 'game';
  if (onCourt(a) && onCourt(b)) return `${name(aId)} and ${name(bId)} swapped places`;
  const [inId, outId, place] = onCourt(a) ? [bId, aId, a] : [aId, bId, b];
  const court = place.kind === 'lineup' || place.kind === 'game' ? ` on Court ${place.courtNumber}` : '';
  return `${name(inId)} swapped in for ${name(outId)}${court}`;
}
```

- [ ] **Step 5: Create `src/ui/SwapPicker.tsx`**

```tsx
import * as engine from '../engine';
import type { Session } from '../engine';
import { PlayerAvatar } from './PlayerAvatar';
import { Sheet } from './Sheet';

interface Props {
  session: Session;
  playerId: string;
  onPick: (otherId: string) => void;
  onBack: () => void;
  onClose: () => void;
}

/** Who a player can trade places with: the waiting players in line order, then the players on courts. One tap swaps. */
export function SwapPicker({ session, playerId, onPick, onBack, onClose }: Props) {
  const me = session.players.find((p) => p.id === playerId);
  const { waiting, onCourts } = engine.swapCandidates(session, playerId);
  if (!me) return null;
  const empty = waiting.length === 0 && onCourts.length === 0;

  return (
    <Sheet title={`Swap ${me.name}`} onClose={onClose}>
      {empty && <p className="muted">There is nobody to swap with.</p>}

      {waiting.length > 0 && (
        <>
          <h3 className="section-title muted">Waiting</h3>
          <ul className="list" aria-label="Swap with a waiting player">
            {waiting.map((p) => (
              <li key={p.id}>
                <button type="button" className="row-btn" onClick={() => onPick(p.id)}>
                  <PlayerAvatar name={p.name} rosterId={p.rosterId} size="sm" />
                  <span className="row-name">{p.name}</span>
                  <span className="badge">
                    {p.gamesPlayed}
                    <span className="sr-only"> games played</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {onCourts.length > 0 && (
        <>
          <h3 className="section-title muted">On a court</h3>
          <ul className="list" aria-label="Swap with a player on a court">
            {onCourts.map((o) => (
              <li key={o.player.id}>
                <button type="button" className="row-btn" onClick={() => onPick(o.player.id)}>
                  <PlayerAvatar name={o.player.name} rosterId={o.player.rosterId} size="sm" />
                  <span className="row-name">{o.player.name}</span>
                  <span className="muted swap-where">
                    Court {o.courtNumber}, team {o.team}
                    {o.status === 'ready' ? ', ready' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <button type="button" className="btn btn-block" onClick={onBack}>
        Back
      </button>
    </Sheet>
  );
}
```

- [ ] **Step 6: Apply this change to `src/ui/PlayerSheet.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/PlayerSheet.tsx
+++ b/src/ui/PlayerSheet.tsx
@@ -6,6 +6,8 @@
 import { PhotoPanel } from './PhotoPanel';
 import { PlayerAvatar } from './PlayerAvatar';
 import { Sheet } from './Sheet';
+import { SwapPicker } from './SwapPicker';
+import { swapLabel } from './swapLabel';
 
 /** 1st, 2nd, 3rd, 4th, 11th, 21st. */
 function ordinal(n: number): string {
@@ -24,16 +26,43 @@
   const apply = useSessionStore((s) => s.apply);
   const [error, setError] = useState<string | null>(null);
   const [photoOpen, setPhotoOpen] = useState(false);
+  const [swapping, setSwapping] = useState(false);
   const player = session.players.find((p) => p.id === playerId);
   const saved = useRosterStore((s) => s.players.find((p) => p.id === player?.rosterId));
   if (!player) return null;
   const why = engine.explainWaiting(session, playerId);
+  const place = engine.locatePlayer(session, playerId);
+  const onCourt = place.kind === 'lineup' || place.kind === 'game';
+  const pinned = !!session.pinned?.includes(playerId);
 
   function setStatus(target: engine.StatusTarget) {
     const verb = target === 'break' ? 'on a break' : target === 'left' ? 'left the session' : 'back in';
     const res = apply((s, ctx) => engine.setPlayerStatus(s, playerId, target, ctx), `${player?.name ?? 'Player'} ${verb}`);
     if (res.ok) onClose();
     else setError(res.error);
+  }
+
+  /** Runs one of the control actions, closes the sheet when it worked and shows the engine's reason when it did not. */
+  function control(action: (s: Session, ctx: Parameters<Parameters<typeof apply>[0]>[1]) => Session, label: string) {
+    const res = apply(action, label);
+    if (res.ok) onClose();
+    else setError(res.error);
+  }
+
+  function swapWith(otherId: string) {
+    control((s) => engine.swapPlayers(s, playerId, otherId), swapLabel(session, playerId, otherId));
+  }
+
+  if (swapping) {
+    return (
+      <SwapPicker
+        session={session}
+        playerId={playerId}
+        onPick={swapWith}
+        onBack={() => setSwapping(false)}
+        onClose={onClose}
+      />
+    );
   }
 
   // Photos belong to the saved player, so a session player whose saved entry is gone has no photo to change.
@@ -84,6 +113,50 @@
         </p>
       )}
 
+      {onCourt && (
+        <>
+          <button type="button" className="btn btn-block" onClick={() => setSwapping(true)}>
+            Swap with…
+          </button>
+          <button
+            type="button"
+            className="btn btn-block"
+            onClick={() =>
+              control((s, ctx) => engine.notHere(s, playerId, ctx), `${player.name} not here, the next player steps in`)
+            }
+          >
+            Not here
+          </button>
+          <p className="muted control-hint">Swaps in the next waiting player and puts {player.name} on a break.</p>
+        </>
+      )}
+
+      {place.kind === 'waiting' && (
+        <>
+          {pinned ? (
+            <p className="why-waiting">Playing next.</p>
+          ) : (
+            <button
+              type="button"
+              className="btn btn-block"
+              onClick={() => control((s) => engine.playNext(s, playerId), `${player.name} plays next`)}
+            >
+              Play next
+            </button>
+          )}
+          <button
+            type="button"
+            className="btn btn-block"
+            onClick={() => control((s) => engine.skipTurn(s, playerId), `${player.name} skipped a turn`)}
+          >
+            Skip this turn
+          </button>
+          <button type="button" className="btn btn-block" onClick={() => setSwapping(true)}>
+            Swap onto a court…
+          </button>
+        </>
+      )}
+
       {player.pendingStatus ? (
         <button type="button" className="btn btn-block" onClick={() => setStatus('active')}>
           {player.pendingStatus === 'break' ? 'Cancel break' : 'Cancel leaving'}
```

- [ ] **Step 7: Apply this change to `src/ui/WaitingSheet.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/WaitingSheet.tsx
+++ b/src/ui/WaitingSheet.tsx
@@ -108,6 +108,7 @@
                   </span>
                   <PlayerAvatar name={p.name} rosterId={p.rosterId} size="sm" />
                   <span className="row-name">{p.name}</span>
+                  {session.pinned?.includes(p.id) && <span className="tag">Next</span>}
                   <span className="badge">
                     {p.gamesPlayed}
                     <span className="sr-only"> games played</span>
```

- [ ] **Step 8: Apply this change to `src/styles/app.css`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -1627,3 +1627,15 @@
   font-size: 14px;
   font-weight: 700;
 }
+
+/* ---------- Swap and play next ---------- */
+.control-hint {
+  margin: -4px 0 0;
+  font-size: 14px;
+}
+
+.swap-where {
+  flex: none;
+  font-size: 13px;
+  text-align: right;
+}
```

- [ ] **Step 9: Run the tests**

```bash
npx vitest run src/ui
```

Expected: PASS.

- [ ] **Step 10: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/ui/swapLabel.ts src/ui/SwapPicker.tsx src/ui/PlayerSheet.tsx src/ui/WaitingSheet.tsx src/styles/app.css src/ui/swapLabel.test.ts src/ui/controlActions.test.tsx
git commit -m "Add swap, play next, skip and Not here to the player sheet"
```

## Task 5: Look at it, then merge

- [ ] **Step 1: Build and look at it at 360 by 780**

```bash
npm run build
```

Expected: clean build. In a browser at 360 by 780, light theme: start a session from a saved roster. Tap a player in the Ready lineup: the sheet offers Swap with, Not here (with a line saying what it does), Take a break and Leave. Tap Swap with: a picker lists the waiting players in line order, then the players on other courts with their court and team, and Back returns. Tap a waiting player: the sheet offers Play next, Skip this turn and Swap onto a court. Play next puts them first with a "Next" tag. Skip this turn sends them to the back. After each, the Undo bar says what happened and Undo takes it back.

- [ ] **Step 2: Run the Ralph loop** on the finished change, and fix what it finds.

- [ ] **Step 3: Merge to production** after the owner says go.

- [ ] **Step 4: Phone check at the courts.** A real no-show: tap the missing player and use Not here before pressing Start. A mid-game swap for an injury. Play next for a latecomer who must go on now, and Skip this turn for someone who is not ready. Not verifiable without a phone: whether the sheet has too many buttons when your thumb is in a hurry, and whether the picker is easy to scan with a long waiting list.

## Self-review

- **Spec coverage (2c):** swap with the credit rule, play next, skip, Not here, the picker, the Next tag, one Undo step each, the toast text through the Undo bar, and the fuzz test with the new actions. The spec's "Skip" and "swap between waiting players" edge cases are covered in Task 1 and Task 2 tests.
- **Rules kept:** nobody's own games or counts change by a swap, a pin or a skip; fairness still owes a skipped player a game; a pinned player can never be anywhere but waiting (an invariant checked after every random step).
- **Found by the random test:** a break in a Ready lineup could bring in a player who was asked to play next without taking them off the list. Fixed in Task 1 with a test.
- **Placeholders:** none. Every step has its code or diff.
- **Names:** `pinned`, `playNext`, `skipTurn`, `swapPlayers`, `notHere`, `locatePlayer`, `swapCandidates`, `SwapPicker`, `swapLabel` are defined once and used by the same names.
