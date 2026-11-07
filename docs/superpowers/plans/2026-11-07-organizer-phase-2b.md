# PIKLMatch Phase 2b: results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an organizer finishes a game they can say which team won and the score in two taps, with no typing, and skip it whenever they like. The summary then shows each player's record and each result. Results are recorded and shown only. They never change who plays next.

**Architecture:** `FinishedGame` gains optional `winner` and `score`. `finishGame` takes an optional result and validates it. A `ResultSheet` (built on the existing `Sheet`) opens from Game finished: team buttons, then a stepper for the winning score and a row of numbers for the other score. The summary engine counts wins and losses from games that have a winner, and the summary screen shows them, with a switch that keeps them out of the shared text by default. Play to (11, 15 or 21) is a setting stored the same way as the others.

**Tech Stack:** React 18, TypeScript, Zustand, Vitest with Testing Library, Vite. No new dependencies.

Spec: `docs/superpowers/specs/2026-11-07-organizer-experience-phases.md`, Phase 2, Part 2b.

**One choice made in this plan.** On the score step, **Skip score** records the winner without a score instead of discarding the whole result. The spec said Skip finishes with no winner on both steps; keeping a winner the organizer already tapped loses nothing and is still a skip. **Skip result** on the first step records nothing. The spec was updated to say so.

**How the code in this plan was proved.** Every file and diff below was built once in a scratch copy of the repository at commit `04e2701`, with the full suite passing (711 tests, up from 657, eight runs in a row) and mutation-checked (17 deliberate breakages, all caught). The sheet and the summary were looked at in a browser at 360 by 780 in the light theme. Apply a diff from the project root with `patch -p1 < the-diff-file`, or by hand: each hunk shows its context.

**Conventions.** Run commands from `pickleball-match-app/` (the folder with `package.json`). Stage files by name, never with `git add -A`. No AI attribution lines in commit messages. After the last task, run the Ralph loop before merging.

---
## Task 1: Steady a flaky test on Saved players

The camera badge test opens Saved players as soon as the first player is saved, but the second is saved a moment later, so it fails about one run in six. Make it wait for both. Fix it first so every later "all tests pass" can be trusted.

**Files:**
- Modify: `src/ui/savedPlayers.test.tsx`

- [ ] **Step 1: Apply this change to `src/ui/savedPlayers.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/savedPlayers.test.tsx
+++ b/src/ui/savedPlayers.test.tsx
@@ -1,4 +1,4 @@
-import { act, render, screen, within } from '@testing-library/react';
+import { act, render, screen, waitFor, within } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
 import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
 import { resetRosterDbForTests } from '../store/rosterDb';
@@ -49,7 +49,8 @@
   it('shows a camera badge on avatars without a photo, and none once there is one', async () => {
     const user = userEvent.setup();
     await openSaved(user, 'Ann{enter}Ben{enter}');
-    expect(document.querySelectorAll('.cam-badge')).toHaveLength(2);
+    // Ben is saved a moment after Ann, so the second badge can arrive after the screen opens.
+    await waitFor(() => expect(document.querySelectorAll('.cam-badge')).toHaveLength(2));
     act(() => {
       useRosterStore.setState((s) => ({ players: s.players.map((p) => (p.name === 'Ann' ? { ...p, photoVersion: 1 } : p)) }));
     });
```

- [ ] **Step 2: Run the tests**

```bash
for i in 1 2 3 4 5 6 7 8 9 10; do npx vitest run src/ui/savedPlayers.test.tsx || exit 1; done
```

Expected: PASS.

- [ ] **Step 3: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/ui/savedPlayers.test.tsx
git commit -m "Make the camera badge test wait for both players"
```

## Task 2: A finished game can carry a result

A finished game can now record which team won and, optionally, the score. `finishGame` takes an optional result and refuses nonsense (a winning score that is not higher, a fraction or a negative). Saved sessions with results load again after a reload.

**Files:**
- Modify: `src/engine/types.ts`, `errors.ts`, `game.ts`, `src/store/persistence.ts`, `src/store/persistence.test.ts`
- Test: `src/engine/result.test.ts`

- [ ] **Step 1: Create `src/engine/result.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { finishGame } from './game';
import { assertInvariants } from './invariants';
import { startAllReady } from './start';
import { expectEngineError, makeCtx, newTestSession } from './testing';
import type { GameResult } from './types';

const NAMES = ['A', 'B', 'C', 'D', 'E'];
const play = () => newTestSession(NAMES, { courts: 1 });
const finish = (result?: GameResult) => {
  const s = play();
  return finishGame(s, s.courts[0].id, makeCtx(1, 60_000), result);
};

describe('finishGame with a result', () => {
  it('records the winner and the score, team 1 first', () => {
    const s = finish({ winner: 1, score: [11, 7] });
    expect(s.history[0].winner).toBe(1);
    expect(s.history[0].score).toEqual([11, 7]);
    assertInvariants(s);
  });

  it('keeps the score in team order when team 2 wins', () => {
    const s = finish({ winner: 2, score: [4, 11] });
    expect(s.history[0].winner).toBe(2);
    expect(s.history[0].score).toEqual([4, 11]);
  });

  it('records a winner without a score', () => {
    const h = finish({ winner: 2 }).history[0];
    expect(h.winner).toBe(2);
    expect(h).not.toHaveProperty('score');
  });

  it('records nothing for a game finished without a result, as before', () => {
    const h = finish().history[0];
    expect(h).not.toHaveProperty('winner');
    expect(h).not.toHaveProperty('score');
    expect(Object.keys(h).sort()).toEqual(['courtNumber', 'finishedAt', 'startedAt', 'team1', 'team2']);
  });

  it('accepts a win above the target, such as 12 to 10, and a 0 score', () => {
    expect(finish({ winner: 1, score: [12, 10] }).history[0].score).toEqual([12, 10]);
    expect(finish({ winner: 1, score: [11, 0] }).history[0].score).toEqual([11, 0]);
  });

  it('does not change who played whom or how many games anyone has', () => {
    const plain = finish();
    const withResult = finish({ winner: 1, score: [11, 5] });
    expect(withResult.players).toEqual(plain.players);
    expect(withResult.courts).toEqual(plain.courts);
    expect(withResult.queueOrder).toEqual(plain.queueOrder);
    expect(withResult.gameSeq).toBe(plain.gameSeq);
  });

  it('copies the score, so changing the input afterwards does not change the history', () => {
    const score: [number, number] = [11, 6];
    const s = finish({ winner: 1, score });
    score[0] = 99;
    expect(s.history[0].score).toEqual([11, 6]);
  });

  it('works for a game started from a Ready court', () => {
    let s = newTestSession(NAMES, { courts: 1, autoStart: false });
    s = startAllReady(s, makeCtx(1, 1_000));
    s = finishGame(s, s.courts[0].id, makeCtx(1, 90_000), { winner: 2, score: [3, 11] });
    expect(s.history[0]).toMatchObject({ winner: 2, score: [3, 11], startedAt: 1_000, finishedAt: 90_000 });
    expect(s.courts[0].status).toBe('ready');
    assertInvariants(s);
  });
});

describe('a result that does not make sense', () => {
  const bad = (result: unknown) => {
    const s = play();
    return () => finishGame(s, s.courts[0].id, makeCtx(), result as GameResult);
  };

  it('is refused when the winning score is not higher', () => {
    expectEngineError(bad({ winner: 1, score: [7, 11] }), 'INVALID_RESULT');
    expectEngineError(bad({ winner: 2, score: [11, 7] }), 'INVALID_RESULT');
    expectEngineError(bad({ winner: 1, score: [9, 9] }), 'INVALID_RESULT');
  });

  it('is refused for a negative or fractional score', () => {
    expectEngineError(bad({ winner: 1, score: [11, -1] }), 'INVALID_RESULT');
    expectEngineError(bad({ winner: 1, score: [11.5, 3] }), 'INVALID_RESULT');
    expectEngineError(bad({ winner: 1, score: [Number.NaN, 3] }), 'INVALID_RESULT');
  });

  it('is refused for a winner that is not team 1 or team 2', () => {
    expectEngineError(bad({ winner: 3 }), 'INVALID_RESULT');
    expectEngineError(bad({ winner: 0, score: [11, 5] }), 'INVALID_RESULT');
  });

  it('changes nothing when it is refused', () => {
    const s = play();
    const before = JSON.stringify(s);
    expect(() => finishGame(s, s.courts[0].id, makeCtx(), { winner: 1, score: [3, 3] })).toThrow();
    expect(JSON.stringify(s)).toBe(before);
  });
});
```

- [ ] **Step 2: Apply this change to `src/store/persistence.test.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/store/persistence.test.ts
+++ b/src/store/persistence.test.ts
@@ -136,3 +136,33 @@
     expect(loadPersisted()).toBeNull();
   });
 });
