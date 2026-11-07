# PIKLMatch Phase 1: Run it smoothly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the daily annoyances of running a session: the screen stays on, a toast says what a finished court is doing with an Undo, Add player is one tap, courts are remembered, a waiting player can see why, and a second window cannot silently overwrite the session.

**Architecture:** One small engine helper (`explainWaiting`, read-only) and otherwise UI-only changes. Little settings live in `localStorage` through one module (`prefs.ts`) with a memory fallback. Every new behaviour has tests written first.

**Tech Stack:** React 18, TypeScript, Zustand, Vitest with Testing Library, Vite. No new dependencies.

Spec: `docs/superpowers/specs/2026-11-07-organizer-experience-phases.md`, Phase 1 (items 1.1 to 1.6).

**How the code in this plan was proved.** Every file and diff below was built once in a scratch copy of the repository, run with the full suite (580 tests), and mutation-checked (12 deliberate breakages, each caught). The diffs are taken against the repository as it stands at commit `6305e88`. Apply a diff from the project root with `patch -p1 < the-diff-file`, or by hand: each hunk shows its context.

**Conventions.** Run commands from `pickleball-match-app/` (the folder with `package.json`). Stage files by name, never with `git add -A`. No AI attribution lines in commit messages. After the last task, run the Ralph loop before merging.

---
## Task 1: Small settings and the screen wake lock

Two small building blocks with no screen changes yet: a place to keep little settings, and a hook that keeps the screen on.

**Files:**
- Create: `src/ui/prefs.ts`, `src/ui/useWakeLock.ts`
- Test: `src/ui/prefs.test.ts`, `src/ui/useWakeLock.test.tsx`

- [ ] **Step 1: Create `src/ui/prefs.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COURTS_KEY, getBoolPref, getNumPref, setBoolPref, setNumPref } from './prefs';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('boolean preferences', () => {
  it('use the fallback until set, then the stored value', () => {
    expect(getBoolPref('pickleball.testBool', true)).toBe(true);
    setBoolPref('pickleball.testBool', false);
    expect(getBoolPref('pickleball.testBool', true)).toBe(false);
    expect(localStorage.getItem('pickleball.testBool')).toBe('false');
  });

  it('keep working in memory when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getBoolPref('pickleball.blockedBool', true)).toBe(true);
    setBoolPref('pickleball.blockedBool', false);
    expect(getBoolPref('pickleball.blockedBool', true)).toBe(false);
  });
});

describe('number preferences', () => {
  it('fall back when missing or not a whole number, and clamp to the range', () => {
    expect(getNumPref(COURTS_KEY, 2, 1, 12)).toBe(2);
    localStorage.setItem(COURTS_KEY, 'abc');
    expect(getNumPref(COURTS_KEY, 2, 1, 12)).toBe(2);
    localStorage.setItem(COURTS_KEY, '2.5');
    expect(getNumPref(COURTS_KEY, 2, 1, 12)).toBe(2);
    setNumPref(COURTS_KEY, 4);
    expect(getNumPref(COURTS_KEY, 2, 1, 12)).toBe(4);
    setNumPref(COURTS_KEY, 99);
    expect(getNumPref(COURTS_KEY, 2, 1, 12)).toBe(12);
    setNumPref(COURTS_KEY, 0);
    expect(getNumPref(COURTS_KEY, 2, 1, 12)).toBe(1);
  });
});
```

- [ ] **Step 2: Create `src/ui/useWakeLock.test.tsx`**

```tsx
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWakeLock } from './useWakeLock';

type Sentinel = { released: boolean; release: ReturnType<typeof vi.fn> };
let sentinels: Sentinel[];
let request: ReturnType<typeof vi.fn>;

function stubWakeLock(impl?: () => Promise<Sentinel>) {
  request = vi.fn(
    impl ??
      (async () => {
        const s: Sentinel = {
          released: false,
          release: vi.fn(async () => {
            s.released = true;
          }),
        };
        sentinels.push(s);
        return s;
      }),
  );
  vi.stubGlobal('navigator', { wakeLock: { request } });
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  sentinels = [];
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useWakeLock', () => {
  it('asks for one screen lock while active, and lets it go when it stops being active', async () => {
    stubWakeLock();
    const { rerender, unmount } = renderHook(({ on }) => useWakeLock(on), { initialProps: { on: true } });
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('screen');
    rerender({ on: false });
    await act(async () => {});
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
    unmount();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('asks for nothing while inactive', async () => {
    stubWakeLock();
    renderHook(() => useWakeLock(false));
    await act(async () => {});
    expect(request).not.toHaveBeenCalled();
  });

  it('asks again when the page comes back after the browser dropped the lock', async () => {
    stubWakeLock();
    renderHook(() => useWakeLock(true));
    await act(async () => {});
    sentinels[0].released = true; // the browser drops it when the page is hidden
    act(() => setVisibility('hidden'));
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1); // not asked while hidden
    act(() => setVisibility('visible'));
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not ask twice while it still holds a lock', async () => {
    stubWakeLock();
    renderHook(() => useWakeLock(true));
    await act(async () => {});
    act(() => setVisibility('visible'));
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('releases a lock that arrives after it was stopped', async () => {
    let resolve!: (s: Sentinel) => void;
    stubWakeLock(() => new Promise<Sentinel>((r) => (resolve = r)));
    const { unmount } = renderHook(() => useWakeLock(true));
    unmount();
    const late: Sentinel = { released: false, release: vi.fn(async () => {}) };
    await act(async () => resolve(late));
    expect(late.release).toHaveBeenCalledTimes(1);
  });

  it('does nothing without the feature, and survives a refusal', async () => {
    vi.stubGlobal('navigator', {});
    renderHook(() => useWakeLock(true));
    await act(async () => {});
    stubWakeLock(async () => {
      throw new Error('refused');
    });
    renderHook(() => useWakeLock(true));
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
npx vitest run src/ui/prefs.test.ts src/ui/useWakeLock.test.tsx
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 4: Create `src/ui/prefs.ts`**

```ts
import { useSyncExternalStore } from 'react';

/** Small settings kept in localStorage, with a memory fallback when storage is blocked. */
export const KEEP_AWAKE_KEY = 'pickleball.keepAwake';
export const VIBRATE_KEY = 'pickleball.vibrate';
export const COURTS_KEY = 'pickleball.courts';

