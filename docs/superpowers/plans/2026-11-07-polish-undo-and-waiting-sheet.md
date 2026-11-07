# PIKLMatch polish pass: one Undo and a cleaner Waiting sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the two Undo buttons that did the same thing and put one Undo where the mistake happens, with words that say what it undoes. Redesign the bottom Waiting sheet so the whole top opens it, with a labelled Add player button and no arrow.

**Architecture:** The session store keeps a short in-memory label for the last action. A one-line `UndoBar` under the court reads it. The menu gets a labelled Undo for later. The Waiting sheet's top becomes one tap target (with a real button inside for keyboards and screen readers) that also answers a swipe up or down. No engine rules change.

**Tech Stack:** React 18, TypeScript, Zustand, Vitest with Testing Library, Vite. No new dependencies.

Origin: the 7 Nov 2026 design evaluation of the live screen (owner's screenshot and questions about Undo and the Waiting sheet).

**How the code in this plan was proved.** Every file and diff below was built once in a scratch copy of the repository at commit `2879037`, with the full suite passing (657 tests, up from 626, four runs in a row) and mutation-checked (13 deliberate breakages: 11 caught, 2 equivalent, noted in the self-review). The screens were looked at in a browser at 360 by 780 in the light theme. Apply a diff from the project root with `patch -p1 < the-diff-file`, or by hand: each hunk shows its context.

**Conventions.** Run commands from `pickleball-match-app/` (the folder with `package.json`). Stage files by name, never with `git add -A`. No AI attribution lines in commit messages. After the last task, run the Ralph loop before merging.

---
## Task 1: The store remembers what the last action was

Undo can only say what it undoes if something wrote it down. Each action can now carry a short label, kept in memory (not saved), cleared by Undo, a reset or a new session.

**Files:**
- Modify: `src/store/sessionStore.ts`, `src/store/sessionStore.test.ts`

- [ ] **Step 1: Apply this change to `src/store/sessionStore.test.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/store/sessionStore.test.ts
+++ b/src/store/sessionStore.test.ts
@@ -121,3 +121,51 @@
     expect(fresh.useSessionStore.getState().undoStack).toEqual([prev]);
   });
 });
+
+describe('what the last action was', () => {
+  const noop = (s: ReturnType<typeof useSessionStore.getState>['session']) => s!;
+
+  it('is remembered with the action, and is empty for an action with no label', () => {
+    start();
+    expect(useSessionStore.getState().lastAction).toBeNull();
+    useSessionStore.getState().apply((s) => noop(s), 'Game finished on Court 1');
+    const last = useSessionStore.getState().lastAction!;
+    expect(last.label).toBe('Game finished on Court 1');
+    expect(last.at).toBeGreaterThan(0);
+    useSessionStore.getState().apply((s) => noop(s));
+    expect(useSessionStore.getState().lastAction).toBeNull();
+  });
+
+  it('gets a new id for every labelled action, even in the same millisecond', () => {
+    start();
+    const { apply } = useSessionStore.getState();
+    apply((s) => noop(s), 'one');
+    const first = useSessionStore.getState().lastAction!.id;
+    apply((s) => noop(s), 'two');
+    expect(useSessionStore.getState().lastAction!.id).toBeGreaterThan(first);
+  });
+
+  it('is cleared by Undo, a new session and a reset, and not set when the action fails', () => {
+    start();
+    const { apply, undo, reset } = useSessionStore.getState();
+    apply((s) => noop(s), 'something');
+    undo();
+    expect(useSessionStore.getState().lastAction).toBeNull();
+    apply((s) => noop(s), 'something');
+    reset();
+    expect(useSessionStore.getState().lastAction).toBeNull();
+    start();
+    apply((s) => noop(s), 'something');
+    const failed = apply(() => {
+      throw new engine.EngineError('NOT_FOUND', 'nope');
+    }, 'will not happen');
+    expect(failed.ok).toBe(false);
+    expect(useSessionStore.getState().lastAction!.label).toBe('something');
+  });
+
+  it('is not saved with the session, so it is gone after a reload', () => {
+    start();
+    useSessionStore.getState().apply((s) => noop(s), 'something');
+    expect(localStorage.getItem(STORAGE_KEY)!).not.toContain('something');
+  });
+});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/store/sessionStore.test.ts
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 3: Apply this change to `src/store/sessionStore.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/store/sessionStore.ts
+++ b/src/store/sessionStore.ts
@@ -9,13 +9,23 @@
 export type SessionAction = (s: Session, ctx: Ctx) => Session;
 export type ApplyResult = { ok: true } | { ok: false; error: string };
 
+/** The most recent action that can be undone, in words, kept in memory only. */
+export interface LastAction {
+  id: number;
+  label: string;
+  at: number;
+}
+
 interface SessionState {
   session: Session | null;
   undoStack: Session[];
   /** True when the last attempt to save to the browser failed. */
   saveFailed: boolean;
+  /** What the last action was, for an Undo that says what it will undo. Null after Undo, a reset or a reload. */
+  lastAction: LastAction | null;
   start: (input: NewSessionInput) => ApplyResult;
-  apply: (action: SessionAction) => ApplyResult;
+  /** `label` says what the action did ("Game finished on Court 1"), and is shown beside Undo. */
+  apply: (action: SessionAction, label?: string) => ApplyResult;
   undo: () => void;
   reset: () => void;
 }
@@ -31,17 +41,19 @@
 }
 
 const initial = loadPersisted();