+
+describe('a session with recorded results', () => {
+  function played() {
+    const s = newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }, makeCtx());
+    s.history.push({ team1: ['a', 'b'], team2: ['c', 'd'], courtNumber: 1, startedAt: 1, finishedAt: 2, winner: 1, score: [11, 7] });
+    s.history.push({ team1: ['a', 'b'], team2: ['c', 'd'], courtNumber: 1, startedAt: 3, finishedAt: 4 });
+    return s;
+  }
+
+  it('survives a reload with its winners and scores, and games without a result', () => {
+    const s = played();
+    savePersisted({ session: s, undoStack: [] });
+    expect(loadPersisted()?.session).toEqual(s);
+  });
+
+  it('is rejected when a winner or a score is malformed', () => {
+    for (const change of [
+      (g: Record<string, unknown>) => (g.winner = 3),
+      (g: Record<string, unknown>) => (g.winner = 'one'),
+      (g: Record<string, unknown>) => (g.score = [11]),
+      (g: Record<string, unknown>) => (g.score = [11, 'x']),
+      (g: Record<string, unknown>) => (g.score = 'eleven to seven'),
+    ]) {
+      const broken = JSON.parse(JSON.stringify(played()));
+      change(broken.history[0]);
+      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, session: broken, undoStack: [] }));
+      expect(loadPersisted()).toBeNull();
+    }
+  });
+});
```

- [ ] **Step 3: Run the tests**

```bash
npx vitest run src/engine/result.test.ts src/store/persistence.test.ts
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 4: Apply this change to `src/engine/types.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -43,12 +43,23 @@
   lineup?: Lineup;
 }
 
+/** What the organizer recorded when a game finished. Both parts are optional: a result can be skipped. */
+export interface GameResult {
+  winner: 1 | 2;
+  /** Team 1's points, then team 2's. Present only when the organizer gave a score. */
+  score?: [number, number];
+}
+
 export interface FinishedGame {
   team1: Team;
   team2: Team;
   courtNumber: number;
   startedAt: number;
   finishedAt: number;
+  /** Which team won, when a result was recorded. */
+  winner?: 1 | 2;
+  /** Team 1's points, then team 2's, when a score was recorded. */
+  score?: [number, number];
 }
 
 export interface Session {
```

- [ ] **Step 5: Apply this change to `src/engine/errors.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/errors.ts
+++ b/src/engine/errors.ts
@@ -6,6 +6,7 @@
   | 'NOT_FOUND'
   | 'NOT_PLAYING'
   | 'NOT_READY'
+  | 'INVALID_RESULT'
   | 'CANNOT_RETURN';
 
 export class EngineError extends Error {
```

- [ ] **Step 6: Apply this change to `src/engine/game.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/game.ts
+++ b/src/engine/game.ts
@@ -2,13 +2,32 @@
 import { EngineError } from './errors';
 import { fillCourts } from './fill';
 import { playerById } from './pool';
-import type { Ctx, PlayerId, Session } from './types';
+import type { Ctx, GameResult, PlayerId, Session } from './types';
 
 function bump(counts: Record<PlayerId, number>, id: PlayerId): void {
   counts[id] = (counts[id] ?? 0) + 1;
 }
 
-export function finishGame(s: Session, courtId: string, ctx: Ctx): Session {
+/** A recorded result must name a team, and a score must be whole numbers with the winner ahead. */
+function checkResult(result: GameResult): void {
+  if (result.winner !== 1 && result.winner !== 2) {
+    throw new EngineError('INVALID_RESULT', 'Choose which team won.');
+  }
+  if (!result.score) return;
+  const [a, b] = result.score;
+  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
+    throw new EngineError('INVALID_RESULT', 'A score is a whole number, from 0 up.');
+  }
+  const winning = result.winner === 1 ? a : b;
+  const losing = result.winner === 1 ? b : a;
+  if (winning <= losing) {
+    throw new EngineError('INVALID_RESULT', 'The winning score must be higher than the losing score.');
+  }
+}
+
+/** Finishes the game on a court. With a `result`, the winner (and score) are recorded; without one nothing is. */
+export function finishGame(s: Session, courtId: string, ctx: Ctx, result?: GameResult): Session {
+  if (result) checkResult(result);
   const n = cloneSession(s);
   const court = n.courts.find((c) => c.id === courtId);
   if (!court) throw new EngineError('NOT_FOUND', 'Court not found.');
@@ -36,7 +55,15 @@
     }
   }
 
-  n.history.push({ team1, team2, courtNumber: court.number, startedAt, finishedAt: ctx.now });
+  n.history.push({
+    team1,
+    team2,
+    courtNumber: court.number,
+    startedAt,
+    finishedAt: ctx.now,
+    ...(result ? { winner: result.winner } : {}),
+    ...(result?.score ? { score: [result.score[0], result.score[1]] as [number, number] } : {}),
+  });
 
   // Apply break/leave requests made while the game was running, then re-queue.
   for (const id of everyone) {
```

- [ ] **Step 7: Apply this change to `src/store/persistence.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/store/persistence.ts
+++ b/src/store/persistence.ts
@@ -54,7 +54,9 @@
     isTeam(x.team2) &&
     isNum(x.courtNumber) &&
     isNum(x.startedAt) &&
-    isNum(x.finishedAt)
+    isNum(x.finishedAt) &&
+    (x.winner === undefined || x.winner === 1 || x.winner === 2) &&
+    (x.score === undefined || (Array.isArray(x.score) && x.score.length === 2 && x.score.every(isNum)))
   );
 }
 
```

- [ ] **Step 8: Run the tests**

```bash
npx vitest run src/engine src/store
```

Expected: PASS.

- [ ] **Step 9: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/engine/types.ts src/engine/errors.ts src/engine/game.ts src/store/persistence.ts src/store/persistence.test.ts src/engine/result.test.ts
git commit -m "Record the winner and score of a finished game"
```

## Task 3: Records and results in the summary engine

The summary engine counts wins and losses per player and per partner pair from the games that have a winner, carries results into the game log, and can add records to the shared text when asked. Skipped results count for nothing.

**Files:**
- Modify: `src/engine/summary.ts`, `src/engine/index.ts`
- Test: `src/engine/summaryResults.test.ts`

- [ ] **Step 1: Create `src/engine/summaryResults.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { finishGame } from './game';
import { fairnessLine, formatSummaryText, gameLog, hasResults, sessionStats, summarize } from './summary';
import { idOf, makeCtx, newTestSession } from './testing';
import type { GameResult, Session } from './types';

/** Four players, one court, one game finished with the given result. Ann and Ben are team 1. */
function oneGame(result?: GameResult): Session {
  let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee'], { courts: 1 });
  const court = s.courts[0];
  // Put the teams in a known order so the expectations can name them.
  court.game = { team1: [idOf(s, 'Ann'), idOf(s, 'Ben')], team2: [idOf(s, 'Cy'), idOf(s, 'Dee')], startedAt: 1_000 };
  s = finishGame(s, court.id, makeCtx(1, 61_000), result);
  return s;
}
const row = (s: Session, name: string) => summarize(s).find((r) => r.name === name)!;