const listeners = new Set<() => void>();
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getBoolPref(key: string, fallback: boolean): boolean {
  const v = read(key);
  return v === null ? fallback : v === 'true';
}

export function setBoolPref(key: string, value: boolean): void {
  write(key, String(value));
}

export function useBoolPref(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => getBoolPref(key, fallback),
    () => fallback,
  );
  return [value, (v) => setBoolPref(key, v)];
}

/** A whole number from storage, clamped to a range; the fallback when missing or not a number. */
export function getNumPref(key: string, fallback: number, min: number, max: number): number {
  const n = Number(read(key));
  if (read(key) === null || !Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function setNumPref(key: string, value: number): void {
  write(key, String(value));
}
```

- [ ] **Step 5: Create `src/ui/useWakeLock.ts`**

```ts
import { useEffect } from 'react';

interface Sentinel {
  released: boolean;
  release: () => Promise<void>;
}
interface WakeLockApi {
  request: (type: 'screen') => Promise<Sentinel>;
}

/**
 * Keeps the screen on while `active`. The browser drops the lock whenever the page is hidden, so it is asked for again
 * when the page comes back. Where the feature is missing or refused, nothing happens.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const api = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;
    if (!api) return;
    let sentinel: Sentinel | null = null;
    let stopped = false;

    async function acquire() {
      if (document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      try {
        const next = await api!.request('screen');
        if (stopped) void next.release().catch(() => {});
        else sentinel = next;
      } catch {
        // Refused (for example by battery saver): carry on without it.
      }
    }

    void acquire();
    const onVisible = () => void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run src/ui/prefs.test.ts src/ui/useWakeLock.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/ui/prefs.ts src/ui/prefs.test.ts src/ui/useWakeLock.ts src/ui/useWakeLock.test.tsx
git commit -m "Add a small settings store and a screen wake lock hook"
```

## Task 2: Keep the screen on, Settings switches, courts remembered

Uses the two blocks: the session keeps the screen on, Settings gets the During a session card, and New session starts with the last number of courts.

**Files:**
- Modify: `src/ui/App.tsx`, `src/ui/SettingsScreen.tsx`, `src/ui/SetupScreen.tsx`, `src/styles/app.css`
- Test: `src/ui/sessionPrefs.test.tsx`

- [ ] **Step 1: Create `src/ui/sessionPrefs.test.tsx`**

```tsx
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import App from './App';

beforeEach(async () => {
  localStorage.clear();
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as unknown as Record<string, unknown>).vibrate;
  delete (navigator as unknown as Record<string, unknown>).wakeLock;
});

const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.fromCharCode(65 + i)}`).join('{enter}');

describe('the screen stays on during a session', () => {
  function stubWakeLock() {
    const release = vi.fn(async () => {});
    const request = vi.fn(async () => ({ released: false, release }));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    return { request, release };
  }

  it('asks once for the whole session, keeps it through Settings, and lets go when the session ends', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { request, release } = stubWakeLock();
    render(<App />);
    await act(async () => {});
    expect(request).not.toHaveBeenCalled(); // no session yet
    await user.type(screen.getByLabelText('Search or add players'), names(5));
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Start 5 players' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(release).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'End session' }));
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
  });

  it('asks for nothing when Keep the screen on is off in Settings', async () => {
    const user = userEvent.setup();
    const { request } = stubWakeLock();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    const keep = screen.getByRole('switch', { name: 'Keep the screen on' });
    expect(keep).toBeChecked();
    await user.click(keep);
    expect(localStorage.getItem('pickleball.keepAwake')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.type(screen.getByLabelText('Search or add players'), names(5));
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Start 5 players' }));
    await act(async () => {});
    expect(request).not.toHaveBeenCalled();
  });
});

describe('Settings, During a session', () => {
  it('has two switches that start on and remember a change', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    const buzz = screen.getByRole('switch', { name: 'Buzz when a game finishes' });
    expect(buzz).toBeChecked();
    await user.click(buzz);
    expect(buzz).not.toBeChecked();
    expect(localStorage.getItem('pickleball.vibrate')).toBe('false');
    await user.click(buzz);
    expect(localStorage.getItem('pickleball.vibrate')).toBe('true');
  });
});

describe('courts are remembered', () => {
  it('starts the next New session with the number last used', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('group', { name: 'Courts' })).toHaveTextContent('2');
    await user.type(screen.getByLabelText('Search or add players'), names(4));
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'More courts' }));
    await user.click(screen.getByRole('button', { name: 'More courts' }));
    await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
    expect(localStorage.getItem('pickleball.courts')).toBe('4');
    act(() => useSessionStore.getState().reset());
    expect(screen.getByRole('group', { name: 'Courts' })).toHaveTextContent('4');
  });

  it('ignores a bad stored value', () => {
    localStorage.setItem('pickleball.courts', 'lots');
    render(<App />);
    expect(screen.getByRole('group', { name: 'Courts' })).toHaveTextContent('2');
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/ui/sessionPrefs.test.tsx
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 3: Apply this change to `src/ui/App.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/App.tsx
+++ b/src/ui/App.tsx
@@ -12,6 +12,8 @@
 import { SettingsScreen } from './SettingsScreen';
 import { SetupScreen } from './SetupScreen';
 import { SummaryScreen } from './SummaryScreen';
+import { KEEP_AWAKE_KEY, useBoolPref } from './prefs';
+import { useWakeLock } from './useWakeLock';
 
 export default function App() {
   const session = useSessionStore((s) => s.session);
@@ -22,6 +24,7 @@
   const rosterBlocked = useRosterStore((s) => s.blocked);
   const loadRoster = useRosterStore((s) => s.load);
   const initAuth = useAuthStore((s) => s.init);
+  const [keepAwake] = useBoolPref(KEEP_AWAKE_KEY, true);
   const [view, setView] = useState<'setup' | 'saved' | 'settings'>('setup');
   // Saved players can be opened from Setup or from Settings; Back returns to whichever it came from.
   const [savedFrom, setSavedFrom] = useState<'setup' | 'settings'>('setup');
@@ -38,6 +41,9 @@
   useEffect(() => {
     void initAuth();
   }, [initAuth]);
+
+  // The screen stays on for as long as a session is running, however many screens the organizer visits.
+  useWakeLock(!!session && !session.endedAt && keepAwake);
 
   // Keeps saved players backed up while signed in. It does nothing without a backend or a signed-in organizer.
   useEffect(() => startSyncCoordinator(), []);
```

- [ ] **Step 4: Apply this change to `src/ui/SettingsScreen.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/SettingsScreen.tsx
+++ b/src/ui/SettingsScreen.tsx
@@ -4,6 +4,7 @@
 import { useSyncStore } from '../sync/syncStore';
 import { SyncStatusLine } from './SyncStatusLine';
 import { useDefaultMode } from './matchmaking';
+import { KEEP_AWAKE_KEY, useBoolPref, VIBRATE_KEY } from './prefs';
 import { useTheme } from './useTheme';
 
 interface Props {
@@ -17,6 +18,8 @@
   const syncStatus = useSyncStore((s) => s.status);
   const [theme, toggleTheme] = useTheme();
   const [mode, setMode] = useDefaultMode();
+  const [keepAwake, setKeepAwake] = useBoolPref(KEEP_AWAKE_KEY, true);
+  const [vibrate, setVibrate] = useBoolPref(VIBRATE_KEY, true);
   const [working, setWorking] = useState(false);
   const [outcome, setOutcome] = useState<{ result: DataResult; done: string } | null>(null);
 
@@ -75,6 +78,21 @@
           </label>
         </div>
         <p className="muted">Applies to new sessions. Fairness gives the players with the fewest games the next court. Simple queue goes in the order people arrive.</p>
+      </section>
+
+      <section className="card stack" aria-labelledby="during-title">
+        <h2 id="during-title" className="section-title">
+          During a session
+        </h2>
+        <label className="switch-row">
+          <span>Keep the screen on</span>
+          <input type="checkbox" role="switch" checked={keepAwake} onChange={(e) => setKeepAwake(e.target.checked)} />
+        </label>
+        <label className="switch-row">
+          <span>Buzz when a game finishes</span>
+          <input type="checkbox" role="switch" checked={vibrate} onChange={(e) => setVibrate(e.target.checked)} />
+        </label>
+        <p className="muted">The buzz only works on phones and browsers that allow it.</p>
       </section>
 
       <section className="card stack" aria-labelledby="players-title">
```

- [ ] **Step 5: Apply this change to `src/ui/SetupScreen.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/SetupScreen.tsx
+++ b/src/ui/SetupScreen.tsx
@@ -3,6 +3,7 @@
 import { useRosterStore } from '../store/rosterStore';
 import { useSessionStore } from '../store/sessionStore';
 import { getDefaultMode, useDefaultMode } from './matchmaking';
+import { COURTS_KEY, getNumPref, setNumPref } from './prefs';
 import { PlayerAvatar } from './PlayerAvatar';
 
 const MIN_PLAYERS = 4;
@@ -25,7 +26,7 @@
   const start = useSessionStore((s) => s.start);
   const [mode] = useDefaultMode();
 
-  const [courtCount, setCourtCount] = useState(2);
+  const [courtCount, setCourtCount] = useState(() => getNumPref(COURTS_KEY, 2, 1, MAX_COURTS));
   const [selected, setSelected] = useState<Set<string>>(new Set());
   const [query, setQuery] = useState('');
   const [error, setError] = useState<string | null>(null);
@@ -89,7 +90,8 @@
       courtCount,
       players: chosen.map((p) => ({ name: p.name, rosterId: p.id })),
     });
-    if (!res.ok) setStartError(res.error);
+    if (res.ok) setNumPref(COURTS_KEY, courtCount);
+    else setStartError(res.error);
   }
 
   return (
```

- [ ] **Step 6: Add this to the end of `src/styles/app.css`**

```css

/* ---------- Phase 1: toast, add button, switches ---------- */
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  cursor: pointer;
}

.switch-row input {
  width: 22px;
  height: 22px;
  accent-color: var(--ink);
}
```

- [ ] **Step 7: Run the tests**

```bash
npx vitest run src/ui/sessionPrefs.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/ui/App.tsx src/ui/SettingsScreen.tsx src/ui/SetupScreen.tsx src/styles/app.css src/ui/sessionPrefs.test.tsx
git commit -m "Keep the screen on during a session, add During a session settings, remember the courts"
```

## Task 3: A toast after Game finished

After a game finishes, say what the court is doing now with an Undo, and buzz briefly where the device allows.

**Files:**
- Create: `src/ui/finishMessage.ts`, `src/ui/Toast.tsx`
- Modify: `src/ui/LiveScreen.tsx`, `src/styles/app.css`
- Test: `src/ui/finishMessage.test.ts`, `src/ui/Toast.test.tsx`, `src/ui/liveToast.test.tsx`

- [ ] **Step 1: Create `src/ui/finishMessage.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { finishGame } from '../engine/game';
import { makeCtx, mkPlayer, mkSession, newTestSession } from '../engine/testing';
import { finishMessage } from './finishMessage';

const idle = { id: 'c1', number: 1, status: 'empty' as const, closing: false };

describe('finishMessage', () => {
  it('names the new lineup on the court that just finished', () => {
    const ctx = makeCtx();
    let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve'], { courts: 1 }, ctx);
    s = finishGame(s, s.courts[0].id, ctx);
    const text = finishMessage(s, 1);
    expect(text).toMatch(/^Court 1: \w+ and \w+ vs \w+ and \w+$/);
    const named = text.match(/\b(Ann|Ben|Cy|Dee|Eve)\b/g)!;
    expect(new Set(named).size).toBe(4);
    for (const n of named) expect(s.players.find((p) => p.name === n)).toBeTruthy();
  });

  it('says how many more players a game needs when none can start', () => {
    const two = mkSession([mkPlayer('a'), mkPlayer('b')], { courts: [idle] });
    expect(finishMessage(two, 1)).toBe('Court 1 finished. Waiting for 2 more players.');
    const three = mkSession([mkPlayer('a'), mkPlayer('b'), mkPlayer('c')], { courts: [idle] });
    expect(finishMessage(three, 1)).toBe('Court 1 finished. Waiting for 1 more player.');
  });

  it('is brief when nothing is missing, and says when the court closed', () => {
    const four = mkSession([mkPlayer('a'), mkPlayer('b'), mkPlayer('c'), mkPlayer('d')], { courts: [idle] });
    expect(finishMessage(four, 1)).toBe('Court 1 finished.');
    expect(finishMessage(four, 7)).toBe('Court 7 closed.');
  });
});
```

- [ ] **Step 2: Create `src/ui/Toast.test.tsx`**

```tsx
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toast } from './Toast';