+let actionSeq = 0;
 
 export const useSessionStore = create<SessionState>()((set, get) => {
   const commit = (session: Session | null, undoStack: Session[]) => {
     const saved = savePersisted({ session, undoStack });
-    set({ session, undoStack, saveFailed: !saved });
+    set({ session, undoStack, saveFailed: !saved, lastAction: null });
   };
 
   return {
     session: initial?.session ?? null,
     undoStack: initial?.undoStack ?? [],
     saveFailed: false,
+    lastAction: null,
 
     start(input) {
       try {
@@ -52,12 +64,13 @@
       }
     },
 
-    apply(action) {
+    apply(action, label) {
       const { session, undoStack } = get();
       if (!session) return { ok: false, error: 'There is no active session.' };
       try {
         const next = action(session, liveCtx());
         commit(next, [...undoStack, session].slice(-MAX_UNDO));
+        if (label) set({ lastAction: { id: ++actionSeq, label, at: Date.now() } });
         return { ok: true };
       } catch (e) {
         return toResult(e);
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
git add src/store/sessionStore.ts src/store/sessionStore.test.ts
git commit -m "Let the session store remember what the last action was"
```

## Task 2: One Undo, where the mistake happens

The header Undo icon and the toast with the lineup go. After any action a one-line bar says what happened, with the one Undo button. The menu gets a labelled Undo for later. The lineup in the old toast repeated what the court card above it already shows.

**Files:**
- Create: `src/ui/UndoBar.tsx`
- Modify: `src/ui/LiveScreen.tsx`, `src/ui/PlayerSheet.tsx`, `src/ui/AddPlayerSheet.tsx`, `src/styles/app.css`, `src/ui/liveScreen.test.tsx`, `src/ui/readyStep.test.tsx`
- Delete: `src/ui/Toast.tsx`, `src/ui/finishMessage.ts` and their tests, `src/ui/liveToast.test.tsx`
- Test: `src/ui/UndoBar.test.tsx`, `src/ui/oneUndo.test.tsx`

- [ ] **Step 1: Create `src/ui/UndoBar.test.tsx`**

```tsx
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newTestSession } from '../engine/testing';
import { useSessionStore } from '../store/sessionStore';
import { UndoBar } from './UndoBar';

beforeEach(() => {
  localStorage.clear();
  useSessionStore.setState({ session: newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }), undoStack: [], saveFailed: false, lastAction: null });
});
afterEach(() => vi.useRealTimers());

const setLast = (label: string, at = Date.now(), id = 1) => act(() => useSessionStore.setState({ lastAction: { id, label, at } }));

describe('UndoBar', () => {
  it('shows nothing until an action has happened', () => {
    render(<UndoBar />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says what happened in one line, with an Undo button', () => {
    render(<UndoBar />);
    setLast('Game finished on Court 2');
    expect(screen.getByRole('status')).toHaveTextContent('Game finished on Court 2');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('runs Undo from the store and goes away', async () => {
    const undo = vi.fn();
    useSessionStore.setState({ undo });
    render(<UndoBar />);
    setLast('Started Court 1');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('goes away by itself after eight seconds, and not before', () => {
    vi.useFakeTimers();
    render(<UndoBar />);
    setLast('Court added');
    act(() => vi.advanceTimersByTime(7_999));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('starts the wait again for a newer action, and shows only the latest', () => {
    vi.useFakeTimers();
    render(<UndoBar />);
    setLast('one', Date.now(), 1);
    act(() => vi.advanceTimersByTime(6_000));
    setLast('two', Date.now(), 2);
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('two');
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not show an action that is already old when it mounts', () => {
    useSessionStore.setState({ lastAction: { id: 1, label: 'Court added', at: Date.now() - 9_000 } });
    render(<UndoBar />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Create `src/ui/oneUndo.test.tsx`**

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import App from './App';

type User = ReturnType<typeof userEvent.setup>;

// The real default: games wait for Start.
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
const bar = () => document.querySelector<HTMLElement>('.undo-bar');
const menu = async (user: User) => {
  await user.click(screen.getByRole('button', { name: 'Menu' }));
  return document.querySelector<HTMLElement>('.menu-pop')!;
};
const court = (n: number) => useSessionStore.getState().session!.courts[n - 1];

describe('one Undo, where the mistake happens', () => {
  it('has no Undo icon in the header, and no bar before anything has happened', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    expect(document.querySelector('.live-header')!.querySelector('button[aria-label="Undo"]')).toBeNull();
    expect(bar()).toBeNull();
  });

  it('says what each action did, in one line, and Undo takes it back', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    await user.click(screen.getByRole('button', { name: /^Start game/ }));
    expect(bar()!.textContent).toBe('Started Court 1Undo');
    await user.click(screen.getByRole('button', { name: /^Game finished/ }));
    expect(bar()!.textContent).toBe('Game finished on Court 1Undo');
    expect(document.querySelectorAll('.undo-bar')).toHaveLength(1);
    await user.click(within(bar()!).getByRole('button', { name: 'Undo' }));
    expect(bar()).toBeNull();
    expect(court(1).status).toBe('playing');
  });

  it('labels adding a player, a break, and adding or removing a court', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    await user.click(screen.getByRole('button', { name: 'Add player' }));
    await user.type(await screen.findByLabelText('New player name'), 'Zed{enter}');
    // The player is saved first, then added, so the bar arrives a moment after the Enter.
    await waitFor(() => expect(bar()?.textContent).toBe('Added ZedUndo'));

    await user.click(within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('button')[0]);
    await user.click(await screen.findByRole('button', { name: 'Take a break' }));
    expect(bar()!.textContent).toMatch(/^(P[A-Z]|Zed) on a breakUndo$/);

    await user.click(await menuButton(user, 'Add court'));
    expect(bar()!.textContent).toBe('Court addedUndo');
  });

  it('says a Ready court is removed at once', async () => {
    const user = userEvent.setup();
    await startSession(user, 8);
    await user.click(screen.getAllByRole('tab')[1]);
    await user.click(await menuButton(user, 'Remove court 2'));
    expect(bar()!.textContent).toBe('Court 2 removedUndo');
  });

  it('says a court in play will close after its game, and then that it will stay open', async () => {
    const user = userEvent.setup();
    await startSession(user, 8);
    await user.click(await menuButton(user, 'Start all ready courts'));
    await user.click(screen.getAllByRole('tab')[1]);
    await user.click(await menuButton(user, 'Remove court 2'));
    expect(bar()!.textContent).toBe('Court 2 will close after its gameUndo');
    await user.click(await menuButton(user, 'Keep court 2 open'));
    expect(bar()!.textContent).toBe('Court 2 will stay openUndo');
  });
});

async function menuButton(user: User, name: string) {
  const pop = await menu(user);
  return within(pop).getByRole('button', { name });
}

describe('Undo in the menu', () => {
  it('is not there before anything can be undone', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    const pop = await menu(user);
    expect(within(pop).queryByRole('button', { name: /^Undo/ })).not.toBeInTheDocument();
  });

  it('says what it will undo, is the first item, and works', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    await user.click(screen.getByRole('button', { name: /^Start game/ }));
    const pop = await menu(user);
    const first = within(pop).getAllByRole('button')[0];
    expect(first).toHaveTextContent('Undo: Started Court 1');
    await user.click(first);
    expect(court(1).status).toBe('ready');
  });

  it('falls back to a plain label when the action is no longer known, for example after a reload', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    await user.click(screen.getByRole('button', { name: /^Start game/ }));
    const { act } = await import('@testing-library/react');
    act(() => useSessionStore.setState({ lastAction: null }));
    const pop = await menu(user);
    expect(within(pop).getAllByRole('button')[0]).toHaveTextContent('Undo last action');
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
npx vitest run src/ui/UndoBar.test.tsx src/ui/oneUndo.test.tsx
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 4: Create `src/ui/UndoBar.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useSessionStore } from '../store/sessionStore';

/** How long the bar stays after an action. */
const SECONDS = 8;

/**
 * One line under the court that says what the last action did, with the one Undo button. It is the only place Undo
 * lives right after a mistake; the menu keeps a labelled Undo for later.
 */
export function UndoBar() {
  const last = useSessionStore((s) => s.lastAction);
  const undo = useSessionStore((s) => s.undo);
  const [hiddenId, setHiddenId] = useState<number | null>(null);

  useEffect(() => {
    if (!last) return;
    const left = SECONDS * 1000 - (Date.now() - last.at);
    if (left <= 0) {
      setHiddenId(last.id);
      return;
    }
    const timer = setTimeout(() => setHiddenId(last.id), left);
    return () => clearTimeout(timer);
  }, [last]);

  if (!last || hiddenId === last.id || Date.now() - last.at >= SECONDS * 1000) return null;
  return (
    <div className="undo-bar" role="status">
      <span className="undo-text">{last.label}</span>
      <button type="button" className="btn btn-small undo-btn" onClick={undo}>
        Undo
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Apply this change to `src/ui/LiveScreen.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/LiveScreen.tsx
+++ b/src/ui/LiveScreen.tsx
@@ -1,4 +1,4 @@
-import { useCallback, useMemo, useState } from 'react';
+import { useMemo, useState } from 'react';
 import * as engine from '../engine';
 import type { Session } from '../engine';
 import { useRosterStore } from '../store/rosterStore';
@@ -7,11 +7,10 @@
 import { AddPlayerSheet } from './AddPlayerSheet';
 import { CourtCard } from './CourtCard';
 import { CourtTabs } from './CourtTabs';
-import { finishMessage } from './finishMessage';
 import { LiveMenu } from './LiveMenu';
 import { PlayerSheet } from './PlayerSheet';
 import { getBoolPref, VIBRATE_KEY } from './prefs';
-import { Toast } from './Toast';
+import { UndoBar } from './UndoBar';
 import { useSwipe } from './useSwipe';
 import { WaitingSheet } from './WaitingSheet';
 
@@ -19,6 +18,7 @@
   const apply = useSessionStore((s) => s.apply);
   const undo = useSessionStore((s) => s.undo);
   const undoCount = useSessionStore((s) => s.undoStack.length);
+  const lastAction = useSessionStore((s) => s.lastAction);
   const markPlayed = useRosterStore((s) => s.markPlayed);
 
   const [selectedId, setSelectedId] = useState<string | null>(null);
@@ -27,8 +27,6 @@
   const [slide, setSlide] = useState<'from-right' | 'from-left' | null>(null);
   const [adding, setAdding] = useState(false);
   const [error, setError] = useState<string | null>(null);
-  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
-  const dismissToast = useCallback(() => setToast(null), []);
 
   const playersById = useMemo(
     () => new Map(session.players.map((p) => [p.id, p])),
@@ -45,34 +43,27 @@
     setAdding(true);
   }
 
-  function run(action: SessionAction): boolean {
-    const res = apply(action);
+  function run(action: SessionAction, label?: string): boolean {
+    const res = apply(action, label);
     setError(res.ok ? null : res.error);
     return res.ok;
   }
 
-  /** Finishes a game and says what the court is doing now, with a way back. */
+  /** Finishes a game, with a way back, and buzzes where the device allows. */
   function finishCourt(courtId: string, courtNumber: number) {
-    if (!run((s, ctx) => engine.finishGame(s, courtId, ctx))) return;
-    const after = useSessionStore.getState().session;
-    if (after) setToast({ id: Date.now(), text: finishMessage(after, courtNumber) });
+    if (!run((s, ctx) => engine.finishGame(s, courtId, ctx), `Game finished on Court ${courtNumber}`)) return;
     // A short buzz where the device can, so a glance away from the screen still knows it registered.
     if (getBoolPref(VIBRATE_KEY, true)) {
       try {
         navigator.vibrate?.(25);
       } catch {
-        // Not allowed here: the toast is enough.
+        // Not allowed here: the bar under the court is enough.
       }
     }
   }
 
-  function startCourt(courtId: string) {
-    run((s, ctx) => engine.startCourt(s, courtId, ctx));
-  }
-
-  function undoLast() {
-    undo();
-    setToast(null);
+  function startCourt(courtId: string, courtNumber: number) {
+    run((s, ctx) => engine.startCourt(s, courtId, ctx), `Started Court ${courtNumber}`);
   }
 
   function endSession() {
@@ -115,22 +106,25 @@
           </span>
         </div>
         <div className="live-actions">
-          <button type="button" className="btn btn-ghost icon-btn" aria-label="Undo" disabled={undoCount === 0} onClick={undoLast}>
-            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
-              <path d="M9 14 4 9l5-5" />
-              <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
-            </svg>
-          </button>
           <LiveMenu
             items={[
+              ...(undoCount > 0 ? [{ label: lastAction ? `Undo: ${lastAction.label}` : 'Undo last action', onSelect: undo }] : []),
               { label: 'Add player', onSelect: openAdd },
-              ...(readyCount >= 2 ? [{ label: 'Start all ready courts', onSelect: () => run((s, ctx) => engine.startAllReady(s, ctx)) }] : []),
-              { label: 'Add court', onSelect: () => run((s, ctx) => engine.addCourt(s, ctx)) },
+              ...(readyCount >= 2 ? [{ label: 'Start all ready courts', onSelect: () => run((s, ctx) => engine.startAllReady(s, ctx), 'Started all ready courts') }] : []),
+              { label: 'Add court', onSelect: () => run((s, ctx) => engine.addCourt(s, ctx), 'Court added') },
               ...(selected
                 ? [
                     {
                       label: selected.closing ? `Keep court ${selected.number} open` : `Remove court ${selected.number}`,
-                      onSelect: () => run((s, ctx) => engine.removeCourt(s, selected.id, ctx)),
+                      onSelect: () =>
+                        run(
+                          (s, ctx) => engine.removeCourt(s, selected.id, ctx),
+                          selected.closing
+                            ? `Court ${selected.number} will stay open`
+                            : selected.status === 'playing'
+                              ? `Court ${selected.number} will close after its game`
+                              : `Court ${selected.number} removed`,
+                        ),
                     },
                   ]
                 : []),
@@ -156,11 +150,11 @@
                   court={selected}
                   playersById={playersById}
                   onFinish={() => finishCourt(selected.id, selected.number)}
-                  onStart={() => startCourt(selected.id)}
+                  onStart={() => startCourt(selected.id, selected.number)}
                   onSelectPlayer={selectPlayer}
                 />
               </div>
-              {toast && <Toast id={toast.id} text={toast.text} onUndo={undoLast} onDismiss={dismissToast} />}
+              <UndoBar />
             </>
           )}
         </div>
```

- [ ] **Step 6: Apply this change to `src/ui/PlayerSheet.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/PlayerSheet.tsx
+++ b/src/ui/PlayerSheet.tsx
@@ -30,7 +30,8 @@
   const why = engine.explainWaiting(session, playerId);
 
   function setStatus(target: engine.StatusTarget) {
-    const res = apply((s, ctx) => engine.setPlayerStatus(s, playerId, target, ctx));
+    const verb = target === 'break' ? 'on a break' : target === 'left' ? 'left the session' : 'back in';
+    const res = apply((s, ctx) => engine.setPlayerStatus(s, playerId, target, ctx), `${player?.name ?? 'Player'} ${verb}`);
     if (res.ok) onClose();
     else setError(res.error);
   }
```

- [ ] **Step 7: Apply this change to `src/ui/AddPlayerSheet.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/AddPlayerSheet.tsx
+++ b/src/ui/AddPlayerSheet.tsx
@@ -30,7 +30,7 @@
 
   function addToSession(playerName: string, rosterId: string) {
     setError(null);
-    const res = apply((s, ctx) => engine.addPlayer(s, { name: playerName, rosterId }, ctx));
+    const res = apply((s, ctx) => engine.addPlayer(s, { name: playerName, rosterId }, ctx), `Added ${playerName}`);
     if (res.ok) onClose();
     else setError(res.error);
   }
```

- [ ] **Step 8: Delete these files**

```bash
rm src/ui/Toast.tsx
rm src/ui/Toast.test.tsx
rm src/ui/finishMessage.ts
rm src/ui/finishMessage.test.ts
rm src/ui/liveToast.test.tsx
```

- [ ] **Step 9: Apply this change to `src/styles/app.css`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -1429,28 +1429,6 @@
   accent-color: var(--ink);
 }
 
-.toast {
-  display: flex;
-  align-items: center;
-  justify-content: space-between;
-  gap: 12px;
-  padding: 10px 12px 10px 16px;
-  border: 1px solid var(--line);
-  border-radius: 16px;
-  background: var(--surface);
-}
-
-.toast-text {
-  min-width: 0;
-  font-weight: 600;
-  overflow-wrap: anywhere;
-}
-
-.toast-undo {
-  flex: none;
-}
-
-
 .waiting-sheet .sheet-head {
   display: flex;
   align-items: center;
@@ -1488,3 +1466,31 @@
   color: var(--ink);
   font-weight: 800;
 }
+
+/* ---------- One Undo ---------- */
+.undo-bar {
+  display: flex;
+  align-items: center;
+  justify-content: space-between;
+  gap: 12px;
+  min-height: 48px;
+  padding: 2px 4px 2px 16px;
+  border: 1px solid var(--line);
+  border-radius: 999px;
+  background: var(--surface);
+}
+
+.undo-text {
+  min-width: 0;
+  overflow: hidden;
+  font-weight: 600;
+  text-overflow: ellipsis;
+  white-space: nowrap;
+}
+
+.undo-btn {
+  flex: none;
+  border-color: transparent;
+  background: transparent;
+  font-weight: 800;
+}
```

- [ ] **Step 10: Apply this change to `src/ui/liveScreen.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/liveScreen.test.tsx
+++ b/src/ui/liveScreen.test.tsx
@@ -179,14 +179,14 @@
 });
 
 describe('the top bar', () => {
-  it('is one slim row, with no separate title bar above it, and Undo as an icon button', async () => {
+  it('is one slim row, with no separate title bar above it and no Undo icon', async () => {
     const user = userEvent.setup();
     await startSession(user, FIVE);
     expect(screen.queryByText('PIKLMatch')).not.toBeInTheDocument();
     const bar = document.querySelector<HTMLElement>('.live-header')!;
     expect(within(bar).getByRole('button', { name: /^Settings/ })).toBeInTheDocument();
     expect(within(bar).getByRole('heading', { level: 1 })).toBeInTheDocument();
-    expect(within(bar).getByRole('button', { name: 'Undo' })).toBeDisabled();
+    expect(within(bar).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
     expect(within(bar).getByRole('button', { name: 'Menu' })).toBeInTheDocument();
   });
 
```

- [ ] **Step 11: Apply this change to `src/ui/readyStep.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/readyStep.test.tsx
+++ b/src/ui/readyStep.test.tsx
@@ -30,7 +30,7 @@
 const panel = (n = 1) => screen.getByRole('tabpanel', { name: `Court ${n}` });
 const startButton = () => within(screen.getByRole('tabpanel')).getByRole('button', { name: /^Start game/ });
 const tabs = () => screen.getAllByRole('tab');
-const toastEl = () => document.querySelector<HTMLElement>('.toast');
+const undoBar = () => document.querySelector<HTMLElement>('.undo-bar');
 const court = (n: number) => useSessionStore.getState().session!.courts[n - 1];
 
 describe('a new session', () => {
@@ -84,16 +84,16 @@
 });
 
 describe('finishing a game', () => {
-  it('makes the court Ready with the next four and says so, with an Undo that restores the game', async () => {
+  it('makes the court Ready with the next four, says what happened with an Undo, and Undo restores the game', async () => {
     const user = userEvent.setup();
     await startSession(user, 5);
     await user.click(startButton());
     const startedAt = court(1).game!.startedAt;
     await user.click(within(panel()).getByRole('button', { name: /^Game finished/ }));
     expect(court(1).status).toBe('ready');
-    expect(toastEl()!.textContent).toMatch(/^Court 1 is ready: P\w and P\w vs P\w and P\wUndo$/);
+    expect(undoBar()!.textContent).toBe('Game finished on Court 1Undo');
     expect(startButton()).toBeInTheDocument();
-    await user.click(within(toastEl()!).getByRole('button', { name: 'Undo' }));
+    await user.click(within(undoBar()!).getByRole('button', { name: 'Undo' }));
     expect(court(1).status).toBe('playing');
     expect(court(1).game!.startedAt).toBe(startedAt);
   });
```

- [ ] **Step 12: Run the tests**

```bash
npx vitest run src/ui src/store
```

Expected: PASS.

- [ ] **Step 13: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/ui/UndoBar.tsx src/ui/UndoBar.test.tsx src/ui/oneUndo.test.tsx src/ui/LiveScreen.tsx src/ui/PlayerSheet.tsx src/ui/AddPlayerSheet.tsx src/styles/app.css src/ui/liveScreen.test.tsx src/ui/readyStep.test.tsx src/ui/Toast.tsx src/ui/Toast.test.tsx src/ui/finishMessage.ts src/ui/finishMessage.test.ts src/ui/liveToast.test.tsx
git commit -m "Replace the toast and the header Undo with one Undo bar and a labelled menu Undo"
```

## Task 3: A cleaner Waiting sheet

The arrow goes: the whole top of the sheet (grip, title, label and faces) opens and closes it, and so does a swipe up or down. Add player becomes a labelled button in the title row and the dashed one lower down goes. The label reads Next in line, and a +N more chip shows who else is waiting. The team panel border is thinner and the Ready label on the tabs has one weight.

**Files:**
- Create: `src/ui/useSheetSwipe.ts`
- Modify: `src/ui/WaitingSheet.tsx`, `src/styles/app.css`, `src/ui/App.test.tsx`, `photos.test.tsx`, `liveScreen.test.tsx`, `readyStep.test.tsx`
- Test: `src/ui/waitingSheetTop.test.tsx`

- [ ] **Step 1: Create `src/ui/waitingSheetTop.test.tsx`**

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import App from './App';

type User = ReturnType<typeof userEvent.setup>;

beforeEach(async () => {
  localStorage.clear();
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false, lastAction: null });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.fromCharCode(65 + i)}`).join('{enter}');

async function startSession(user: User, count: number) {
  render(<App />);
  await user.type(screen.getByLabelText('Search or add players'), names(count));
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('button', { name: `Start ${count} players` }));
}
const handle = () => screen.getByRole('button', { name: /^Waiting/ });
const top = () => document.querySelector<HTMLElement>('.sheet-top')!;

function drag(x1: number, y1: number, x2: number, y2: number) {
  fireEvent.touchStart(top(), { touches: [{ clientX: x1, clientY: y1 }] });
  fireEvent.touchEnd(top(), { changedTouches: [{ clientX: x2, clientY: y2 }] });
}

describe('the top of the Waiting sheet', () => {
  it('has no arrow, only the grip, and one icon-free tap target for opening', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    expect(document.querySelector('.sheet-chevron')).toBeNull();
    expect(top().querySelector('.sheet-grip')).not.toBeNull();
    expect(within(handle()).queryByRole('img')).toBeNull();
  });

  it('opens and closes from a tap anywhere on the top: title, label, faces or the empty space', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
    await user.click(top().querySelector('.next-label')!);
    expect(handle()).toHaveAttribute('aria-expanded', 'true');
    await user.click(top().querySelector('.peek')!);
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
    await user.click(top().querySelector('.peek-row')!);
    expect(handle()).toHaveAttribute('aria-expanded', 'true');
    await user.click(handle());
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens and closes once per tap from the keyboard too', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    handle().focus();
    await user.keyboard('{Enter}');
    expect(handle()).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(' ');
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('has a labelled Add player button that opens the sheet to add, and does not toggle the Waiting sheet', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    const add = screen.getByRole('button', { name: 'Add player' });
    expect(add).toHaveTextContent('Add player');
    await user.click(add);
    expect(await screen.findByRole('dialog', { name: 'Add player' })).toBeInTheDocument();
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('has just the one Add player button, with none lower down the open list', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    await user.click(handle());
    expect(screen.getAllByRole('button', { name: /add player/i })).toHaveLength(1);
  });
});

describe('what the label and the faces say', () => {
  it('says Next in line when four or more are waiting', async () => {
    const user = userEvent.setup();
    await startSession(user, 12);
    expect(screen.getByText('Next in line')).toBeInTheDocument();
  });

  it('says how many more a game needs when fewer than four are waiting', async () => {
    const user = userEvent.setup();
    await startSession(user, 9);
    expect(screen.getByText('Need 3 more waiting to fill the next game')).toBeInTheDocument();
    expect(screen.queryByText('Next in line')).not.toBeInTheDocument();
  });

  it('shows how many more are waiting beyond the four faces, and not when there are no more', async () => {
    const user = userEvent.setup();
    await startSession(user, 14);
    expect(top().querySelectorAll('.peek li')).toHaveLength(4);
    expect(within(top()).getByText('+2 more')).toBeInTheDocument();
  });

  it('shows no +more chip when the faces are everyone waiting', async () => {
    const user = userEvent.setup();
    await startSession(user, 12);
    expect(top().querySelector('.peek-more')).toBeNull();
  });
});

describe('swiping the top of the Waiting sheet', () => {
  it('opens it on a swipe up and closes it on a swipe down', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    drag(180, 700, 185, 600);
    expect(handle()).toHaveAttribute('aria-expanded', 'true');
    drag(180, 600, 175, 700);
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('does nothing more when it is already open or closed in that direction', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    drag(180, 600, 180, 700); // down while closed
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
    drag(180, 700, 180, 600);
    drag(180, 700, 180, 600); // up again while open
    expect(handle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('ignores a short drag, a sideways drag, a slow drag and a second finger', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    drag(180, 700, 180, 680); // too short
    drag(100, 700, 300, 660); // mostly sideways
    expect(handle()).toHaveAttribute('aria-expanded', 'false');

    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    fireEvent.touchStart(top(), { touches: [{ clientX: 180, clientY: 700 }] });
    now.mockReturnValue(2_000);
    fireEvent.touchEnd(top(), { changedTouches: [{ clientX: 180, clientY: 600 }] });
    expect(handle()).toHaveAttribute('aria-expanded', 'false');

    now.mockRestore();
    fireEvent.touchStart(top(), {
      touches: [
        { clientX: 180, clientY: 700 },
        { clientX: 200, clientY: 700 },
      ],
    });
    fireEvent.touchEnd(top(), { changedTouches: [{ clientX: 180, clientY: 600 }] });
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('forgets a drag that was cancelled', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    fireEvent.touchStart(top(), { touches: [{ clientX: 180, clientY: 700 }] });
    fireEvent.touchCancel(top());
    fireEvent.touchEnd(top(), { changedTouches: [{ clientX: 180, clientY: 600 }] });
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('on a wide screen', () => {
  it('is a plain panel with the title and the Add player button, and no handle', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const user = userEvent.setup();
    await startSession(user, 5);
    expect(screen.queryByRole('button', { name: /^Waiting/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Waiting (1)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add player' }));
    expect(await screen.findByRole('dialog', { name: 'Add player' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Apply this change to `src/ui/App.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/App.test.tsx
+++ b/src/ui/App.test.tsx
@@ -130,7 +130,7 @@
     const user = userEvent.setup();
     await startFivePlayerSession(user);
 
-    await user.click(screen.getByRole('button', { name: '+ Add player' }));
+    await user.click(screen.getByRole('button', { name: 'Add player' }));
     await user.type(screen.getByLabelText('New player name'), 'Fay');
     await user.click(screen.getByRole('button', { name: 'Add to session' }));
 
@@ -142,7 +142,7 @@
     const user = userEvent.setup();
     await startFivePlayerSession(user);
 
-    await user.click(screen.getByRole('button', { name: '+ Add player' }));
+    await user.click(screen.getByRole('button', { name: 'Add player' }));
     await user.type(screen.getByLabelText('New player name'), 'ann');
     await user.click(screen.getByRole('button', { name: 'Add to session' }));
 
@@ -177,7 +177,7 @@
     }
     await user.click(screen.getByRole('button', { name: 'Start 4 players' }));
 
-    await user.click(screen.getByRole('button', { name: '+ Add player' }));
+    await user.click(screen.getByRole('button', { name: 'Add player' }));
     const offered = await screen.findByRole('list', { name: 'Saved players not in this session' });
     expect(within(offered).getAllByRole('listitem')).toHaveLength(1);
     expect(within(offered).queryByText('Ann')).not.toBeInTheDocument();
@@ -363,7 +363,7 @@
       const user = userEvent.setup();
       await startFivePlayerSession(user);
 
-      const trigger = screen.getByRole('button', { name: '+ Add player' });
+      const trigger = screen.getByRole('button', { name: 'Add player' });
       await user.click(trigger);
       const dialog = await screen.findByRole('dialog', { name: 'Add player' });
 
```

- [ ] **Step 3: Apply this change to `src/ui/photos.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/photos.test.tsx
+++ b/src/ui/photos.test.tsx
@@ -103,7 +103,7 @@
     await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee');
     await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
 
-    await user.click(screen.getByRole('button', { name: '+ Add player' }));
+    await user.click(screen.getByRole('button', { name: 'Add player' }));
     await user.type(await screen.findByLabelText('New player name'), 'Fay');
     await user.click(screen.getByRole('button', { name: 'Add with photo' }));
     await takeAndUsePhoto(user);
@@ -118,7 +118,7 @@
     await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee');
     await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
 
-    await user.click(screen.getByRole('button', { name: '+ Add player' }));
+    await user.click(screen.getByRole('button', { name: 'Add player' }));
     await user.type(await screen.findByLabelText('New player name'), 'Fay');
     await user.click(screen.getByRole('button', { name: 'Add with photo' }));
     await user.click(await screen.findByRole('button', { name: 'Add without a photo' }));
@@ -171,7 +171,7 @@
     await act(() => useRosterStore.getState().setPhoto(ann.id, { type: 'image/jpeg', data: new Uint8Array([9]).buffer }));
     await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
 
-    await user.click(screen.getByRole('button', { name: '+ Add player' }));
+    await user.click(screen.getByRole('button', { name: 'Add player' }));
     await user.type(await screen.findByLabelText('New player name'), 'ann');
     await user.click(screen.getByRole('button', { name: 'Add with photo' }));
 
@@ -188,7 +188,7 @@
     await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee');
     await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
 
-    await user.click(screen.getByRole('button', { name: '+ Add player' }));
+    await user.click(screen.getByRole('button', { name: 'Add player' }));
     await user.type(await screen.findByLabelText('New player name'), 'Fay');
     await user.click(screen.getByRole('button', { name: 'Add with photo' }));
     expect(await screen.findByText(/Fay is saved\./)).toBeInTheDocument();
```

- [ ] **Step 4: Apply this change to `src/ui/liveScreen.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/liveScreen.test.tsx
+++ b/src/ui/liveScreen.test.tsx
@@ -344,27 +344,11 @@
     expect(screen.getByRole('heading', { name: 'Waiting (1)' })).toBeInTheDocument();
   });
 
-  it('keeps every action on the open list: the waiting rows and Add player', async () => {
+  it('keeps every action on the open list: the waiting rows, with Add player always at the top', async () => {
     const user = userEvent.setup();
     await startSession(user, FIVE);
     await user.click(screen.getByRole('button', { name: /^Waiting/ }));
     expect(within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('button')).toHaveLength(1);
-    expect(screen.getByRole('button', { name: '+ Add player' })).toBeInTheDocument();
-  });
-});
-
-describe('the waiting sheet chevron', () => {
-  it('is a drawn icon, not a text character, and flips when the sheet opens', async () => {
-    const user = userEvent.setup();
-    await startSession(user, FIVE);
-    const handle = screen.getByRole('button', { name: /^Waiting/ });
-    const chevron = handle.querySelector('svg.sheet-chevron');
-    expect(chevron).not.toBeNull();
-    expect(handle.textContent).not.toMatch(/[⌃⌄^v]/);
-    const sheet = handle.closest('.waiting-sheet')!;
-    expect(sheet).not.toHaveClass('is-open');
-    await user.click(handle);
-    expect(sheet).toHaveClass('is-open');
-    expect(handle.querySelector('svg.sheet-chevron')).toBe(chevron);
-  });
-});
+    expect(screen.getByRole('button', { name: 'Add player' })).toBeInTheDocument();
+  });
+});
```

- [ ] **Step 5: Apply this change to `src/ui/readyStep.test.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/readyStep.test.tsx
+++ b/src/ui/readyStep.test.tsx
@@ -154,14 +154,13 @@
 });
 
 describe('the Waiting sheet', () => {
-  it('says the courts are ready when every court holds a lineup and four more are waiting', async () => {
+  it('says who is next in line when every court holds a lineup and four more are waiting', async () => {
     const user = userEvent.setup();
     await startSession(user, 12);
-    expect(screen.getByText('Courts are ready. Press Start.')).toBeInTheDocument();
+    expect(screen.getByText('Next in line')).toBeInTheDocument();
     await user.click(screen.getByRole('button', { name: 'Menu' }));
     await user.click(screen.getByRole('button', { name: 'Start all ready courts' }));
-    expect(screen.queryByText('Courts are ready. Press Start.')).not.toBeInTheDocument();
-    expect(screen.getByText(/^Next game, court \d$/)).toBeInTheDocument();
+    expect(screen.getByText('Next in line')).toBeInTheDocument();
   });
 });
 
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run src/ui/waitingSheetTop.test.tsx src/ui/App.test.tsx src/ui/photos.test.tsx src/ui/readyStep.test.tsx src/ui/liveScreen.test.tsx
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 7: Create `src/ui/useSheetSwipe.ts`**

```ts
import { useRef, type TouchEvent } from 'react';

/** How far a finger has to travel up or down, in pixels, for a swipe. */
const MIN_DISTANCE = 40;
/** A slower drag is not a swipe. */
const MAX_MS = 700;
/** A swipe is mostly vertical: a mostly sideways drag is something else. */
const VERTICAL_BIAS = 1.2;

/** Touch handlers that report a quick up or down swipe. The direction is the way the finger moved. */
export function useSheetSwipe(onSwipe: (direction: 'up' | 'down') => void) {
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  return {
    onTouchStart(event: TouchEvent<HTMLElement>) {
      const touch = event.touches[0];
      start.current = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY, at: Date.now() } : null;
    },
    onTouchEnd(event: TouchEvent<HTMLElement>) {
      const from = start.current;
      start.current = null;
      const touch = event.changedTouches[0];
      if (!from || !touch) return;
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      if (Date.now() - from.at > MAX_MS) return;
      if (Math.abs(dy) < MIN_DISTANCE || Math.abs(dy) < Math.abs(dx) * VERTICAL_BIAS) return;
      onSwipe(dy < 0 ? 'up' : 'down');
    },
    onTouchCancel() {
      start.current = null;
    },
  };
}
```

- [ ] **Step 8: Apply this change to `src/ui/WaitingSheet.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/WaitingSheet.tsx
+++ b/src/ui/WaitingSheet.tsx
@@ -3,6 +3,7 @@
 import type { Session } from '../engine';
 import { PlayerAvatar } from './PlayerAvatar';
 import { useIsWide } from './useIsWide';
+import { useSheetSwipe } from './useSheetSwipe';
 
 interface Props {
   session: Session;
@@ -27,22 +28,32 @@
   const next = engine.previewNext(session);
   const byId = new Map(session.players.map((p) => [p.id, p]));
   const peek = next ? next.playerIds.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])) : waiting.slice(0, 4);
-  // Every open court holding a lineup that has not started: the reason there is no court for the next four.
-  const openCourts = session.courts.filter((c) => !c.closing);
-  const allReady = openCourts.length > 0 && openCourts.every((c) => c.status === 'ready');
-  const nextLabel = next
-    ? `Next game, court ${next.courtNumber}`
-    : waiting.length >= 4
-      ? allReady
-        ? 'Courts are ready. Press Start.'
-        : 'No open court to play on'
-      : `Need ${4 - waiting.length} more waiting to fill the next game`;
+  const more = Math.max(0, waiting.length - peek.length);
+  const nextLabel = waiting.length >= 4 ? 'Next in line' : `Need ${4 - waiting.length} more waiting to fill the next game`;
+  // Swiping up on the top of the sheet opens it, swiping down closes it.
+  const swipe = useSheetSwipe((direction) => setOpen(direction === 'up'));
 
   function onKeyDown(event: KeyboardEvent<HTMLElement>) {
     if (event.key === 'Escape' && open) setOpen(false);
   }
 
   const title = <span id={titleId}>Waiting ({waiting.length})</span>;
+  const addButton = (
+    <button
+      type="button"
+      className="btn btn-small sheet-add"
+      onClick={(e) => {
+        // The top of the sheet toggles it; adding a player must not.
+        e.stopPropagation();
+        onAdd();
+      }}
+    >
+      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
+        <path d="M12 5v14M5 12h14" />
+      </svg>
+      Add player
+    </button>
+  );
 
   return (
     <section
@@ -51,33 +62,37 @@
       onKeyDown={onKeyDown}
     >
       {wide ? (
-        <h2 className="section-title">{title}</h2>
+        <div className="sheet-bar">
+          <h2 className="section-title">{title}</h2>
+          {addButton}
+        </div>
       ) : (
-        <h2 className="sheet-head">
-          <button type="button" className="sheet-handle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
-            <span className="sheet-grip" aria-hidden="true" />
-            <span className="sheet-handle-title">{title}</span>
-            <svg className="sheet-chevron" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
-              <path d="m6 15 6-6 6 6" />
-            </svg>
-          </button>
-          <button type="button" className="btn btn-ghost icon-btn sheet-add" aria-label="Add player" onClick={onAdd}>
-            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
-              <path d="M12 5v14M5 12h14" />
-            </svg>
-          </button>
-        </h2>
+        // The whole top of the sheet opens and closes it. The real button inside is what keyboards and screen readers
+        // use; a tap anywhere on the grip, the title, the label or the faces reaches it through this handler.
+        <div className="sheet-top" onClick={() => setOpen(!open)} {...swipe}>
+          <div className="sheet-bar">
+            <h2 className="sheet-head">
+              <button type="button" className="sheet-handle" aria-expanded={open} aria-controls={bodyId}>
+                <span className="sheet-grip" aria-hidden="true" />
+                <span className="sheet-handle-title">{title}</span>
+              </button>
+            </h2>
+            {addButton}
+          </div>
+          <p className="next-label">{nextLabel}</p>
+          <div className="peek-row">
+            <ul className="peek" aria-label="Next game players">
+              {peek.map((p) => (
+                <li key={p.id}>
+                  <PlayerAvatar name={p.name} rosterId={p.rosterId} size="md" />
+                  <span className="peek-name">{firstName(p.name)}</span>
+                </li>
+              ))}
+            </ul>
+            {more > 0 && <span className="peek-more">+{more} more</span>}
+          </div>
+        </div>
       )}
-
-      <p className="next-label">{nextLabel}</p>
-      <ul className="peek" aria-label="Next game players">
-        {peek.map((p) => (
-          <li key={p.id}>
-            <PlayerAvatar name={p.name} rosterId={p.rosterId} size="md" />
-            <span className="peek-name">{firstName(p.name)}</span>
-          </li>
-        ))}
-      </ul>
 
       <div id={bodyId} className="waiting-body">
         {waiting.length === 0 ? (
@@ -121,10 +136,6 @@
             </ul>
           </>
         )}
-
-        <button type="button" className="dashed" onClick={onAdd}>
-          + Add player
-        </button>
       </div>
     </section>
   );
```

- [ ] **Step 9: Apply this change to `src/styles/app.css`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -730,7 +730,7 @@
   align-items: stretch;
   gap: 6px;
   padding: 8px 6px 10px;
-  border: 2px solid color-mix(in srgb, var(--ink) 28%, transparent);
+  border: 1px solid color-mix(in srgb, var(--ink) 32%, transparent);
   border-radius: 16px;
   background: var(--bg);
 }
@@ -853,23 +853,6 @@
   background: var(--line);
 }
 
-.sheet-chevron {
-  flex: none;
-  color: var(--muted);
-  transition: transform 0.15s ease;
-}
-
-/* The chevron points up while the sheet is closed (it opens upward) and down once it is open. */
-.waiting-sheet.is-open .sheet-chevron {
-  transform: rotate(180deg);
-}
-
-@media (prefers-reduced-motion: reduce) {
-  .sheet-chevron {
-    transition: none;
-  }
-}
-
 .next-label {
   margin: 0;
   color: var(--muted);
@@ -1429,22 +1412,51 @@
   accent-color: var(--ink);
 }
 
-.waiting-sheet .sheet-head {
-  display: flex;
-  align-items: center;
-  gap: 4px;
-}
-
-.waiting-sheet .sheet-handle {
+.sheet-top {
+  cursor: pointer;
+}
+
+.sheet-bar {
+  display: flex;
+  align-items: center;
+  gap: 8px;
+}
+
+.sheet-bar .sheet-head,
+.sheet-bar .section-title {
   flex: 1;
   min-width: 0;
 }
 
+.sheet-bar .section-title {
+  margin: 0;
+}
+
 .sheet-add {
+  display: inline-flex;
   flex: none;
+  align-items: center;
+  justify-content: center;
+  gap: 6px;
   margin-top: 8px;
 }
 
+.peek-row {
+  display: flex;
+  align-items: flex-start;
+  gap: 12px;
+}
+
+.peek-more {
+  align-self: center;
+  padding: 6px 12px;
+  border: 1px solid var(--line);
+  border-radius: 999px;
+  color: var(--muted);
+  font-size: 14px;
+  font-weight: 700;
+  white-space: nowrap;
+}
 
 .why-waiting {
   margin: 0;
@@ -1462,9 +1474,12 @@
   text-transform: uppercase;
 }
 
+.court-tab.is-ready .court-tab-state {
+  font-weight: 800;
+}
+
 .court-tab.is-ready:not(.is-selected) .court-tab-state {
   color: var(--ink);
-  font-weight: 800;
 }
 
 /* ---------- One Undo ---------- */
```

- [ ] **Step 10: Run the tests**

```bash
npx vitest run src/ui
```

Expected: PASS.

- [ ] **Step 11: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/ui/useSheetSwipe.ts src/ui/WaitingSheet.tsx src/styles/app.css src/ui/App.test.tsx src/ui/photos.test.tsx src/ui/liveScreen.test.tsx src/ui/readyStep.test.tsx src/ui/waitingSheetTop.test.tsx
git commit -m "Make the whole top of the Waiting sheet the tap target, with a labelled Add player"
```

## Task 4: Look at it, then merge

- [ ] **Step 1: Build and look at it at 360 by 780**

```bash
npm run build
```

Expected: clean build. In a browser at 360 by 780, light theme: start a session from a saved roster, press Start, then Game finished. The header has no Undo icon. A one-line bar under the court says "Game finished on Court 1" with Undo, and goes by itself after eight seconds. The menu starts with "Undo: Game finished on Court 1". At the bottom, the Waiting sheet shows the title, a labelled Add player button, "Next in line", four faces and a "+N more" chip. Tapping the title, the label or the faces opens the sheet; swiping up opens and swiping down closes it. There is no arrow and no second Add player button inside the open list.

- [ ] **Step 2: Run the Ralph loop** on the finished change, and fix what it finds.

- [ ] **Step 3: Merge to production** after the owner says go.

- [ ] **Step 4: Phone check.** The bar and its Undo, the menu Undo, opening the sheet with a tap on any part of its top and with a swipe, and Add player. Not verifiable without a phone: how the swipe feels against the page's own scrolling, and whether eight seconds is the right length for the bar.

## Self-review

- **Owner's questions covered:** do we need Undo (kept, once, with words), a better way (the bar plus a labelled menu item), remove the arrow and make the top clickable (Task 3), and "things like that" (the lineup toast removed because the card already shows it, the Add player duplicate removed, the Ready label weight and the heavy team border).
- **Equivalent mutations:** two breakages survive because they change nothing observable: the `+N more` count uses `waiting.length - peek.length`, and `peek` is always four faces or everyone waiting, so `- 4` gives the same number whenever the chip shows; and the `hiddenId` check in `UndoBar`, whose only job is to cause a re-render when the eight seconds pass, because the time check on the same line hides the bar either way.
- **Removed on purpose:** the lineup toast and `finishMessage`, the header Undo icon, the chevron, the dashed Add player button lower in the open list, and the Phase 2a words "Courts are ready. Press Start." and "Next game, court N".
- **Placeholders:** none. Every step has its code or diff.
- **Names:** `lastAction`, `LastAction`, `UndoBar`, `useSheetSwipe` are defined once and used by the same names.