describe('records in the summary', () => {
  it('counts a win for the winners and a loss for the others', () => {
    const s = oneGame({ winner: 1, score: [11, 4] });
    expect(row(s, 'Ann')).toMatchObject({ wins: 1, losses: 0 });
    expect(row(s, 'Ben')).toMatchObject({ wins: 1, losses: 0 });
    expect(row(s, 'Cy')).toMatchObject({ wins: 0, losses: 1 });
    expect(row(s, 'Dee')).toMatchObject({ wins: 0, losses: 1 });
  });

  it('counts a winner recorded without a score, and ignores a skipped result', () => {
    expect(row(oneGame({ winner: 2 }), 'Cy')).toMatchObject({ wins: 1, losses: 0 });
    const skipped = oneGame();
    expect(row(skipped, 'Ann')).toMatchObject({ wins: 0, losses: 0 });
    expect(hasResults(skipped)).toBe(false);
    expect(hasResults(oneGame({ winner: 1 }))).toBe(true);
  });

  it('gives each partner pair its own record, both ways round', () => {
    const s = oneGame({ winner: 1, score: [11, 4] });
    expect(row(s, 'Ann').partners).toEqual([{ name: 'Ben', count: 1, wins: 1, losses: 0 }]);
    expect(row(s, 'Ben').partners).toEqual([{ name: 'Ann', count: 1, wins: 1, losses: 0 }]);
    expect(row(s, 'Cy').partners).toEqual([{ name: 'Dee', count: 1, wins: 0, losses: 1 }]);
  });

  it('gives a partner with no recorded result a record of nothing', () => {
    expect(row(oneGame(), 'Ann').partners).toEqual([{ name: 'Ben', count: 1, wins: 0, losses: 0 }]);
  });

  it('adds up over several games with different partners', () => {
    let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee'], { courts: 1 });
    const ids = ['Ann', 'Ben', 'Cy', 'Dee'].map((n) => idOf(s, n));
    const game = (t1: [number, number], t2: [number, number], winner: 1 | 2, at: number) => {
      s.courts[0].game = { team1: [ids[t1[0]], ids[t1[1]]], team2: [ids[t2[0]], ids[t2[1]]], startedAt: at };
      s = finishGame(s, s.courts[0].id, makeCtx(1, at + 600_000), { winner, score: winner === 1 ? [11, 5] : [5, 11] });
    };
    game([0, 1], [2, 3], 1, 1_000); // Ann and Ben beat Cy and Dee
    game([0, 2], [1, 3], 1, 700_000); // Ann and Cy beat Ben and Dee
    game([0, 3], [1, 2], 2, 1_400_000); // Ben and Cy beat Ann and Dee
    expect(row(s, 'Ann')).toMatchObject({ wins: 2, losses: 1 });
    expect(row(s, 'Dee')).toMatchObject({ wins: 0, losses: 3 });
    expect(row(s, 'Ann').partners.find((p) => p.name === 'Ben')).toMatchObject({ wins: 1, losses: 0 });
    expect(row(s, 'Ann').partners.find((p) => p.name === 'Dee')).toMatchObject({ wins: 0, losses: 1 });
  });

  it('leaves the games, partner and opponent counts as they were', () => {
    const a = row(oneGame(), 'Ann');
    const b = row(oneGame({ winner: 1, score: [11, 2] }), 'Ann');
    expect(b.gamesPlayed).toBe(a.gamesPlayed);
    expect(b.opponents).toEqual(a.opponents);
    expect(fairnessLine(sessionStats(oneGame({ winner: 1 })))).toBe(fairnessLine(sessionStats(oneGame())));
  });
});

describe('the game log', () => {
  it('carries the winner and the score when there are some, and nothing when there are not', () => {
    expect(gameLog(oneGame({ winner: 2, score: [6, 11] }))[0]).toMatchObject({ winner: 2, score: [6, 11] });
    const plain = gameLog(oneGame())[0];
    expect(plain).not.toHaveProperty('winner');
    expect(plain).not.toHaveProperty('score');
  });
});