afterEach(() => vi.useRealTimers());

describe('Toast', () => {
  it('shows its text as a status message with an Undo button that works', async () => {
    const onUndo = vi.fn();
    render(<Toast id={1} text="Court 1: Ann and Ben vs Cy and Dee" onUndo={onUndo} onDismiss={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('Court 1: Ann and Ben vs Cy and Dee');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('goes away by itself after eight seconds, and not before', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast id={1} text="x" onUndo={() => {}} onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(7_999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('starts the wait again when a new message replaces it', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(<Toast id={1} text="one" onUndo={() => {}} onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(6_000));
    rerender(<Toast id={2} text="two" onUndo={() => {}} onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(6_000));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2_000));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Create `src/ui/liveToast.test.tsx`**

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import App from './App';

type User = ReturnType<typeof userEvent.setup>;

beforeEach(async () => {
  localStorage.clear();
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as unknown as Record<string, unknown>).vibrate;
  delete (navigator as unknown as Record<string, unknown>).wakeLock;
});

const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.fromCharCode(65 + i)}`).join('{enter}');

async function startSession(user: User, list: string) {
  render(<App />);
  await user.type(screen.getByLabelText('Search or add players'), list);
  await user.keyboard('{Enter}');
  const count = list.split('{enter}').length;
  await user.click(await screen.findByRole('button', { name: `Start ${count} players` }));
}
const finishButton = () => screen.getByRole('button', { name: /^Game finished/ });
const toastEl = () => document.querySelector<HTMLElement>('.toast');

describe('the toast after Game finished', () => {
  it('names the new lineup with an Undo, and Undo puts the game back', async () => {
    const user = userEvent.setup();
    await startSession(user, names(5));
    expect(toastEl()).toBeNull();
    const before = useSessionStore.getState().session!.courts[0].game!;
    await user.click(finishButton());
    expect(toastEl()!.textContent).toMatch(/^Court 1: P\w and P\w vs P\w and P\wUndo$/);
    expect(screen.getByText('1 game played')).toBeInTheDocument();
    await user.click(within(toastEl()!).getByRole('button', { name: 'Undo' }));
    expect(toastEl()).toBeNull();
    expect(screen.getByText('0 games played')).toBeInTheDocument();
    expect(useSessionStore.getState().session!.courts[0].game).toEqual(before);
  });

  it('says what is missing when no new game can start', async () => {
    const user = userEvent.setup();
    await startSession(user, names(4));
    await user.click(finishButton());
    // Four players finished and are all waiting again, so the court starts straight away.
    expect(toastEl()!.textContent).toMatch(/^Court 1: /);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Remove court 1' }));
    await user.click(finishButton());
    expect(toastEl()!.textContent).toMatch(/^Court 1 closed\./);
  });

  it('shows only the latest message when two courts finish one after the other', async () => {
    const user = userEvent.setup();
    await startSession(user, names(8));
    await user.click(finishButton());
    expect(toastEl()!.textContent).toMatch(/^Court 1:/);
    await user.click(screen.getAllByRole('tab')[1]);
    await user.click(finishButton());
    expect(document.querySelectorAll('.toast')).toHaveLength(1);
    expect(toastEl()!.textContent).toMatch(/^Court 2:/);
  });

  it('buzzes briefly by default, never when switched off, and survives a device that refuses', async () => {
    const user = userEvent.setup();
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    await startSession(user, names(5));
    await user.click(finishButton());
    expect(vibrate).toHaveBeenCalledWith(25);

    vibrate.mockClear();
    localStorage.setItem('pickleball.vibrate', 'false');
    await user.click(finishButton());
    expect(vibrate).not.toHaveBeenCalled();

    localStorage.setItem('pickleball.vibrate', 'true');
    vibrate.mockImplementation(() => {
      throw new Error('not allowed');
    });
    await user.click(finishButton());
    expect(toastEl()).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/ui/finishMessage.test.ts src/ui/Toast.test.tsx src/ui/liveToast.test.tsx
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 5: Create `src/ui/finishMessage.ts`**

```ts
import * as engine from '../engine';
import type { Session } from '../engine';

const join = (names: string[]) => names.join(' and ');

/** What changed on a court after a game finished, written to be read out: the new lineup, or why there is none. */
export function finishMessage(after: Session, courtNumber: number): string {
  const court = after.courts.find((c) => c.number === courtNumber);
  if (!court) return `Court ${courtNumber} closed.`;
  const names = (ids: string[]) => ids.map((id) => after.players.find((p) => p.id === id)?.name ?? 'Unknown');
  if (court.game) {
    return `Court ${courtNumber}: ${join(names(court.game.team1))} vs ${join(names(court.game.team2))}`;
  }
  const missing = Math.max(0, 4 - engine.orderedWaiting(after).length);
  return missing > 0
    ? `Court ${courtNumber} finished. Waiting for ${missing} more ${missing === 1 ? 'player' : 'players'}.`
    : `Court ${courtNumber} finished.`;
}
```

- [ ] **Step 6: Create `src/ui/Toast.tsx`**

```tsx
import { useEffect } from 'react';

interface Props {
  text: string;
  /** Changes with every new message, so the timer starts again even when the words repeat. */
  id: number;
  onUndo: () => void;
  onDismiss: () => void;
  seconds?: number;
}

/** A short message under the court with an Undo button. It goes by itself after a few seconds. */
export function Toast({ text, id, onUndo, onDismiss, seconds = 8 }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, seconds * 1000);
    return () => clearTimeout(timer);
  }, [id, seconds, onDismiss]);

  return (
    <div className="toast" role="status">
      <span className="toast-text">{text}</span>
      <button type="button" className="btn btn-small toast-undo" onClick={onUndo}>
        Undo
      </button>
    </div>
  );
}
```

- [ ] **Step 7: Apply this change to `src/ui/LiveScreen.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/LiveScreen.tsx
+++ b/src/ui/LiveScreen.tsx
@@ -1,4 +1,4 @@
-import { useMemo, useState } from 'react';
+import { useCallback, useMemo, useState } from 'react';
 import * as engine from '../engine';
 import type { Session } from '../engine';
 import { useRosterStore } from '../store/rosterStore';
@@ -7,8 +7,11 @@
 import { AddPlayerSheet } from './AddPlayerSheet';
 import { CourtCard } from './CourtCard';
 import { CourtTabs } from './CourtTabs';
+import { finishMessage } from './finishMessage';
 import { LiveMenu } from './LiveMenu';
 import { PlayerSheet } from './PlayerSheet';
+import { getBoolPref, VIBRATE_KEY } from './prefs';
+import { Toast } from './Toast';
 import { useSwipe } from './useSwipe';
 import { WaitingSheet } from './WaitingSheet';
 
@@ -24,6 +27,8 @@
   const [slide, setSlide] = useState<'from-right' | 'from-left' | null>(null);
   const [adding, setAdding] = useState(false);
   const [error, setError] = useState<string | null>(null);
+  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
+  const dismissToast = useCallback(() => setToast(null), []);
 
   const playersById = useMemo(
     () => new Map(session.players.map((p) => [p.id, p])),
@@ -44,6 +49,26 @@
     const res = apply(action);
     setError(res.ok ? null : res.error);
     return res.ok;
+  }
+
+  /** Finishes a game and says what the court is doing now, with a way back. */
+  function finishCourt(courtId: string, courtNumber: number) {
+    if (!run((s, ctx) => engine.finishGame(s, courtId, ctx))) return;
+    const after = useSessionStore.getState().session;
+    if (after) setToast({ id: Date.now(), text: finishMessage(after, courtNumber) });
+    // A short buzz where the device can, so a glance away from the screen still knows it registered.
+    if (getBoolPref(VIBRATE_KEY, true)) {
+      try {
+        navigator.vibrate?.(25);
+      } catch {
+        // Not allowed here: the toast is enough.
+      }
+    }
+  }
+
+  function undoLast() {
+    undo();
+    setToast(null);
   }
 
   function endSession() {
@@ -85,7 +110,7 @@
           </span>
         </div>
         <div className="live-actions">
-          <button type="button" className="btn btn-ghost icon-btn" aria-label="Undo" disabled={undoCount === 0} onClick={undo}>
+          <button type="button" className="btn btn-ghost icon-btn" aria-label="Undo" disabled={undoCount === 0} onClick={undoLast}>
             <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
               <path d="M9 14 4 9l5-5" />
               <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
@@ -123,10 +148,11 @@
                 <CourtCard
                   court={selected}
                   playersById={playersById}
-                  onFinish={() => run((s, ctx) => engine.finishGame(s, selected.id, ctx))}
+                  onFinish={() => finishCourt(selected.id, selected.number)}
                   onSelectPlayer={selectPlayer}
                 />
               </div>
+              {toast && <Toast id={toast.id} text={toast.text} onUndo={undoLast} onDismiss={dismissToast} />}
             </>
           )}
         </div>
```

- [ ] **Step 8: Add this to the end of `src/styles/app.css`**

```css

.toast {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px 10px 16px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
}

.toast-text {
  min-width: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.toast-undo {
  flex: none;
}

```

- [ ] **Step 9: Run the tests**

```bash
npx vitest run src/ui/finishMessage.test.ts src/ui/Toast.test.tsx src/ui/liveToast.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/ui/finishMessage.ts src/ui/finishMessage.test.ts src/ui/Toast.tsx src/ui/Toast.test.tsx src/ui/liveToast.test.tsx src/ui/LiveScreen.tsx src/styles/app.css
git commit -m "Show a toast with the new lineup and Undo after Game finished"
```

## Task 4: A visible Add player

A plus button in the Waiting sheet handle and an Add player item at the top of the menu, so a late arrival is one tap.

**Files:**
- Modify: `src/ui/WaitingSheet.tsx`, `src/ui/LiveScreen.tsx`, `src/styles/app.css`
- Test: `src/ui/addPlayerButton.test.tsx`

- [ ] **Step 1: Create `src/ui/addPlayerButton.test.tsx`**

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import App from './App';

type User = ReturnType<typeof userEvent.setup>;

beforeEach(async () => {
  localStorage.clear();
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as unknown as Record<string, unknown>).vibrate;
  delete (navigator as unknown as Record<string, unknown>).wakeLock;
});

const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.fromCharCode(65 + i)}`).join('{enter}');

async function startSession(user: User, list: string) {
  render(<App />);
  await user.type(screen.getByLabelText('Search or add players'), list);
  await user.keyboard('{Enter}');
  const count = list.split('{enter}').length;
  await user.click(await screen.findByRole('button', { name: `Start ${count} players` }));
}

describe('Add player on the live screen', () => {
  it('is one tap away with the Waiting sheet closed, and does not open the sheet', async () => {
    const user = userEvent.setup();
    await startSession(user, names(5));
    const handle = screen.getByRole('button', { name: /^Waiting/ });
    expect(handle).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Add player' }));
    expect(await screen.findByRole('dialog', { name: 'Add player' })).toBeInTheDocument();
    expect(handle).toHaveAttribute('aria-expanded', 'false');
  });

  it('is also the first item of the menu', async () => {
    const user = userEvent.setup();
    await startSession(user, names(5));
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    const pop = document.querySelector<HTMLElement>('.menu-pop')!;
    expect(within(pop).getAllByRole('button')[0]).toHaveTextContent('Add player');
    await user.click(within(pop).getByRole('button', { name: 'Add player' }));
    expect(await screen.findByRole('dialog', { name: 'Add player' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/ui/addPlayerButton.test.tsx
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 3: Apply this change to `src/ui/WaitingSheet.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/WaitingSheet.tsx
+++ b/src/ui/WaitingSheet.tsx
@@ -55,6 +55,11 @@
             <span className="sheet-chevron" aria-hidden="true">
               {open ? '⌄' : '⌃'}
             </span>
+          </button>
+          <button type="button" className="btn btn-ghost icon-btn sheet-add" aria-label="Add player" onClick={onAdd}>
+            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
+              <path d="M12 5v14M5 12h14" />
+            </svg>
           </button>
         </h2>
       )}
```

- [ ] **Step 4: Apply this change to `src/ui/LiveScreen.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/LiveScreen.tsx
+++ b/src/ui/LiveScreen.tsx
@@ -118,6 +118,7 @@
           </button>
           <LiveMenu
             items={[
+              { label: 'Add player', onSelect: openAdd },
               { label: 'Add court', onSelect: () => run((s, ctx) => engine.addCourt(s, ctx)) },
               ...(selected
                 ? [
```

- [ ] **Step 5: Add this to the end of `src/styles/app.css`**

```css

.waiting-sheet .sheet-head {
  display: flex;
  align-items: center;
  gap: 4px;
}

.waiting-sheet .sheet-handle {
  flex: 1;
  min-width: 0;
}

.sheet-add {
  flex: none;
  margin-top: 8px;
}

```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run src/ui/addPlayerButton.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/ui/WaitingSheet.tsx src/ui/LiveScreen.tsx src/styles/app.css src/ui/addPlayerButton.test.tsx
git commit -m "Make Add player visible on the live screen"
```

## Task 5: Why am I waiting

A read-only engine helper explains a waiting player's place in line, and the player sheet shows it.

**Files:**
- Create: `src/engine/explain.ts`
- Modify: `src/engine/index.ts`, `src/ui/PlayerSheet.tsx`, `src/styles/app.css`
- Test: `src/engine/explain.test.ts`, `src/ui/whyWaiting.test.tsx`

- [ ] **Step 1: Create `src/engine/explain.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { explainWaiting } from './explain';
import { mkPlayer, mkSession } from './fixtures';
import { orderedWaiting } from './pool';

const p = (id: string, games: number, seq: number, tieKey = 0.5) => mkPlayer(id, { gamesPlayed: games, lastFinishedSeq: seq, tieKey });

describe('explainWaiting', () => {
  it('is null for anyone who is not waiting', () => {
    const s = mkSession([p('a', 0, 0), p('b', 0, 0), p('c', 0, 0), p('d', 0, 0), mkPlayer('e', { status: 'break' })]);
    expect(explainWaiting(s, 'e')).toBeNull();
    expect(explainWaiting(s, 'nobody')).toBeNull();
  });

  it('says how many more players a game needs, when fewer than four wait', () => {
    const three = mkSession([p('a', 0, 0), p('b', 0, 0), p('c', 0, 0)]);
    expect(explainWaiting(three, 'a')).toEqual({ position: 1, reason: 'Waiting for 1 more player to start a game.' });
    const two = mkSession([p('a', 0, 0), p('b', 0, 0)]);
    expect(explainWaiting(two, 'b')?.reason).toBe('Waiting for 2 more players to start a game.');
  });

  it('puts the player with the fewest games first and says so', () => {
    const s = mkSession([p('a', 2, 1), p('b', 1, 1), p('c', 0, 1), p('d', 2, 1), p('e', 1, 1)]);
    expect(explainWaiting(s, 'c')).toEqual({ position: 1, reason: 'Fewest games so far (0).' });
  });

  it('says who has waited longest when games are level at the front', () => {
    const s = mkSession([p('a', 1, 4), p('b', 1, 2), p('c', 1, 6), p('d', 2, 1)]);
    expect(explainWaiting(s, 'b')).toEqual({ position: 1, reason: 'Waiting the longest among players with 1 game.' });
  });

  it('admits a fixed random pick when games and waiting are both level', () => {
    const s = mkSession([p('a', 1, 3, 0.9), p('b', 1, 3, 0.1), p('c', 1, 3, 0.5), p('d', 1, 3, 0.7)]);
    expect(explainWaiting(s, 'b')).toEqual({ position: 1, reason: 'Tied with others, so the order is a fixed random pick.' });
    expect(explainWaiting(s, 'c')).toEqual({ position: 2, reason: 'Tied with the player ahead, so the order is a fixed random pick.' });
  });

  it('explains a later place by the player directly ahead', () => {
    const s = mkSession([p('a', 0, 1), p('b', 1, 2), p('c', 1, 5), p('d', 2, 1)]);
    expect(explainWaiting(s, 'b')?.position).toBe(2);
    expect(explainWaiting(s, 'b')?.reason).toBe('Played 1 game. Players with fewer games go first.');
    expect(explainWaiting(s, 'c')).toEqual({ position: 3, reason: 'Same games as the player ahead, who has waited longer.' });
    expect(explainWaiting(s, 'd')).toEqual({ position: 4, reason: 'Played 2 games. Players with fewer games go first.' });
  });

  it('describes the queue by arrival order', () => {
    const s = mkSession([p('a', 3, 9), p('b', 0, 0), p('c', 0, 0), p('d', 0, 0), p('e', 0, 0)], {
      mode: 'queue',
      queueOrder: ['c', 'a', 'b', 'd', 'e'],
    });
    expect(explainWaiting(s, 'c')).toEqual({ position: 1, reason: 'Next in the order people arrived.' });
    expect(explainWaiting(s, 'a')).toEqual({ position: 2, reason: 'In the order people arrived.' });
  });

  it('always agrees with the order the engine really uses', () => {
    for (const mode of ['fairness', 'queue'] as const) {
      const players = [p('a', 2, 3, 0.3), p('b', 1, 7, 0.8), p('c', 1, 2, 0.1), p('d', 0, 9, 0.6), p('e', 2, 3, 0.2), p('f', 1, 2, 0.4)];
      const s = mkSession(players, { mode, queueOrder: ['f', 'd', 'a', 'c', 'b', 'e'] });
      orderedWaiting(s).forEach((q, i) => expect(explainWaiting(s, q.id)?.position).toBe(i + 1));
    }
  });
});
```

- [ ] **Step 2: Create `src/ui/whyWaiting.test.tsx`**

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import App from './App';

type User = ReturnType<typeof userEvent.setup>;

beforeEach(async () => {
  localStorage.clear();
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as unknown as Record<string, unknown>).vibrate;
  delete (navigator as unknown as Record<string, unknown>).wakeLock;
});

const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.fromCharCode(65 + i)}`).join('{enter}');

async function startSession(user: User, list: string) {
  render(<App />);
  await user.type(screen.getByLabelText('Search or add players'), list);
  await user.keyboard('{Enter}');
  const count = list.split('{enter}').length;
  await user.click(await screen.findByRole('button', { name: `Start ${count} players` }));
}

describe('why a player is waiting', () => {
  it('shows the place in line and the reason for a waiting player, and nothing for one on court', async () => {
    const user = userEvent.setup();
    await startSession(user, names(5));
    const waitingRow = within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('button')[0];
    await user.click(waitingRow);
    expect(await screen.findByText(/^1st in line\. Waiting for 3 more players to start a game\.$/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(within(screen.getByRole('tabpanel', { name: 'Court 1' })).getAllByRole('button', { name: /^P/ })[0]);
    await screen.findByRole('dialog');
    expect(screen.queryByText(/in line\./)).not.toBeInTheDocument();
  });

  it('gives a fairness reason when a full game is waiting', async () => {
    const user = userEvent.setup();
    await startSession(user, names(12));
    await user.click(within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('button')[0]);
    expect(await screen.findByText(/^1st in line\. Tied with others, so the order is a fixed random pick\.$/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
npx vitest run src/engine/explain.test.ts src/ui/whyWaiting.test.tsx
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 4: Create `src/engine/explain.ts`**

```ts
import { orderedWaiting } from './pool';
import type { PlayerId, Session } from './types';

export interface WaitingExplanation {
  /** 1 for the player who plays next. */
  position: number;
  reason: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Why a waiting player is where they are in the line, in words an organizer can read out. Null when the player is not
 * waiting (on court, on a break, or gone). Fairness mode compares each player with the one directly ahead, using the
 * same three rules as `compareByPriority`: fewest games, then waiting longest, then the fixed random pick.
 */
export function explainWaiting(s: Session, playerId: PlayerId): WaitingExplanation | null {
  const waiting = orderedWaiting(s);
  const index = waiting.findIndex((p) => p.id === playerId);
  if (index < 0) return null;
  const position = index + 1;
  const me = waiting[index];

  if (waiting.length < 4) {
    return { position, reason: `Waiting for ${plural(4 - waiting.length, 'more player')} to start a game.` };
  }

  if (s.mode === 'queue') {
    return { position, reason: position === 1 ? 'Next in the order people arrived.' : 'In the order people arrived.' };
  }

  const others = waiting.filter((p) => p.id !== me.id);
  if (position === 1) {
    if (me.gamesPlayed < Math.min(...others.map((p) => p.gamesPlayed))) {
      return { position, reason: `Fewest games so far (${me.gamesPlayed}).` };
    }
    const sameGames = others.filter((p) => p.gamesPlayed === me.gamesPlayed);
    if (me.lastFinishedSeq < Math.min(...sameGames.map((p) => p.lastFinishedSeq))) {
      return { position, reason: `Waiting the longest among players with ${plural(me.gamesPlayed, 'game')}.` };
    }
    return { position, reason: 'Tied with others, so the order is a fixed random pick.' };
  }

  const ahead = waiting[index - 1];
  if (ahead.gamesPlayed < me.gamesPlayed) {
    return { position, reason: `Played ${plural(me.gamesPlayed, 'game')}. Players with fewer games go first.` };
  }
  if (ahead.lastFinishedSeq < me.lastFinishedSeq) {
    return { position, reason: 'Same games as the player ahead, who has waited longer.' };
  }
  return { position, reason: 'Tied with the player ahead, so the order is a fixed random pick.' };
}
```

- [ ] **Step 5: Apply this change to `src/engine/index.ts`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/engine/index.ts
+++ b/src/engine/index.ts
@@ -9,5 +9,7 @@
 export { previewNext } from './preview';
 export type { UpNext } from './preview';
 export { orderedWaiting, availablePlayers, onCourtIds } from './pool';
+export { explainWaiting } from './explain';
+export type { WaitingExplanation } from './explain';
 export { summarize, formatSummaryText, sessionStats, formatDuration, fairnessLine, gameLog } from './summary';
 export type { PlayerSummary, SessionStats, GameLogEntry } from './summary';
```

- [ ] **Step 6: Apply this change to `src/ui/PlayerSheet.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/PlayerSheet.tsx
+++ b/src/ui/PlayerSheet.tsx
@@ -6,6 +6,13 @@
 import { PhotoPanel } from './PhotoPanel';
 import { PlayerAvatar } from './PlayerAvatar';
 import { Sheet } from './Sheet';
+
+/** 1st, 2nd, 3rd, 4th, 11th, 21st. */
+function ordinal(n: number): string {
+  const teen = n % 100 >= 11 && n % 100 <= 13;
+  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
+  return `${n}${suffix}`;
+}
 
 interface Props {
   session: Session;
@@ -20,6 +27,7 @@
   const player = session.players.find((p) => p.id === playerId);
   const saved = useRosterStore((s) => s.players.find((p) => p.id === player?.rosterId));
   if (!player) return null;
+  const why = engine.explainWaiting(session, playerId);
 
   function setStatus(target: engine.StatusTarget) {
     const res = apply((s, ctx) => engine.setPlayerStatus(s, playerId, target, ctx));
@@ -50,6 +58,12 @@
           {player.status === 'break' && ' · on break'}
         </p>
       </div>
+
+      {why && (
+        <p className="why-waiting">
+          {ordinal(why.position)} in line. {why.reason}
+        </p>
+      )}
 
       {saved && (
         <button type="button" className="btn btn-block" onClick={() => setPhotoOpen(true)}>
```

- [ ] **Step 7: Add this to the end of `src/styles/app.css`**

```css

.why-waiting {
  margin: 0;
  font-weight: 600;
}

```

- [ ] **Step 8: Run the tests**

```bash
npx vitest run src/engine/explain.test.ts src/ui/whyWaiting.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/engine/explain.ts src/engine/explain.test.ts src/engine/index.ts src/ui/PlayerSheet.tsx src/styles/app.css src/ui/whyWaiting.test.tsx
git commit -m "Explain why a waiting player is where they are in line"
```

## Task 6: A notice when another window changes the session

If a second copy of the app saves the session, say so and offer a reload, instead of silently losing one copy.

**Files:**
- Create: `src/ui/useSessionConflict.ts`
- Modify: `src/ui/App.tsx`
- Test: `src/ui/sessionConflict.test.tsx`

- [ ] **Step 1: Create `src/ui/sessionConflict.test.tsx`**

```tsx
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import App from './App';

type User = ReturnType<typeof userEvent.setup>;

beforeEach(async () => {
  localStorage.clear();
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as unknown as Record<string, unknown>).vibrate;
  delete (navigator as unknown as Record<string, unknown>).wakeLock;
});

const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.fromCharCode(65 + i)}`).join('{enter}');

async function startSession(user: User, list: string) {
  render(<App />);
  await user.type(screen.getByLabelText('Search or add players'), list);
  await user.keyboard('{Enter}');
  const count = list.split('{enter}').length;
  await user.click(await screen.findByRole('button', { name: `Start ${count} players` }));
}

describe('a second window', () => {
  const change = (init: StorageEventInit) => act(() => void window.dispatchEvent(new StorageEvent('storage', init)));

  it('raises a notice when another window saves the session, and never by itself reloads', () => {
    render(<App />);
    expect(screen.queryByText(/changed in another window/)).not.toBeInTheDocument();
    change({ key: 'pickleball.session.v1', newValue: '{}' });
    expect(screen.getByText(/This session was changed in another window\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('also notices the other window clearing storage, but not unrelated keys', () => {
    const { unmount } = render(<App />);
    change({ key: 'pickleball.theme', newValue: 'dark' });
    expect(screen.queryByText(/changed in another window/)).not.toBeInTheDocument();
    unmount();
    render(<App />);
    change({ key: null });
    expect(screen.getByText(/changed in another window/)).toBeInTheDocument();
  });

  it('does not react to this window saving its own session', async () => {
    const user = userEvent.setup();
    await startSession(user, names(5));
    expect(screen.queryByText(/changed in another window/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/ui/sessionConflict.test.tsx
```

Expected: FAIL (the test files exist, but what they check does not yet).

- [ ] **Step 3: Create `src/ui/useSessionConflict.ts`**

```ts
import { useEffect, useState } from 'react';
import { STORAGE_KEY } from '../store/persistence';

/**
 * True once another tab or window has saved this app's session. The storage event only fires in the other windows,
 * never for this window's own saves, so a hit always means a second copy of the app is open.
 */
export function useSessionConflict(): boolean {
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) setChanged(true);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return changed;
}
```

- [ ] **Step 4: Apply this change to `src/ui/App.tsx`** (save as a patch and run `patch -p1 < file`, or edit by hand)

```diff
--- a/src/ui/App.tsx
+++ b/src/ui/App.tsx
@@ -13,6 +13,7 @@
 import { SetupScreen } from './SetupScreen';
 import { SummaryScreen } from './SummaryScreen';
 import { KEEP_AWAKE_KEY, useBoolPref } from './prefs';
+import { useSessionConflict } from './useSessionConflict';
 import { useWakeLock } from './useWakeLock';
 
 export default function App() {
@@ -25,6 +26,7 @@
   const loadRoster = useRosterStore((s) => s.load);
   const initAuth = useAuthStore((s) => s.init);
   const [keepAwake] = useBoolPref(KEEP_AWAKE_KEY, true);
+  const sessionConflict = useSessionConflict();
   const [view, setView] = useState<'setup' | 'saved' | 'settings'>('setup');
   // Saved players can be opened from Setup or from Settings; Back returns to whichever it came from.
   const [savedFrom, setSavedFrom] = useState<'setup' | 'settings'>('setup');
@@ -95,6 +97,14 @@
           Not saved — this browser is blocking storage. The session still works, but a refresh will lose it.
         </p>
       )}
+      {sessionConflict && (
+        <p className="notice" role="status">
+          This session was changed in another window.{' '}
+          <button type="button" className="btn btn-small" onClick={() => window.location.reload()}>
+            Reload
+          </button>
+        </p>
+      )}
       {rosterBlocked && (
         <p className="notice" role="status">
           Close other tabs of this app to load your saved players.
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/ui/sessionConflict.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Typecheck, run the whole suite, commit**

```bash
npx tsc --noEmit -p . && npm test
```

Expected: no type errors, all tests pass.

```bash
git add src/ui/useSessionConflict.ts src/ui/App.tsx src/ui/sessionConflict.test.tsx
git commit -m "Warn when another window changed the session"
```

## Task 7: Check it on a phone, then merge

- [ ] **Step 1: Build and look at it at phone width**

```bash
npm run build
```

Expected: clean build. Then in a browser at 360 by 780: start a session with a saved roster, tap Game finished and check the toast sits under the court card, shows the new lineup, and Undo restores the game. Check the plus button in the Waiting sheet handle opens Add player with the sheet still closed. Open a waiting player and read the place in line and the reason.

- [ ] **Step 2: Run the Ralph loop** on the finished change (tests, build, the checks above), and fix what it finds.

- [ ] **Step 3: Merge to production** after the owner says go: push `photos`, then fast-forward `claude/pickleball-matchmaking-app-i4baca` as in earlier phases.

- [ ] **Step 4: Check on the owner's phone** (this is what Phase 1 is for): the screen stays on for 10 minutes with no touches, the toast and Undo after a real game, the plus button, courts remembered after ending a session, a waiting player's reason, and the notice when the installed app and a browser tab are both open. Not verifiable without a phone: whether the buzz is felt (many iPhones do not allow it) and whether the wake lock holds under battery saver.

- [ ] **Step 5: Todoist.** Complete the Phase 1 plan task, and add a task for the phone check with the list above.

## Self-review

- **Spec coverage:** 1.1 Task 1 and 2 (wake lock, setting), 1.2 Task 3, 1.3 Task 4, 1.4 Task 2, 1.5 Task 5, 1.6 Task 6. The "Vibrate on finish" setting from 1.2 is in Task 2 (Settings) and read in Task 3.
- **Placeholders:** none. Every step has its code or diff.
- **Names:** `KEEP_AWAKE_KEY`, `VIBRATE_KEY`, `COURTS_KEY`, `getBoolPref`, `useBoolPref`, `getNumPref`, `setNumPref` (Task 1) are the names used in Tasks 2 and 3. `finishMessage`, `Toast`, `explainWaiting`, `useSessionConflict`, `useWakeLock` are defined once and used by the same names.
- **One change from the spec wording:** the toast sits in the page under the court card rather than floating, and the "why am I waiting" reasons compare each player with the one directly ahead. The spec was updated to match.