describe('the shared text', () => {
  it('leaves results out unless asked', () => {
    const text = formatSummaryText(oneGame({ winner: 1, score: [11, 4] }));
    expect(text).toContain('Ann: 1');
    expect(text).not.toMatch(/\dW|\dL/);
  });

  it('adds each player’s record when asked, and only for players who have one', () => {
    const text = formatSummaryText(oneGame({ winner: 1, score: [11, 4] }), 0, { results: true });
    expect(text).toContain('Ann: 1 · 1W 0L');
    expect(text).toContain('Cy: 1 · 0W 1L');
    const skipped = formatSummaryText(oneGame(), 0, { results: true });
    expect(skipped).toContain('Ann: 1');
    expect(skipped).not.toMatch(/\dW|\dL/);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/engine/summaryResults.test.ts
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 3: Apply this change to `src/engine/summary.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/summary.ts
+++ b/src/engine/summary.ts
@@ -1,4 +1,10 @@
 import type { PlayerStatus, Session } from './types';
+
+/** Wins and losses over the games that have a recorded result. Skipped results count for nothing. */
+export interface WinLoss {
+  wins: number;
+  losses: number;
+}
 
 export interface PlayerSummary {
   id: string;
@@ -6,21 +12,50 @@
   gamesPlayed: number;
   status: PlayerStatus;
   rosterId?: string;
-  partners: { name: string; count: number }[];
+  wins: number;
+  losses: number;
+  partners: ({ name: string; count: number } & WinLoss)[];
   opponents: { name: string; count: number }[];
+}
+
+const none = (): WinLoss => ({ wins: 0, losses: 0 });
+
+/** Each player's record, and each pair's record as partners, from the games with a recorded winner. */
+function records(s: Session) {
+  const own = new Map<string, WinLoss>();
+  const pairs = new Map<string, WinLoss>();
+  const bump = (m: Map<string, WinLoss>, key: string, won: boolean) => {
+    const r = m.get(key) ?? none();
+    if (won) r.wins += 1;
+    else r.losses += 1;
+    m.set(key, r);
+  };
+  for (const g of s.history) {
+    if (g.winner === undefined) continue;
+    for (const [team, won] of [
+      [g.team1, g.winner === 1],
+      [g.team2, g.winner === 2],
+    ] as const) {
+      for (const id of team) bump(own, id, won);
+      bump(pairs, `${team[0]}|${team[1]}`, won);
+      bump(pairs, `${team[1]}|${team[0]}`, won);
+    }
+  }
+  return { own, pairs };
 }
 
 function named(counts: Record<string, number>, nameById: Map<string, string>) {
   return Object.entries(counts)
     .flatMap(([id, count]) => {
       const name = nameById.get(id);
-      return name ? [{ name, count }] : [];
+      return name ? [{ id, name, count }] : [];
     })
     .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
 }
 
 export function summarize(s: Session): PlayerSummary[] {
   const nameById = new Map(s.players.map((p) => [p.id, p.name]));
+  const { own, pairs } = records(s);
   return s.players
     .map((p) => ({
       id: p.id,
@@ -28,10 +63,22 @@
       gamesPlayed: p.gamesPlayed,
       status: p.status,
       rosterId: p.rosterId,
-      partners: named(p.partnerCounts, nameById),
-      opponents: named(p.opponentCounts, nameById),
+      wins: own.get(p.id)?.wins ?? 0,
+      losses: own.get(p.id)?.losses ?? 0,
+      partners: named(p.partnerCounts, nameById).map(({ id, name, count }) => ({
+        name,
+        count,
+        wins: pairs.get(`${p.id}|${id}`)?.wins ?? 0,
+        losses: pairs.get(`${p.id}|${id}`)?.losses ?? 0,
+      })),
+      opponents: named(p.opponentCounts, nameById).map(({ name, count }) => ({ name, count })),
     }))
     .sort((a, b) => b.gamesPlayed - a.gamesPlayed || a.name.localeCompare(b.name));
+}
+
+/** True when at least one finished game has a recorded winner. */
+export function hasResults(s: Session): boolean {
+  return s.history.some((g) => g.winner !== undefined);
 }
 
 export interface SessionStats {
@@ -81,6 +128,8 @@
   durationMs: number;
   team1: string[];
   team2: string[];
+  winner?: 1 | 2;
+  score?: [number, number];
 }
 
 /** Finished games in the order they were played, with names instead of ids. */
@@ -92,6 +141,8 @@
     durationMs: g.finishedAt - g.startedAt,
     team1: names(g.team1),
     team2: names(g.team2),
+    ...(g.winner === undefined ? {} : { winner: g.winner }),
+    ...(g.score === undefined ? {} : { score: g.score }),
   }));
 }
 
@@ -99,15 +150,19 @@
   return `${n} ${word}${n === 1 ? '' : 's'}`;
 }
 
-/** Short text for a group chat: a headline, then one "Name: games" line per player. No partner lists. */
-export function formatSummaryText(s: Session, tzOffsetMinutes = 0): string {
+/**
+ * Short text for a group chat: a headline, then one "Name: games" line per player. No partner lists. Win and loss
+ * records are left out unless `results` is true, because they can sting in a friendly group.
+ */
+export function formatSummaryText(s: Session, tzOffsetMinutes = 0, options: { results?: boolean } = {}): string {
   const date = new Date(s.createdAt + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
   const stats = sessionStats(s);
   const facts = [plural(stats.games, 'game') + ' played'];
   if (stats.games > 0) facts.push(formatDuration(stats.playingMs));
   const lines = [`${s.name} — ${date}`, facts.join(' · '), ''];
   for (const row of summarize(s)) {
-    lines.push(`${row.name}: ${row.gamesPlayed}`);
+    const record = options.results && row.wins + row.losses > 0 ? ` · ${row.wins}W ${row.losses}L` : '';
+    lines.push(`${row.name}: ${row.gamesPlayed}${record}`);
   }
   return lines.join('\n');
 }
```

- [ ] **Step 4: Apply this change to `src/engine/index.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/index.ts
+++ b/src/engine/index.ts
@@ -12,5 +12,5 @@
 export { orderedWaiting, availablePlayers, onCourtIds } from './pool';
 export { explainWaiting } from './explain';
 export type { WaitingExplanation } from './explain';
-export { summarize, formatSummaryText, sessionStats, formatDuration, fairnessLine, gameLog } from './summary';
-export type { PlayerSummary, SessionStats, GameLogEntry } from './summary';
+export { summarize, formatSummaryText, sessionStats, formatDuration, fairnessLine, gameLog, hasResults } from './summary';
+export type { PlayerSummary, SessionStats, GameLogEntry, WinLoss } from './summary';
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/engine
```

Expected: PASS.

- [ ] **Step 6: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/engine/summary.ts src/engine/index.ts src/engine/summaryResults.test.ts
git commit -m "Count wins and losses in the summary engine"
```

## Task 4: The result sheet when a game finishes

Game finished now opens a sheet. First "who won?" with a big button per team, then the score with a stepper for the winning score (starting at the play-to target) and a row of numbers for the other side. A tap on a number saves. Skip result, Skip score, Change winner and closing are all there, and the game keeps running until the organizer answers. Settings gets Play to (11, 15 or 21). The Undo bar says the result.

**Files:**
- Create: `src/ui/ResultSheet.tsx`
- Modify: `src/ui/prefs.ts`, `src/ui/LiveScreen.tsx`, `src/ui/SettingsScreen.tsx`, `src/styles/app.css`, and four older test files
- Test: `src/ui/ResultSheet.test.tsx`, `src/ui/finishWithResult.test.tsx`

- [ ] **Step 1: Create `src/ui/ResultSheet.test.tsx`**

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ResultSheet } from './ResultSheet';

function setup(playTo = 11) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(<ResultSheet courtNumber={2} team1={['Ann', 'Ben']} team2={['Cy', 'Dee']} playTo={playTo} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose, user: userEvent.setup() };
}
const chips = () => within(screen.getByRole('group', { name: 'Their score' })).getAllByRole('button');
const winning = () => screen.getByRole('group', { name: 'Winning score' }).querySelector('output')!.textContent;

describe('ResultSheet, who won', () => {
  it('asks who won on a named court, with one big button per team showing the names', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Court 2: who won?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ann and Ben' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cy and Dee' })).toBeInTheDocument();
  });

  it('skips the result with one tap, saving nothing', async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole('button', { name: 'Skip result' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith();
  });

  it('closes without saving from the close button and from Escape', async () => {
    const { user, onClose, onSave } = setup();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('ResultSheet, the score', () => {
  it('moves to the score after a winner is chosen, and names the winners', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Cy and Dee' }));
    expect(screen.getByRole('dialog', { name: 'Court 2: score' })).toBeInTheDocument();
    expect(screen.getByText('Cy and Dee won')).toBeInTheDocument();
  });

  it('starts the winning score at the target, and a tap on a losing score saves it in team order', async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole('button', { name: 'Ann and Ben' }));
    expect(winning()).toBe('11');
    await user.click(screen.getByRole('button', { name: '7' }));
    expect(onSave).toHaveBeenCalledWith({ winner: 1, score: [11, 7] });
  });

  it('puts team 2’s points second when team 1 wins and first when team 2 wins', async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole('button', { name: 'Cy and Dee' }));
    await user.click(screen.getByRole('button', { name: '4' }));
    expect(onSave).toHaveBeenCalledWith({ winner: 2, score: [4, 11] });
  });

  it.each([
    [11, 0, 10],
    [15, 0, 14],
    [21, 0, 20],
  ])('with play to %i offers losing scores %i to %i', async (playTo, low, high) => {
    const { user } = setup(playTo);
    await user.click(screen.getByRole('button', { name: 'Ann and Ben' }));
    expect(winning()).toBe(String(playTo));
    expect(chips().map((c) => c.textContent)).toEqual(Array.from({ length: high - low + 1 }, (_, i) => String(low + i)));
  });

  it('lets the winning score go up for a win past the target, and offers losing scores to match', async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole('button', { name: 'Ann and Ben' }));
    await user.click(screen.getByRole('button', { name: 'Raise the winning score' }));
    await user.click(screen.getByRole('button', { name: 'Raise the winning score' }));
    expect(winning()).toBe('13');
    expect(chips().at(-1)!.textContent).toBe('12');
    await user.click(screen.getByRole('button', { name: '11' }));
    expect(onSave).toHaveBeenCalledWith({ winner: 1, score: [13, 11] });
  });

  it('turns off losing scores that are not below the winning score, when it is lowered', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Ann and Ben' }));
    for (let i = 0; i < 4; i++) await user.click(screen.getByRole('button', { name: 'Lower the winning score' }));
    expect(winning()).toBe('7');
    expect(screen.getByRole('button', { name: '6' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '7' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '10' })).toBeDisabled();
  });

  it('will not go below a winning score of 1 or above 99', async () => {
    const { user } = setup(11);
    await user.click(screen.getByRole('button', { name: 'Ann and Ben' }));
    const lower = screen.getByRole('button', { name: 'Lower the winning score' });
    for (let i = 0; i < 12; i++) await user.click(lower);
    expect(winning()).toBe('1');
    expect(lower).toBeDisabled();
  });

  it('skips only the score, keeping the winner', async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole('button', { name: 'Cy and Dee' }));
    await user.click(screen.getByRole('button', { name: 'Skip score' }));
    expect(onSave).toHaveBeenCalledWith({ winner: 2 });
  });

  it('goes back to choose the winner again, and keeps the winning score set so far', async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole('button', { name: 'Ann and Ben' }));
    await user.click(screen.getByRole('button', { name: 'Raise the winning score' }));
    await user.click(screen.getByRole('button', { name: 'Change winner' }));
    expect(screen.getByRole('dialog', { name: 'Court 2: who won?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cy and Dee' }));
    expect(winning()).toBe('12');
    await user.click(screen.getByRole('button', { name: '3' }));
    expect(onSave).toHaveBeenCalledWith({ winner: 2, score: [3, 12] });
  });
});
```

- [ ] **Step 2: Create `src/ui/finishWithResult.test.tsx`**

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import App from './App';

type User = ReturnType<typeof userEvent.setup>;

// Games start by themselves here, so the court in view is already playing.
beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('pickleball.autoStart', 'true');
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false, lastAction: null });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => vi.restoreAllMocks());

const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.fromCharCode(65 + i)}`).join('{enter}');

async function startSession(user: User, count = 5) {
  render(<App />);
  await user.type(screen.getByLabelText('Search or add players'), names(count));
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('button', { name: `Start ${count} players` }));
}
const finishButton = () => screen.getByRole('button', { name: /^Game finished/ });
const sheet = (name: RegExp | string) => screen.findByRole('dialog', { name });
const history = () => useSessionStore.getState().session!.history;
const bar = () => document.querySelector<HTMLElement>('.undo-bar');
const teamNames = () => {
  const game = useSessionStore.getState().session!.courts[0].game!;
  const nameOf = (id: string) => useSessionStore.getState().session!.players.find((p) => p.id === id)!.name;
  return { team1: game.team1.map(nameOf), team2: game.team2.map(nameOf) };
};

describe('pressing Game finished', () => {
  it('asks who won first, and the game keeps running until the organizer answers', async () => {
    const user = userEvent.setup();
    await startSession(user);
    await user.click(finishButton());
    expect(await sheet('Court 1: who won?')).toBeInTheDocument();
    expect(history()).toHaveLength(0);
    expect(useSessionStore.getState().session!.courts[0].status).toBe('playing');
  });

  it('names both teams on the winner buttons', async () => {
    const user = userEvent.setup();
    await startSession(user);
    const { team1, team2 } = teamNames();
    await user.click(finishButton());
    const dialog = within(await sheet('Court 1: who won?'));
    expect(dialog.getByRole('button', { name: team1.join(' and ') })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: team2.join(' and ') })).toBeInTheDocument();
  });

  it('closing the sheet leaves the game running and records nothing', async () => {
    const user = userEvent.setup();
    await startSession(user);
    await user.click(finishButton());
    await user.click(within(await sheet('Court 1: who won?')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(history()).toHaveLength(0);
    expect(useSessionStore.getState().session!.courts[0].status).toBe('playing');
    expect(bar()).toBeNull();
  });
});

describe('recording a result', () => {
  it('takes two taps: the winner, then the losing score, and saves winner and score', async () => {
    const user = userEvent.setup();
    await startSession(user);
    const { team1 } = teamNames();
    await user.click(finishButton());
    await user.click(within(await sheet('Court 1: who won?')).getByRole('button', { name: team1.join(' and ') }));
    await user.click(within(await sheet('Court 1: score')).getByRole('button', { name: '7' }));
    expect(history()).toHaveLength(1);
    expect(history()[0]).toMatchObject({ winner: 1, score: [11, 7] });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says the result on the Undo bar, and Undo takes the whole result back', async () => {
    const user = userEvent.setup();
    await startSession(user);
    const { team2 } = teamNames();
    await user.click(finishButton());
    await user.click(within(await sheet('Court 1: who won?')).getByRole('button', { name: team2.join(' and ') }));
    await user.click(within(await sheet('Court 1: score')).getByRole('button', { name: '9' }));
    expect(bar()!.textContent).toBe(`Court 1: ${team2.join(' and ')} won 11 to 9Undo`);
    await user.click(within(bar()!).getByRole('button', { name: 'Undo' }));
    expect(history()).toHaveLength(0);
    expect(useSessionStore.getState().session!.courts[0].status).toBe('playing');
  });

  it('records a winner alone with Skip score, and says it without a score', async () => {
    const user = userEvent.setup();
    await startSession(user);
    const { team1 } = teamNames();
    await user.click(finishButton());
    await user.click(within(await sheet('Court 1: who won?')).getByRole('button', { name: team1.join(' and ') }));
    await user.click(within(await sheet('Court 1: score')).getByRole('button', { name: 'Skip score' }));
    expect(history()[0].winner).toBe(1);
    expect(history()[0]).not.toHaveProperty('score');
    expect(bar()!.textContent).toBe(`Court 1: ${team1.join(' and ')} wonUndo`);
  });

  it('records nothing with Skip result, and the Undo bar just says the game finished', async () => {
    const user = userEvent.setup();
    await startSession(user);
    await user.click(finishButton());
    await user.click(within(await sheet('Court 1: who won?')).getByRole('button', { name: 'Skip result' }));
    expect(history()).toHaveLength(1);
    expect(history()[0]).not.toHaveProperty('winner');
    expect(bar()!.textContent).toBe('Game finished on Court 1Undo');
  });

  it('still starts the next game as before, and counts the game for everyone', async () => {
    const user = userEvent.setup();
    await startSession(user);
    await user.click(finishButton());
    await user.click(within(await sheet('Court 1: who won?')).getByRole('button', { name: 'Skip result' }));
    const session = useSessionStore.getState().session!;
    expect(session.players.filter((p) => p.gamesPlayed === 1)).toHaveLength(4);
    expect(session.courts[0].status).toBe('playing');
  });

  it('is one undo step', async () => {
    const user = userEvent.setup();
    await startSession(user);
    const before = useSessionStore.getState().undoStack.length;
    await user.click(finishButton());
    await user.click(within(await sheet('Court 1: who won?')).getByRole('button', { name: 'Skip result' }));
    expect(useSessionStore.getState().undoStack.length).toBe(before + 1);
  });
});

describe('Settings, Play to', () => {
  it('starts at 11, remembers 15 or 21, and sets where the winning score starts', async () => {
    const user = userEvent.setup();
    await startSession(user);
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    const group = within(screen.getByRole('radiogroup', { name: 'Play to' }));
    expect(group.getByRole('radio', { name: '11' })).toBeChecked();
    await user.click(group.getByRole('radio', { name: '15' }));
    expect(localStorage.getItem('pickleball.playTo')).toBe('15');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(finishButton());
    await user.click(within(await sheet('Court 1: who won?')).getAllByRole('button')[1]);
    const winning = screen.getByRole('group', { name: 'Winning score' }).querySelector('output')!;
    expect(winning.textContent).toBe('15');
  });

  it('treats a value it does not know as 11', async () => {
    localStorage.setItem('pickleball.playTo', '13');
    const user = userEvent.setup();
    await startSession(user);
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    expect(within(screen.getByRole('radiogroup', { name: 'Play to' })).getByRole('radio', { name: '11' })).toBeChecked();
  });
});
```

- [ ] **Step 3: Apply this change to `src/ui/App.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/App.test.tsx
+++ b/src/ui/App.test.tsx
@@ -75,6 +75,8 @@
 
     await user.click(within(court).getByRole('button', { name: /game finished/i }));
 
+    await user.click(await screen.findByRole('button', { name: 'Skip result' }));
+
     const courtAfter = screen.getByRole('tabpanel', { name: 'Court 1' });
     expect(within(courtAfter).getByText(waiterName)).toBeInTheDocument();
     expect(screen.getByText('1 game played')).toBeInTheDocument();
@@ -109,6 +111,8 @@
     expect(within(screen.getByRole('tabpanel', { name: 'Court 1' })).getByText('Break next')).toBeInTheDocument();
 
     await user.click(within(screen.getByRole('tabpanel', { name: 'Court 1' })).getByRole('button', { name: /game finished/i }));
+
+    await user.click(await screen.findByRole('button', { name: 'Skip result' }));
 
     const breakList = await screen.findByRole('list', { name: 'On break' });
     expect(within(breakList).getByText(playerName)).toBeInTheDocument();
```

- [ ] **Step 4: Apply this change to `src/ui/liveScreen.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/liveScreen.test.tsx
+++ b/src/ui/liveScreen.test.tsx
@@ -99,6 +99,7 @@
     expect(panel.querySelectorAll('.tile')).toHaveLength(4);
     expect(within(panel).getByText('vs')).toBeInTheDocument();
     await user.click(within(panel).getByRole('button', { name: /game finished/i }));
+    await user.click(await screen.findByRole('button', { name: 'Skip result' }));
     expect(screen.getByText('1 game played')).toBeInTheDocument();
   });
 });
@@ -328,6 +329,7 @@
     await startSession(user, FIVE);
     const panel = screen.getByRole('tabpanel', { name: 'Court 1' });
     await user.click(within(panel).getByRole('button', { name: /game finished/i }));
+    await user.click(await screen.findByRole('button', { name: 'Skip result' }));
     expect(screen.getByRole('list', { name: 'Next game players' })).toBeInTheDocument();
   });
 
```

- [ ] **Step 5: Apply this change to `src/ui/oneUndo.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/oneUndo.test.tsx
+++ b/src/ui/oneUndo.test.tsx
@@ -46,6 +46,7 @@
     await user.click(screen.getByRole('button', { name: /^Start game/ }));
     expect(bar()!.textContent).toBe('Started Court 1Undo');
     await user.click(screen.getByRole('button', { name: /^Game finished/ }));
+    await user.click(await screen.findByRole('button', { name: 'Skip result' }));
     expect(bar()!.textContent).toBe('Game finished on Court 1Undo');
     expect(document.querySelectorAll('.undo-bar')).toHaveLength(1);
     await user.click(within(bar()!).getByRole('button', { name: 'Undo' }));
```

- [ ] **Step 6: Apply this change to `src/ui/readyStep.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/readyStep.test.tsx
+++ b/src/ui/readyStep.test.tsx
@@ -90,6 +90,7 @@
     await user.click(startButton());
     const startedAt = court(1).game!.startedAt;
     await user.click(within(panel()).getByRole('button', { name: /^Game finished/ }));
+    await user.click(await screen.findByRole('button', { name: 'Skip result' }));
     expect(court(1).status).toBe('ready');
     expect(undoBar()!.textContent).toBe('Game finished on Court 1Undo');
     expect(startButton()).toBeInTheDocument();
```

- [ ] **Step 7: Run the tests**

```bash
npx vitest run src/ui/ResultSheet.test.tsx src/ui/finishWithResult.test.tsx src/ui/oneUndo.test.tsx src/ui/readyStep.test.tsx
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 8: Create `src/ui/ResultSheet.tsx`**

```tsx
import { useState } from 'react';
import type { GameResult } from '../engine';
import { Sheet } from './Sheet';

interface Props {
  courtNumber: number;
  team1: string[];
  team2: string[];
  /** 11, 15 or 21: where the winner's score starts. */
  playTo: number;
  /** Called with the result, or with nothing when it is skipped. */
  onSave: (result?: GameResult) => void;
  /** Close without finishing the game. */
  onClose: () => void;
}

const join = (names: string[]) => names.join(' and ');

/**
 * Who won, then the score, with no typing: two team buttons, then a stepper for the winning score and a row of numbers
 * for the losing score. A tap on a number saves. Skipping is always possible, and closing leaves the game running.
 */
export function ResultSheet({ courtNumber, team1, team2, playTo, onSave, onClose }: Props) {
  const [winner, setWinner] = useState<1 | 2 | null>(null);
  const [winning, setWinning] = useState(playTo);

  if (winner === null) {
    return (
      <Sheet title={`Court ${courtNumber}: who won?`} onClose={onClose}>
        <div className="result-teams">
          <button type="button" className="btn btn-block result-team" onClick={() => setWinner(1)}>
            {join(team1)}
          </button>
          <button type="button" className="btn btn-block result-team" onClick={() => setWinner(2)}>
            {join(team2)}
          </button>
        </div>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => onSave()}>
          Skip result
        </button>
      </Sheet>
    );
  }

  const winners = winner === 1 ? team1 : team2;
  // Losing scores run up to just under the winning one, and past the target when the winner is past it.
  const top = Math.max(playTo - 1, winning - 1);
  const chips = Array.from({ length: top + 1 }, (_, n) => n);
  const save = (losing: number) => onSave({ winner, score: winner === 1 ? [winning, losing] : [losing, winning] });

  return (
    <Sheet title={`Court ${courtNumber}: score`} onClose={onClose}>
      <p className="result-winners">{join(winners)} won</p>

      <div className="result-winning" role="group" aria-label="Winning score">
        <button type="button" className="btn icon-btn" aria-label="Lower the winning score" disabled={winning <= 1} onClick={() => setWinning(winning - 1)}>
          −
        </button>
        <output className="result-number" aria-live="polite">
          {winning}
        </output>
        <button type="button" className="btn icon-btn" aria-label="Raise the winning score" disabled={winning >= 99} onClick={() => setWinning(winning + 1)}>
          +
        </button>
      </div>

      <p className="label" id="losing-label">
        Their score
      </p>
      <div className="score-chips" role="group" aria-labelledby="losing-label">
        {chips.map((n) => (
          <button key={n} type="button" className="btn score-chip" disabled={n >= winning} onClick={() => save(n)}>
            {n}
          </button>
        ))}
      </div>

      <div className="result-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setWinner(null)}>
          Change winner
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onSave({ winner })}>
          Skip score
        </button>
      </div>
    </Sheet>
  );
}
```

- [ ] **Step 9: Apply this change to `src/ui/prefs.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/prefs.ts
+++ b/src/ui/prefs.ts
@@ -5,6 +5,11 @@
 export const VIBRATE_KEY = 'pickleball.vibrate';
 export const COURTS_KEY = 'pickleball.courts';
 export const AUTO_START_KEY = 'pickleball.autoStart';
+export const PLAY_TO_KEY = 'pickleball.playTo';
+
+/** The scores a game can be played to. */
+export const PLAY_TO_CHOICES = [11, 15, 21] as const;
+export type PlayTo = (typeof PLAY_TO_CHOICES)[number];
 
 const listeners = new Set<() => void>();
 const memory = new Map<string, string>();
@@ -61,3 +66,18 @@
 export function setNumPref(key: string, value: number): void {
   write(key, String(value));
 }
+
+/** What a game is played to: 11 unless the organizer chose 15 or 21. Anything else in storage means 11. */
+export function getPlayTo(): PlayTo {
+  const n = getNumPref(PLAY_TO_KEY, 11, 1, 99);
+  return (PLAY_TO_CHOICES as readonly number[]).includes(n) ? (n as PlayTo) : 11;
+}
+
+export function usePlayTo(): [PlayTo, (value: PlayTo) => void] {
+  const value = useSyncExternalStore(
+    subscribe,
+    () => getPlayTo(),
+    () => 11 as PlayTo,
+  );
+  return [value, (v) => setNumPref(PLAY_TO_KEY, v)];
+}
```

- [ ] **Step 10: Apply this change to `src/ui/LiveScreen.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/LiveScreen.tsx
+++ b/src/ui/LiveScreen.tsx
@@ -1,6 +1,6 @@
 import { useMemo, useState } from 'react';
 import * as engine from '../engine';
-import type { Session } from '../engine';
+import type { GameResult, Session } from '../engine';
 import { useRosterStore } from '../store/rosterStore';
 import { useSessionStore, type SessionAction } from '../store/sessionStore';
 import { AccountButton } from './AccountButton';
@@ -9,7 +9,8 @@
 import { CourtTabs } from './CourtTabs';
 import { LiveMenu } from './LiveMenu';
 import { PlayerSheet } from './PlayerSheet';
-import { getBoolPref, VIBRATE_KEY } from './prefs';
+import { ResultSheet } from './ResultSheet';
+import { getBoolPref, getPlayTo, VIBRATE_KEY } from './prefs';
 import { UndoBar } from './UndoBar';
 import { useSwipe } from './useSwipe';
 import { WaitingSheet } from './WaitingSheet';
@@ -26,6 +27,8 @@
   /** Which way the court on show last moved, so the next one slides in from that side. */
   const [slide, setSlide] = useState<'from-right' | 'from-left' | null>(null);
   const [adding, setAdding] = useState(false);
+  /** The court whose Game finished button was pressed, while the result sheet is open. */
+  const [finishing, setFinishing] = useState<string | null>(null);
   const [error, setError] = useState<string | null>(null);
 
   const playersById = useMemo(
@@ -49,9 +52,20 @@
     return res.ok;
   }
 
-  /** Finishes a game, with a way back, and buzzes where the device allows. */
-  function finishCourt(courtId: string, courtNumber: number) {
-    if (!run((s, ctx) => engine.finishGame(s, courtId, ctx), `Game finished on Court ${courtNumber}`)) return;
+  /** What the Undo bar says about a finished game: the result when there is one, else just that it finished. */
+  function finishLabel(courtNumber: number, game: { team1: string[]; team2: string[] }, result?: GameResult) {
+    if (!result) return `Game finished on Court ${courtNumber}`;
+    const names = (result.winner === 1 ? game.team1 : game.team2).join(' and ');
+    const score = result.score ? ` ${Math.max(...result.score)} to ${Math.min(...result.score)}` : '';
+    return `Court ${courtNumber}: ${names} won${score}`;
+  }
+
+  /** Finishes a game with the result the organizer gave, or none, with a way back, and buzzes where the device allows. */
+  function finishCourt(courtId: string, courtNumber: number, result?: GameResult) {
+    const game = session.courts.find((c) => c.id === courtId)?.game;
+    const nameOf = (id: string) => playersById.get(id)?.name ?? 'Unknown';
+    const label = finishLabel(courtNumber, { team1: game?.team1.map(nameOf) ?? [], team2: game?.team2.map(nameOf) ?? [] }, result);
+    if (!run((s, ctx) => engine.finishGame(s, courtId, ctx, result), label)) return;
     // A short buzz where the device can, so a glance away from the screen still knows it registered.
     if (getBoolPref(VIBRATE_KEY, true)) {
       try {
@@ -76,6 +90,7 @@
 
   const sorted = [...session.courts].sort((a, b) => a.number - b.number);
   const readyCount = sorted.filter((c) => c.status === 'ready').length;
+  const finishingCourt = sorted.find((c) => c.id === finishing);
   // A court that is gone (removed once its game ended) falls back to the first one.
   const selected = sorted.find((c) => c.id === courtId) ?? sorted[0];
 
@@ -149,7 +164,7 @@
                 <CourtCard
                   court={selected}
                   playersById={playersById}
-                  onFinish={() => finishCourt(selected.id, selected.number)}
+                  onFinish={() => setFinishing(selected.id)}
                   onStart={() => startCourt(selected.id, selected.number)}
                   onSelectPlayer={selectPlayer}
                 />
@@ -165,6 +180,20 @@
       {selectedId && (
         <PlayerSheet session={session} playerId={selectedId} onClose={() => setSelectedId(null)} />
       )}
+      {finishing && finishingCourt?.game && (
+        <ResultSheet
+          courtNumber={finishingCourt.number}
+          team1={finishingCourt.game.team1.map((id) => playersById.get(id)?.name ?? 'Unknown')}
+          team2={finishingCourt.game.team2.map((id) => playersById.get(id)?.name ?? 'Unknown')}
+          playTo={getPlayTo()}
+          onClose={() => setFinishing(null)}
+          onSave={(result) => {
+            const { id, number } = finishingCourt;
+            setFinishing(null);
+            finishCourt(id, number, result);
+          }}
+        />
+      )}
       {adding && <AddPlayerSheet session={session} onClose={() => setAdding(false)} />}
     </div>
   );
```

- [ ] **Step 11: Apply this change to `src/ui/SettingsScreen.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/SettingsScreen.tsx
+++ b/src/ui/SettingsScreen.tsx
@@ -4,7 +4,7 @@
 import { useSyncStore } from '../sync/syncStore';
 import { SyncStatusLine } from './SyncStatusLine';
 import { useDefaultMode } from './matchmaking';
-import { AUTO_START_KEY, KEEP_AWAKE_KEY, useBoolPref, VIBRATE_KEY } from './prefs';
+import { AUTO_START_KEY, KEEP_AWAKE_KEY, PLAY_TO_CHOICES, useBoolPref, usePlayTo, VIBRATE_KEY } from './prefs';
 import { useTheme } from './useTheme';
 
 interface Props {
@@ -21,6 +21,7 @@
   const [keepAwake, setKeepAwake] = useBoolPref(KEEP_AWAKE_KEY, true);
   const [vibrate, setVibrate] = useBoolPref(VIBRATE_KEY, true);
   const [autoStart, setAutoStart] = useBoolPref(AUTO_START_KEY, false);
+  const [playTo, setPlayTo] = usePlayTo();
   const [working, setWorking] = useState(false);
   const [outcome, setOutcome] = useState<{ result: DataResult; done: string } | null>(null);
 
@@ -99,6 +100,18 @@
           <input type="checkbox" role="switch" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
         </label>
         <p className="muted">Off: you press Start for each game, so players have time to reach the court. On: a game starts the moment the last one finishes. It applies to new sessions.</p>
+        <p className="label" id="play-to-label">
+          Play to
+        </p>
+        <div className="options" role="radiogroup" aria-labelledby="play-to-label">
+          {PLAY_TO_CHOICES.map((n) => (
+            <label key={n} className="option">
+              <input type="radio" name="play-to" checked={playTo === n} onChange={() => setPlayTo(n)} />
+              <span>{n}</span>
+            </label>
+          ))}
+        </div>
+        <p className="muted">Where the winning score starts when you record a result.</p>
       </section>
 
       <section className="card stack" aria-labelledby="players-title">
```

- [ ] **Step 12: Apply this change to `src/styles/app.css`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -1509,3 +1509,58 @@
   background: transparent;
   font-weight: 800;
 }
+
+/* ---------- Results ---------- */
+.result-teams {
+  display: flex;
+  flex-direction: column;
+  gap: 8px;
+}
+
+.result-team {
+  min-height: 64px;
+  font-size: 20px;
+  font-weight: 800;
+  overflow-wrap: anywhere;
+}
+
+.result-winners {
+  margin: 0;
+  font-size: 18px;
+  font-weight: 800;
+  overflow-wrap: anywhere;
+}
+
+.result-winning {
+  display: flex;
+  align-items: center;
+  justify-content: center;
+  gap: 20px;
+}
+
+.result-number {
+  min-width: 2ch;
+  text-align: center;
+  font-size: 48px;
+  font-weight: 800;
+  line-height: 1;
+}
+
+.score-chips {
+  display: grid;
+  grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
+  gap: 8px;
+}
+
+.score-chip {
+  min-width: 0;
+  padding: 0;
+  font-size: 18px;
+  font-weight: 800;
+}
+
+.result-actions {
+  display: flex;
+  justify-content: space-between;
+  gap: 8px;
+}
```

- [ ] **Step 13: Run the tests**

```bash
npx vitest run src/ui
```

Expected: PASS.

- [ ] **Step 14: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/ui/ResultSheet.tsx src/ui/prefs.ts src/ui/LiveScreen.tsx src/ui/SettingsScreen.tsx src/styles/app.css src/ui/ResultSheet.test.tsx src/ui/finishWithResult.test.tsx src/ui/App.test.tsx src/ui/liveScreen.test.tsx src/ui/oneUndo.test.tsx src/ui/readyStep.test.tsx
git commit -m "Ask who won and the score when a game finishes, with a Play to setting"
```

## Task 5: Results on the summary screen

Each player's record sits under their name and opens to their partner records. The game by game list shows each result. A switch decides whether results go into the shared text, off each time, because win records can sting in a friendly group.

**Files:**
- Modify: `src/ui/SummaryScreen.tsx`, `src/styles/app.css`, `src/ui/summaryScreen.test.tsx`

- [ ] **Step 1: Apply this change to `src/ui/summaryScreen.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/summaryScreen.test.tsx
+++ b/src/ui/summaryScreen.test.tsx
@@ -113,3 +113,75 @@
     expect(reset).toHaveBeenCalledOnce();
   });
 });
+
+/** Two games with results and one without, on one court. */
+function withResults() {
+  const ctx = makeCtx(1, 1_000_000);
+  let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee'], { courts: 1 }, ctx);
+  const id = (name: string) => s.players.find((p) => p.name === name)!.id;
+  const play = (t1: [string, string], t2: [string, string], at: number, result?: Parameters<typeof finishGame>[3]) => {
+    s.courts[0].game = { team1: [id(t1[0]), id(t1[1])], team2: [id(t2[0]), id(t2[1])], startedAt: at };
+    s = finishGame(s, s.courts[0].id, { ...ctx, now: at + 600_000 }, result);
+  };
+  play(['Ann', 'Ben'], ['Cy', 'Dee'], 1_000_000, { winner: 1, score: [11, 7] });
+  play(['Ann', 'Cy'], ['Ben', 'Dee'], 2_000_000, { winner: 2 });
+  play(['Ann', 'Dee'], ['Ben', 'Cy'], 3_000_000);
+  return { ...s, endedAt: 4_000_000 };
+}
+
+describe('results on the summary', () => {
+  it('shows each player’s record under their name, only for players who have one', () => {
+    render(<SummaryScreen session={withResults()} />);
+    const rows = within(screen.getByRole('list', { name: 'Games per player' })).getAllByRole('listitem');
+    const ann = rows.find((r) => r.textContent!.startsWith('AN') || r.textContent!.includes('Ann'))!;
+    expect(ann.textContent).toContain('1W 1L');
+    expect(rows.find((r) => r.textContent!.includes('Dee'))!.textContent).toContain('1W 1L');
+  });
+
+  it('shows no record at all when no game had a result', () => {
+    render(<SummaryScreen session={finished(2)} />);
+    expect(document.querySelector('.sum-record')).toBeNull();
+  });
+
+  it('opens a player to their record and how they did with each partner', async () => {
+    const user = userEvent.setup();
+    render(<SummaryScreen session={withResults()} />);
+    const row = within(screen.getByRole('list', { name: 'Games per player' })).getAllByRole('listitem').find((r) => r.textContent!.includes('Ann'))!;
+    await user.click(row.querySelector('summary')!);
+    expect(within(row).getByText('Record')).toBeInTheDocument();
+    expect(within(row).getByText('1 win, 1 loss')).toBeInTheDocument();
+    // Ben and Cy partnered Ann in games with a result, Dee in the game without one.
+    expect(within(row).getByText('Partners').nextElementSibling!.textContent).toBe('Ben · 1W 0L, Cy · 0W 1L, Dee');
+  });
+
+  it('writes the result under each game in the game by game list', async () => {
+    const user = userEvent.setup();
+    render(<SummaryScreen session={withResults()} />);
+    await user.click(screen.getByText('Game by game (3)'));
+    const log = document.querySelector('.sum-log')!;
+    expect(log.textContent).toContain('Ann & Ben won 11 to 7');
+    expect(log.textContent).toContain('Ben & Dee won');
+    expect(within(log as HTMLElement).getAllByRole('listitem')).toHaveLength(3);
+    expect(log.querySelectorAll('.sum-log-result')).toHaveLength(2); // the third game had no result
+  });
+
+  it('offers to include results in the shared text only when there are some, off by default', () => {
+    const { unmount } = render(<SummaryScreen session={withResults()} />);
+    expect(screen.getByRole('switch', { name: 'Include results in the shared text' })).not.toBeChecked();
+    unmount();
+    render(<SummaryScreen session={finished(2)} />);
+    expect(screen.queryByRole('switch', { name: 'Include results in the shared text' })).not.toBeInTheDocument();
+  });
+
+  it('leaves results out of the shared text by default, and adds them when switched on', async () => {
+    const user = userEvent.setup();
+    const share = vi.fn().mockResolvedValue(undefined);
+    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share }));
+    render(<SummaryScreen session={withResults()} />);
+    await user.click(screen.getByRole('button', { name: 'Share results' }));
+    expect(share.mock.calls[0][0].text).not.toMatch(/\dW \dL/);
+    await user.click(screen.getByRole('switch', { name: 'Include results in the shared text' }));
+    await user.click(screen.getByRole('button', { name: 'Share results' }));
+    expect(share.mock.calls[1][0].text).toMatch(/Ann: 3 · 1W 1L/);
+  });
+});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/ui/summaryScreen.test.tsx
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 3: Apply this change to `src/ui/SummaryScreen.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/SummaryScreen.tsx
+++ b/src/ui/SummaryScreen.tsx
@@ -8,6 +8,16 @@
   return items.map((p) => (p.count > 1 ? `${p.name} ×${p.count}` : p.name)).join(', ');
 }
 
+/** "Ann ×2 · 2W 0L": a partner, how often, and how the pair did when games had a result. */
+function partnerList(items: PlayerSummary['partners']): string {
+  return items
+    .map((p) => {
+      const base = p.count > 1 ? `${p.name} ×${p.count}` : p.name;
+      return p.wins + p.losses > 0 ? `${base} · ${p.wins}W ${p.losses}L` : base;
+    })
+    .join(', ');
+}
+
 function PlayerRow({ row, maxGames }: { row: PlayerSummary; maxGames: number }) {
   const width = maxGames > 0 ? Math.round((row.gamesPlayed / maxGames) * 100) : 0;
   return (
@@ -16,8 +26,15 @@
         <summary>
           <PlayerAvatar name={row.name} rosterId={row.rosterId} size="sm" />
           <span className="sum-name">
-            <span className="row-name">{row.name}</span>
-            {row.status === 'left' && <span className="tag">Left</span>}
+            <span className="sum-who">
+              <span className="row-name">{row.name}</span>
+              {row.status === 'left' && <span className="tag">Left</span>}
+            </span>
+            {row.wins + row.losses > 0 && (
+              <span className="sum-record">
+                {row.wins}W {row.losses}L
+              </span>
+            )}
           </span>
           <span className="sum-bar" aria-hidden="true">
             <span style={{ width: `${width}%` }} />
@@ -28,8 +45,16 @@
           </span>
         </summary>
         <dl className="sum-detail">
+          {row.wins + row.losses > 0 && (
+            <>
+              <dt>Record</dt>
+              <dd>
+                {row.wins} {row.wins === 1 ? 'win' : 'wins'}, {row.losses} {row.losses === 1 ? 'loss' : 'losses'}
+              </dd>
+            </>
+          )}
           <dt>Partners</dt>
-          <dd>{row.partners.length ? countList(row.partners) : '—'}</dd>
+          <dd>{row.partners.length ? partnerList(row.partners) : '—'}</dd>
           <dt>Played against</dt>
           <dd>{row.opponents.length ? countList(row.opponents) : '—'}</dd>
         </dl>
@@ -42,16 +67,19 @@
   const reset = useSessionStore((s) => s.reset);
   const [message, setMessage] = useState('');
   const [shared, setShared] = useState(false);
+  // Win records can sting in a friendly group, so they only go into the shared text when switched on, each time.
+  const [withResults, setWithResults] = useState(false);
   const rows = engine.summarize(session);
   const stats = engine.sessionStats(session);
   const log = engine.gameLog(session);
   const fairness = engine.fairnessLine(stats);
+  const anyResults = engine.hasResults(session);
   const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
 
   async function share() {
     // Pass the device's UTC offset so the date in the text is the local date.
     const offsetMinutes = -new Date(session.createdAt).getTimezoneOffset();
-    const text = engine.formatSummaryText(session, offsetMinutes);
+    const text = engine.formatSummaryText(session, offsetMinutes, { results: withResults });
     if (canShare) {
       try {
         await navigator.share({ title: session.name, text });
@@ -121,10 +149,23 @@
                 <span>
                   {g.team1.join(' & ')} <span className="muted">vs</span> {g.team2.join(' & ')}
                 </span>
+                {g.winner && (
+                  <span className="sum-log-result">
+                    {(g.winner === 1 ? g.team1 : g.team2).join(' & ')} won
+                    {g.score ? ` ${Math.max(...g.score)} to ${Math.min(...g.score)}` : ''}
+                  </span>
+                )}
               </li>
             ))}
           </ol>
         </details>
+      )}
+
+      {anyResults && (
+        <label className="switch-row">
+          <span>Include results in the shared text</span>
+          <input type="checkbox" role="switch" checked={withResults} onChange={(e) => setWithResults(e.target.checked)} />
+        </label>
       )}
 
       {message && (
```

- [ ] **Step 4: Apply this change to `src/styles/app.css`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -1101,8 +1101,8 @@
   flex: 0 1 38%;
   min-width: 0;
   display: flex;
-  align-items: center;
-  gap: 6px;
+  flex-direction: column;
+  align-items: flex-start;
 }
 
 .sum-name .row-name {
@@ -1564,3 +1564,21 @@
   justify-content: space-between;
   gap: 8px;
 }
+
+.sum-who {
+  display: flex;
+  align-items: center;
+  gap: 6px;
+  min-width: 0;
+}
+
+.sum-record {
+  color: var(--muted);
+  font-size: 12px;
+  font-weight: 700;
+}
+
+.sum-log-result {
+  font-size: 14px;
+  font-weight: 700;
+}
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/ui
```

Expected: PASS.

- [ ] **Step 6: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/ui/SummaryScreen.tsx src/styles/app.css src/ui/summaryScreen.test.tsx
git commit -m "Show records and results on the summary and keep them out of the shared text unless switched on"
```

## Task 6: Look at it, then merge

- [ ] **Step 1: Build and look at it at 360 by 780**

```bash
npm run build
```

Expected: clean build. In a browser at 360 by 780, light theme: start a session from a saved roster, press Start, then Game finished. A sheet asks "Court 1: who won?" with the two teams as big buttons and Skip result below. Tap a team: "Court 1: score" shows "<names> won", a big 11 with minus and plus, "Their score" as a row of numbers from 0 to 10, and Change winner and Skip score at the bottom. Tap a number: the sheet closes, the court is Ready for the next game, and the bar under the court reads "Court 1: <names> won 11 to 7" with Undo. End the session: players show "1W 0L" under their names, and the open row shows Record and partner records. In Settings, Play to 15 changes the starting score to 15.

- [ ] **Step 2: Run the Ralph loop** on the finished change, and fix what it finds.

- [ ] **Step 3: Merge to production** after the owner says go.

- [ ] **Step 4: Phone check at the courts.** Two taps for a result, whether the numbers are big enough for sweaty thumbs, Skip result when busy, Undo from the bar, the record on the summary, and that results stay out of the shared text unless the switch is on. Not verifiable without a phone: how it feels with a real game finishing, and whether 11 chips in two rows is easy to hit.

## Self-review

- **Spec coverage (2b):** the sheet flow with Skip and Cancel (Task 3), data and validation (Task 1), Play to (Task 3), records, partner records, game log and the shared-text switch (Tasks 2 and 4). Highlights such as "unbeaten" belong to Phase 4 and are not built here.
- **Rules kept:** no result is required; results never change matchmaking (a test compares players, courts and queue with and without a result); win by two is not enforced; the only rule is that the winning score is higher.
- **One extra rule:** a score must be whole numbers from 0 up, so a bad value can never reach a saved session. The saved-session check also refuses a malformed winner or score.
- **Placeholders:** none. Every step has its code or diff.
- **Names:** `GameResult`, `checkResult`, `hasResults`, `WinLoss`, `ResultSheet`, `getPlayTo`, `usePlayTo`, `PLAY_TO_KEY` are defined once and used by the same names.
