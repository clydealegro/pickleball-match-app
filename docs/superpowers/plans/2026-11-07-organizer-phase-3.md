# Organizer Phase 3 (Remember) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app remembers finished sessions on the phone: a Past sessions list, attendance on Saved players, regulars first on New session, and a weekday regulars shortcut.

**Architecture:** History lives in its own IndexedDB database (`pickleball-history`), so the roster database, its sync and its photos are not touched. The whole finished `Session` is stored, so a past session opens in the existing summary screen. Attendance and the weekday suggestion are pure functions over the stored sessions. Everything is local; syncing history is Phase 5.

**Tech Stack:** React, TypeScript, Vite, Zustand, idb, Vitest with fake-indexeddb. Spec: `docs/superpowers/specs/2026-11-07-organizer-experience-phases.md`, section Phase 3.

**Working copy:** run this in the worktree `pickleball-match-app-phase3` on branch `phase3`. The main checkout has another session's uncommitted skill-ratings edits; never touch them, never use `git add -A`, stage files by name.

**Verified before writing:** the code below was built and tested in a scratch copy of this worktree: 835 tests pass across 85 files, `tsc` is clean, and a mutation check on the history database, the saving, the warning, the ordering, the weekday chip (including its four-player minimum), the attendance line and the delete-all clearing each made a test fail. The screens were checked in a browser at 360 px wide.

---

## File structure

| File | Job |
|---|---|
| `src/store/historyDb.ts` (new) | The `pickleball-history` database: save a finished session, list, clear, cap at 100, memory fallback |
| `src/store/attendance.ts` (new) | Pure helpers: attendance per saved player, weekday regulars, the short date, the attendance line, the ordering |
| `src/store/historyStore.ts` (new) | Zustand store over the database. Never throws |
| `src/ui/SummaryScreen.tsx` | Saves the session when it opens, can be read-only (`onBack`), warns only when the session is not kept |
| `src/ui/PastSessionsScreen.tsx` (new) | The list, and the read-only summary |
| `src/ui/App.tsx`, `SettingsScreen.tsx`, `prefs.ts`, `styles/app.css` | The `history` view, the Past sessions button, the Show regulars first switch |
| `src/ui/SavedPlayersScreen.tsx` | The attendance line under each name |
| `src/ui/SetupScreen.tsx` | Regulars first ordering and the weekday chip |
| `src/sync/dataActions.ts` | Delete all my data also clears history |
| `src/test/historyFixtures.ts` (new) | Test helpers: seed saved players, build a finished past session |

---
### Task 1: The history database

**Files:**
- Create: `src/store/historyDb.ts`
- Test: `src/store/historyDb.test.ts`

- [ ] **Step 1: Write the tests**

**Create `src/store/historyDb.test.ts`**

````ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession, endSession, type Ctx, type Session } from '../engine';
import {
  HISTORY_LIMIT,
  clearHistory,
  isHistoryPersistent,
  listHistory,
  resetHistoryDbForTests,
  saveSessionToHistory,
} from './historyDb';

let n = 0;
const ctx = (now: number): Ctx => ({ now, newId: () => `id${++n}`, rng: () => 0.5 });

function finished(endedAt: number, name = 'Night'): Session {
  const s = createSession({ name, mode: 'fairness', courtCount: 1, players: [] }, ctx(endedAt - 1000));
  return endSession(s, ctx(endedAt));
}

beforeEach(async () => {
  await resetHistoryDbForTests();
});

describe('history db', () => {
  it('keeps a finished session and lists it back whole', async () => {
    const s = finished(5000);
    expect(await saveSessionToHistory(s)).toBe(true);
    const [entry] = await listHistory();
    expect(entry).toMatchObject({ id: s.id, name: 'Night', endedAt: 5000, games: 0 });
    expect(entry.session).toEqual(s);
  });

  it('lists newest first', async () => {
    await saveSessionToHistory(finished(1000, 'old'));
    await saveSessionToHistory(finished(3000, 'new'));
    await saveSessionToHistory(finished(2000, 'mid'));
    expect((await listHistory()).map((e) => e.name)).toEqual(['new', 'mid', 'old']);
  });

  it('saving the same session twice keeps one copy', async () => {
    const s = finished(1000);
    await saveSessionToHistory(s);
    await saveSessionToHistory(s);
    expect(await listHistory()).toHaveLength(1);
  });

  it('refuses a session that has not ended', async () => {
    const live = createSession({ name: 'x', mode: 'fairness', courtCount: 1, players: [] }, ctx(1));
    await expect(saveSessionToHistory(live)).rejects.toThrow(/finished/i);
    expect(await listHistory()).toHaveLength(0);
  });

  it('drops the oldest sessions past the limit', async () => {
    for (let i = 1; i <= HISTORY_LIMIT + 3; i++) await saveSessionToHistory(finished(i * 1000, `s${i}`));
    const list = await listHistory();
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list[0].name).toBe(`s${HISTORY_LIMIT + 3}`);
    expect(list.at(-1)!.name).toBe('s4');
  });

  it('keeps every session when saves overlap', async () => {
    await Promise.all([1, 2, 3, 4, 5].map((i) => saveSessionToHistory(finished(i * 1000, `s${i}`))));
    expect(await listHistory()).toHaveLength(5);
  });

  it('clears everything', async () => {
    await saveSessionToHistory(finished(1000));
    await clearHistory();
    expect(await listHistory()).toEqual([]);
  });

  it('is persistent while IndexedDB works', async () => {
    await saveSessionToHistory(finished(1000));
    expect(isHistoryPersistent()).toBe(true);
  });
});

describe('history db without storage', () => {
  it('falls back to memory, still lists, and says it was not kept', async () => {
    vi.resetModules();
    vi.doMock('idb', async (orig) => ({ ...(await orig<typeof import('idb')>()), openDB: vi.fn().mockRejectedValue(new Error('blocked')) }));
    const fresh = await import('./historyDb');
    const { createSession: cs, endSession: es } = await import('../engine');
    const s = es(cs({ name: 'Mem', mode: 'fairness', courtCount: 1, players: [] }, ctx(1)), ctx(2));
    expect(await fresh.saveSessionToHistory(s)).toBe(false);
    expect((await fresh.listHistory()).map((e) => e.name)).toEqual(['Mem']);
    expect(fresh.isHistoryPersistent()).toBe(false);
    vi.doUnmock('idb');
    vi.resetModules();
  });
});
````

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/store/historyDb.test.ts`
Expected: FAIL, the module `./historyDb` does not exist.

- [ ] **Step 3: Write the code**

**Create `src/store/historyDb.ts`**

````ts
import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Session } from '../engine';

/** How many finished sessions are kept. Older ones are dropped when a new one is saved. */
export const HISTORY_LIMIT = 100;

/** A finished session as kept for the Past sessions list. The whole session is kept, because the summary screen reads it. */
export interface HistoryEntry {
  id: string;
  name: string;
  createdAt: number;
  endedAt: number;
  /** How many games were finished, so the list does not need to open the session. */
  games: number;
  session: Session;
}

interface HistorySchema extends DBSchema {
  sessions: { key: string; value: HistoryEntry };
}

// A database of its own, so history can never get in the way of the saved players: their upgrade, their sync and
// their clear-this-device all stay exactly as they were.
const DB_NAME = 'pickleball-history';
const DB_VERSION = 1;

interface Backend {
  put(entry: HistoryEntry): Promise<void>;
  all(): Promise<unknown[]>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  close?(): void;
}

function idbBackend(database: IDBPDatabase<HistorySchema>): Backend {
  return {
    put: async (entry) => void (await database.put('sessions', entry)),
    all: () => database.getAll('sessions'),
    delete: (id) => database.delete('sessions', id),
    clear: () => database.clear('sessions'),
    close: () => database.close(),
  };
}

function memoryBackend(): Backend {
  const map = new Map<string, HistoryEntry>();
  return {
    put: async (entry) => void map.set(entry.id, entry),
    all: async () => [...map.values()],
    delete: async (id) => void map.delete(id),
    clear: async () => map.clear(),
  };
}

let backendPromise: Promise<Backend> | null = null;
let persistent = true;
let queue: Promise<unknown> = Promise.resolve();

async function openBackend(): Promise<Backend> {
  try {
    const database = await openDB<HistorySchema>(DB_NAME, DB_VERSION, {
      upgrade(d) {
        d.createObjectStore('sessions', { keyPath: 'id' });
      },
      // The browser closed the connection (for example iOS Safari when backgrounded): reopen on next use.
      terminated() {
        backendPromise = null;
      },
      blocking() {
        backendPromise = null;
      },
    });
    return idbBackend(database);
  } catch {
    // Private mode or blocked storage: history still works for this visit, but nothing is kept.
    persistent = false;
    return memoryBackend();
  }
}

function backend(): Promise<Backend> {
  backendPromise ??= openBackend();
  return backendPromise;
}

/** Runs one change at a time, so two saves can never trim each other's sessions. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** False once opening IndexedDB has failed: history then only lives in memory. */
export function isHistoryPersistent(): boolean {
  return persistent;
}

/** Test helper: closes and deletes the database, and clears the fallback state. */
export async function resetHistoryDbForTests(): Promise<void> {
  await queue.catch(() => undefined);
  if (backendPromise) (await backendPromise).close?.();
  backendPromise = null;
  persistent = true;
  queue = Promise.resolve();
  await deleteDB(DB_NAME);
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Anything stored that is not shaped like an entry (a bad write, a future format) is left out of the list. */
function isEntry(x: unknown): x is HistoryEntry {
  if (typeof x !== 'object' || x === null) return false;
  const e = x as Record<string, unknown>;
  const s = e.session as Record<string, unknown> | undefined;
  return (
    typeof e.id === 'string' &&
    typeof e.name === 'string' &&
    isNum(e.createdAt) &&
    isNum(e.endedAt) &&
    isNum(e.games) &&
    typeof s === 'object' &&
    s !== null &&
    Array.isArray(s.players) &&
    Array.isArray(s.history)
  );
}

/** The kept sessions, newest first. */
export async function listHistory(): Promise<HistoryEntry[]> {
  const rows = await serial(async () => (await backend()).all());
  return rows.filter(isEntry).sort((a, b) => b.endedAt - a.endedAt);
}

/**
 * Keeps a finished session. Returns true when it was written to storage that survives a restart, and false when it is
 * only in memory or the write failed. A session that has not ended is refused. The oldest sessions beyond the limit are
 * dropped.
 */
export function saveSessionToHistory(session: Session): Promise<boolean> {
  if (session.endedAt === undefined) return Promise.reject(new Error('Only a finished session can be kept.'));
  const entry: HistoryEntry = {
    id: session.id,
    name: session.name,
    createdAt: session.createdAt,
    endedAt: session.endedAt,
    games: session.history.length,
    session,
  };
  return serial(async () => {
    try {
      const b = await backend();
      await b.put(entry);
      const entries = (await b.all()).filter(isEntry).sort((a, c) => c.endedAt - a.endedAt);
      for (const old of entries.slice(HISTORY_LIMIT)) await b.delete(old.id);
      return persistent;
    } catch {
      return false;
    }
  });
}

/** Forgets every kept session. */
export function clearHistory(): Promise<void> {
  return serial(async () => (await backend()).clear());
}
````

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/store/historyDb.test.ts` and `npx tsc --noEmit -p .`
Expected: 9 tests pass, `tsc` is clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/historyDb.ts src/store/historyDb.test.ts
git commit -m "Keep finished sessions in a database of their own"
```

### Task 2: Attendance helpers and the history store

**Files:**
- Create: `src/store/attendance.ts`, `src/store/historyStore.ts`
- Test: `src/store/attendance.test.ts`, `src/store/historyStore.test.ts`

- [ ] **Step 1: Write the tests**

**Create `src/store/attendance.test.ts`**

````ts
import { describe, expect, it } from 'vitest';
import type { Session } from '../engine';
import { attendanceByRoster, attendanceLine, regularsForWeekday, sortByAttendance } from './attendance';
import type { HistoryEntry } from './historyDb';

const at = (y: number, m: number, d: number) => new Date(y, m, d, 18).getTime();
function entry(id: string, created: number, ids: (string | undefined)[], ended = created + 3_600_000): HistoryEntry {
  const session = {
    id,
    name: id,
    createdAt: created,
    endedAt: ended,
    history: [],
    players: ids.map((r, i) => ({ id: `p${i}`, name: `P${i}`, rosterId: r })),
  } as unknown as Session;
  return { id, name: id, createdAt: created, endedAt: ended, games: 0, session };
}

// 4 Nov 2026 is a Wednesday; 11 Nov is the next one; 5 Nov is a Thursday.
const wed1 = at(2026, 10, 4);
const wed2 = at(2026, 10, 11);
const thu = at(2026, 10, 5);

describe('attendanceByRoster', () => {
  it('counts a player once per session and tracks the latest end', () => {
    const m = attendanceByRoster([entry('a', wed1, ['x', 'x', 'y']), entry('b', wed2, ['x', undefined])]);
    expect(m.get('x')).toEqual({ sessions: 2, lastAt: wed2 + 3_600_000 });
    expect(m.get('y')?.sessions).toBe(1);
    expect(m.size).toBe(2);
  });
  it('is empty with no history', () => expect(attendanceByRoster([]).size).toBe(0));
});

describe('regularsForWeekday', () => {
  const list = [entry('a', wed1, ['x', 'y']), entry('b', wed2, ['x', 'z']), entry('c', thu, ['y', 'y'])];
  it('needs the minimum on that weekday', () => {
    expect(regularsForWeekday(list, 3)).toEqual(['x']);
  });
  it('ignores other weekdays', () => {
    expect(regularsForWeekday(list, 4)).toEqual([]);
    expect(regularsForWeekday(list, 4, 1)).toEqual(['y']);
  });
  it('orders by how often, then id', () => {
    const more = [...list, entry('d', at(2026, 10, 18), ['z', 'x'])];
    expect(regularsForWeekday(more, 3)).toEqual(['x', 'z']);
  });
});

describe('attendanceLine', () => {
  it('says none yet', () => expect(attendanceLine(undefined)).toBe('No sessions yet'));
  it('uses the singular and a short date', () => {
    expect(attendanceLine({ sessions: 1, lastAt: wed1 })).toBe('1 session, last Wed 4 Nov');
    expect(attendanceLine({ sessions: 3, lastAt: wed1 })).toMatch(/^3 sessions, last /);
  });
});

describe('sortByAttendance', () => {
  const players = [
    { id: 'a', name: 'Ann' },
    { id: 'b', name: 'Ben' },
    { id: 'c', name: 'Cy' },
    { id: 'd', name: 'Di' },
  ];
  it('puts frequent first, newer next, then name, and strangers last in given order', () => {
    const att = new Map([
      ['a', { sessions: 1, lastAt: 5 }],
      ['b', { sessions: 3, lastAt: 1 }],
      ['c', { sessions: 1, lastAt: 9 }],
    ]);
    expect(sortByAttendance(players, att).map((p) => p.id)).toEqual(['b', 'c', 'a', 'd']);
  });
  it('does not change the input', () => {
    const copy = [...players];
    sortByAttendance(players, new Map());
    expect(players).toEqual(copy);
  });
});
````

**Create `src/store/historyStore.test.ts`**

````ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createSession, endSession, type Ctx } from '../engine';
import { resetHistoryDbForTests } from './historyDb';
import { useHistoryStore } from './historyStore';

let n = 0;
const ctx = (now: number): Ctx => ({ now, rng: () => 0.5, newId: () => `h${++n}` });
const ended = (at: number) => endSession(createSession({ name: 'N', mode: 'fairness', courtCount: 1, players: [] }, ctx(at - 1)), ctx(at));

beforeEach(async () => {
  await resetHistoryDbForTests();
  useHistoryStore.setState({ entries: [], loaded: false, persistent: true });
});

describe('history store', () => {
  it('loads, saves and clears', async () => {
    await useHistoryStore.getState().load();
    expect(useHistoryStore.getState()).toMatchObject({ loaded: true, entries: [] });
    await useHistoryStore.getState().save(ended(1000));
    expect(useHistoryStore.getState().entries).toHaveLength(1);
    await useHistoryStore.getState().clear();
    expect(useHistoryStore.getState().entries).toHaveLength(0);
  });

  it('does not throw for a session that has not ended', async () => {
    const live = createSession({ name: 'N', mode: 'fairness', courtCount: 1, players: [] }, ctx(1));
    await expect(useHistoryStore.getState().save(live)).resolves.toBeUndefined();
    expect(useHistoryStore.getState().entries).toHaveLength(0);
  });
});
````

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/store/attendance.test.ts src/store/historyStore.test.ts`
Expected: FAIL, the modules do not exist.

- [ ] **Step 3: Write the code**

**Create `src/store/attendance.ts`**

````ts
import type { HistoryEntry } from './historyDb';

export interface Attendance {
  /** Finished sessions this saved player was in. */
  sessions: number;
  /** When the latest of those sessions ended. */
  lastAt: number;
}

/** Who turned up, by saved-player id. A player counts once per session, however many games they played. */
export function attendanceByRoster(entries: HistoryEntry[]): Map<string, Attendance> {
  const out = new Map<string, Attendance>();
  for (const e of entries) {
    const seen = new Set<string>();
    for (const p of e.session.players) {
      if (!p.rosterId || seen.has(p.rosterId)) continue;
      seen.add(p.rosterId);
      const a = out.get(p.rosterId);
      out.set(p.rosterId, { sessions: (a?.sessions ?? 0) + 1, lastAt: Math.max(a?.lastAt ?? 0, e.endedAt) });
    }
  }
  return out;
}

/**
 * Saved players who came to at least `min` sessions that started on this weekday (0 is Sunday), most frequent first.
 * This is what "your Tuesday regulars" is made from.
 */
export function regularsForWeekday(entries: HistoryEntry[], weekday: number, min = 2): string[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (new Date(e.createdAt).getDay() !== weekday) continue;
    const seen = new Set<string>();
    for (const p of e.session.players) {
      if (!p.rosterId || seen.has(p.rosterId)) continue;
      seen.add(p.rosterId);
      counts.set(p.rosterId, (counts.get(p.rosterId) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Tue 4 Nov": the same short date everywhere history is shown. */
export function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "5 sessions, last Tue 4 Nov", or "No sessions yet". */
export function attendanceLine(a: Attendance | undefined): string {
  if (!a) return 'No sessions yet';
  const when = shortDate(a.lastAt);
  return `${a.sessions} ${a.sessions === 1 ? 'session' : 'sessions'}, last ${when}`;
}

/** Most sessions first, then most recent, then name. Players with no sessions go last, in the order given. */
export function sortByAttendance<T extends { id: string; name: string }>(players: T[], att: Map<string, Attendance>): T[] {
  return [...players].sort((a, b) => {
    const x = att.get(a.id);
    const y = att.get(b.id);
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return y.sessions - x.sessions || y.lastAt - x.lastAt || a.name.localeCompare(b.name);
  });
}
````

**Create `src/store/historyStore.ts`**

````ts
import { create } from 'zustand';
import type { Session } from '../engine';
import { clearHistory, isHistoryPersistent, listHistory, saveSessionToHistory, type HistoryEntry } from './historyDb';

interface HistoryState {
  entries: HistoryEntry[];
  loaded: boolean;
  /** False when history only lives in memory (IndexedDB unavailable). */
  persistent: boolean;
  load: () => Promise<void>;
  /** Keeps a finished session. Never throws: history must not get in the way of ending a session. */
  save: (session: Session) => Promise<void>;
  clear: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>()((set) => {
  const refresh = async () => {
    try {
      set({ entries: await listHistory(), loaded: true, persistent: isHistoryPersistent() });
    } catch {
      set({ loaded: true, persistent: false });
    }
  };
  return {
    entries: [],
    loaded: false,
    persistent: true,
    load: refresh,
    async save(session) {
      try {
        await saveSessionToHistory(session);
      } catch {
        // A session that cannot be kept is simply not in the list.
      }
      await refresh();
    },
    async clear() {
      try {
        await clearHistory();
      } catch {
        // Nothing to forget if storage is unavailable.
      }
      await refresh();
    },
  };
});
````

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/store/attendance.test.ts src/store/historyStore.test.ts` and `npx tsc --noEmit -p .`
Expected: All pass, `tsc` is clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/attendance.ts src/store/attendance.test.ts src/store/historyStore.ts src/store/historyStore.test.ts
git commit -m "Add attendance helpers and the history store"
```

### Task 3: Save a session when its summary opens, and a read-only summary

**Files:**
- Modify: `src/ui/SummaryScreen.tsx`
- Test: `src/ui/summaryScreen.test.tsx`

- [ ] **Step 1: Write the tests**

**Modify `src/ui/summaryScreen.test.tsx`**

````diff
--- a/src/ui/summaryScreen.test.tsx
+++ b/src/ui/summaryScreen.test.tsx
@@ -3,6 +3,8 @@
 import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
 import { finishGame } from '../engine/game';
 import { makeCtx, newTestSession } from '../engine/testing';
+import { resetHistoryDbForTests } from '../store/historyDb';
+import { useHistoryStore } from '../store/historyStore';
 import { resetRosterDbForTests } from '../store/rosterDb';
 import { useSessionStore } from '../store/sessionStore';
 import { SummaryScreen } from './SummaryScreen';
@@ -10,6 +12,8 @@
 beforeEach(async () => {
   localStorage.clear();
   await resetRosterDbForTests();
+  await resetHistoryDbForTests();
+  useHistoryStore.setState({ ...useHistoryStore.getInitialState(), entries: [], loaded: false });
 });
 afterEach(() => {
   vi.restoreAllMocks();
@@ -89,6 +93,8 @@
     const user = userEvent.setup();
     const reset = vi.fn();
     useSessionStore.setState({ reset });
+    // History could not keep it, so the summary is the only copy.
+    useHistoryStore.setState({ save: vi.fn().mockResolvedValue(undefined) });
     const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
     const share = vi.fn().mockResolvedValue(undefined);
     vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share }));
@@ -102,6 +108,28 @@
     expect(reset).toHaveBeenCalledOnce();
   });
 
+  it('does not ask once the session is kept in Past sessions', async () => {
+    const user = userEvent.setup();
+    const reset = vi.fn();
+    useSessionStore.setState({ reset });
+    const confirm = vi.spyOn(window, 'confirm');
+    render(<SummaryScreen session={finished()} />);
+    await vi.waitFor(() => expect(useHistoryStore.getState().entries).toHaveLength(1));
+    await user.click(screen.getByRole('button', { name: 'Start new session' }));
+    expect(confirm).not.toHaveBeenCalled();
+    expect(reset).toHaveBeenCalledOnce();
+  });
+
+  it('shows a past session read-only: no save, no Start new, a Back button', async () => {
+    const user = userEvent.setup();
+    const back = vi.fn();
+    render(<SummaryScreen session={finished()} onBack={back} />);
+    expect(screen.queryByRole('button', { name: 'Start new session' })).not.toBeInTheDocument();
+    await user.click(screen.getByRole('button', { name: 'Back' }));
+    expect(back).toHaveBeenCalledOnce();
+    expect(useHistoryStore.getState().entries).toHaveLength(0);
+  });
+
   it('does not ask when no game was played', async () => {
     const user = userEvent.setup();
     const reset = vi.fn();
````

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/summaryScreen.test.tsx`
Expected: FAIL on "does not ask once the session is kept in Past sessions" and "shows a past session read-only".

- [ ] **Step 3: Write the code**

**Modify `src/ui/SummaryScreen.tsx`**

````diff
--- a/src/ui/SummaryScreen.tsx
+++ b/src/ui/SummaryScreen.tsx
@@ -1,6 +1,7 @@
-import { useState } from 'react';
+import { useEffect, useState } from 'react';
 import * as engine from '../engine';
 import type { PlayerSummary, Session } from '../engine';
+import { useHistoryStore } from '../store/historyStore';
 import { useSessionStore } from '../store/sessionStore';
 import { PlayerAvatar } from './PlayerAvatar';
 
@@ -63,8 +64,12 @@
   );
 }
 
-export function SummaryScreen({ session }: { session: Session }) {
+/** `onBack` makes it a read-only look at a past session: nothing is saved again and there is no Start new. */
+export function SummaryScreen({ session, onBack }: { session: Session; onBack?: () => void }) {
   const reset = useSessionStore((s) => s.reset);
+  const saveToHistory = useHistoryStore((s) => s.save);
+  const kept = useHistoryStore((s) => s.entries.some((e) => e.id === session.id));
+  const readOnly = onBack !== undefined;
   const [message, setMessage] = useState('');
   const [shared, setShared] = useState(false);
   // Win records can sting in a friendly group, so they only go into the shared text when switched on, each time.
@@ -74,6 +79,10 @@
   const log = engine.gameLog(session);
   const fairness = engine.fairnessLine(stats);
   const anyResults = engine.hasResults(session);
+  // A session that has ended is kept for the Past sessions list. Saving twice just replaces the same entry.
+  useEffect(() => {
+    if (!readOnly) void saveToHistory(session);
+  }, [readOnly, saveToHistory, session]);
   const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
 
   async function share() {
@@ -101,15 +110,23 @@
   }
 
   function startNew() {
-    if (!shared && stats.games > 0 && !window.confirm('Start a new session? This summary will be cleared, and you have not shared it yet.')) return;
+    // Once it is in Past sessions, starting a new one loses nothing, so there is nothing to warn about.
+    if (!kept && !shared && stats.games > 0 && !window.confirm('Start a new session? This summary will be cleared, and you have not shared it yet.')) return;
     reset();
   }
 
   return (
     <div className="stack">
-      <div>
-        <h1 className="screen-title">Session summary</h1>
-        <p className="muted">{session.name}</p>
+      <div className="row-flex spread">
+        <div>
+          <h1 className="screen-title">Session summary</h1>
+          <p className="muted">{session.name}</p>
+        </div>
+        {readOnly && (
+          <button type="button" className="btn" onClick={onBack}>
+            Back
+          </button>
+        )}
       </div>
 
       <dl className="sum-stats">
@@ -178,9 +195,11 @@
         <button type="button" className="btn btn-primary btn-block" onClick={() => void share()}>
           {canShare ? 'Share results' : 'Copy results'}
         </button>
-        <button type="button" className="btn btn-ghost btn-block" onClick={startNew}>
-          Start new session
-        </button>
+        {!readOnly && (
+          <button type="button" className="btn btn-ghost btn-block" onClick={startNew}>
+            Start new session
+          </button>
+        )}
       </div>
     </div>
   );
````

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/ui/summaryScreen.test.tsx` and `npx tsc --noEmit -p .`
Expected: All 15 tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/SummaryScreen.tsx src/ui/summaryScreen.test.tsx
git commit -m "Save a session when its summary opens and allow a read-only summary"
```

### Task 4: The Past sessions screen, and its way in from Settings

**Files:**
- Create: `src/ui/PastSessionsScreen.tsx`, `src/test/historyFixtures.ts`
- Modify: `src/ui/App.tsx`, `src/ui/SettingsScreen.tsx`, `src/ui/prefs.ts`, `src/styles/app.css`
- Test: `src/ui/pastSessions.test.tsx`

- [ ] **Step 1: Write the tests**

**Create `src/test/historyFixtures.ts`**

````ts
import { finishGame } from '../engine/game';
import { makeCtx, newTestSession } from '../engine/testing';
import { saveSessionToHistory } from '../store/historyDb';
import { addRosterPlayer } from '../store/rosterDb';

/** A finished session of saved players, on the day given (month is 0-based). */
export async function pastSession(names: string[], roster: Map<string, string>, y: number, m: number, d: number, name = 'Open play') {
  const ctx = makeCtx(1, new Date(y, m, d, 18).getTime());
  let s = newTestSession(names, { courts: 1 }, ctx);
  s = { ...s, id: `past-${y}-${m}-${d}-${name}`, name, players: s.players.map((p) => ({ ...p, rosterId: roster.get(p.name) })) };
  s = finishGame(s, s.courts[0].id, { ...ctx, now: ctx.now + 600_000 });
  s = { ...s, endedAt: ctx.now + 900_000 };
  await saveSessionToHistory(s);
  return s;
}

/** Saves players to the roster and returns their ids by name. */
export async function seed(names: string[]) {
  const ids = new Map<string, string>();
  for (const n of names) ids.set(n, (await addRosterPlayer(n)).id);
  return ids;
}
````

**Create `src/ui/pastSessions.test.tsx`**

````tsx
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCtx, newTestSession } from '../engine/testing';
import { resetHistoryDbForTests } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { pastSession, seed } from '../test/historyFixtures';
import App from './App';
import { setDefaultMode } from './matchmaking';

beforeEach(async () => {
  localStorage.clear();
  setDefaultMode('fairness');
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  await resetRosterDbForTests();
  await resetHistoryDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
  useHistoryStore.setState({ entries: [], loaded: false, persistent: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const openSettings = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Settings' }));

describe('Past sessions', () => {
  it('is empty at first', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSettings(user);
    await user.click(screen.getByRole('button', { name: 'Past sessions' }));
    expect(await screen.findByText(/Nothing here yet/)).toBeInTheDocument();
  });

  it('lists sessions newest first, opens one read-only, and comes back', async () => {
    const names = ['Ann', 'Ben', 'Cy', 'Dee', 'Eve'];
    const ids = await seed(names);
    await pastSession(names, ids, 2026, 9, 1, 'Older night');
    await pastSession(names, ids, 2026, 10, 4, 'Newer night');
    const user = userEvent.setup();
    render(<App />);
    await openSettings(user);
    await user.click(screen.getByRole('button', { name: 'Past sessions' }));
    const rows = within(await screen.findByRole('list', { name: 'Past sessions' })).getAllByRole('button');
    expect(rows.map((r) => r.querySelector('.row-name')?.textContent)).toEqual(['Newer night', 'Older night']);
    expect(rows[0]).toHaveTextContent('Wed 4 Nov · 1 game · 5 players');
    await user.click(rows[0]);
    expect(screen.getByRole('heading', { name: 'Session summary' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start new session' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Past sessions' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });
});

describe('ending a session keeps it', () => {
  it('shows an ended session in Past sessions after Start new', async () => {
    const names = ['Ann', 'Ben', 'Cy', 'Dee'];
    const ids = await seed(names);
    const ctx = makeCtx(1, 1_000_000);
    const live = newTestSession(names, { courts: 1 }, ctx);
    useSessionStore.setState({
      session: { ...live, players: live.players.map((p) => ({ ...p, rosterId: ids.get(p.name) })), endedAt: ctx.now + 5 },
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(useHistoryStore.getState().entries).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Start new session' }));
    await openSettings(user);
    await user.click(screen.getByRole('button', { name: 'Past sessions' }));
    expect(await screen.findByRole('list', { name: 'Past sessions' })).toBeInTheDocument();
  });
});
````

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/pastSessions.test.tsx`
Expected: FAIL, there is no Past sessions button.

- [ ] **Step 3: Write the code**

**Create `src/ui/PastSessionsScreen.tsx`**

````tsx
import { useState } from 'react';
import type { Session } from '../engine';
import { shortDate } from '../store/attendance';
import { useHistoryStore } from '../store/historyStore';
import { SummaryScreen } from './SummaryScreen';

export function PastSessionsScreen({ onBack }: { onBack: () => void }) {
  const entries = useHistoryStore((s) => s.entries);
  const loaded = useHistoryStore((s) => s.loaded);
  const persistent = useHistoryStore((s) => s.persistent);
  const [open, setOpen] = useState<Session | null>(null);

  if (open) return <SummaryScreen session={open} onBack={() => setOpen(null)} />;

  return (
    <div className="stack">
      <div className="row-flex spread">
        <h1 className="screen-title">Past sessions</h1>
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
      </div>
      {!persistent && <p className="muted">This browser cannot keep history, so these are forgotten when the app closes.</p>}
      {loaded && entries.length === 0 ? (
        <p className="muted">Nothing here yet. A session shows up here once you end it.</p>
      ) : (
        <ul className="list card" aria-label="Past sessions">
          {entries.map((e) => (
            <li key={e.id}>
              <button type="button" className="past-row" onClick={() => setOpen(e.session)}>
                <span className="row-name">{e.name}</span>
                <span className="muted">
                  {shortDate(e.endedAt)} · {e.games} {e.games === 1 ? 'game' : 'games'} · {e.session.players.length} players
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
````

**Modify `src/ui/prefs.ts`**

````diff
--- a/src/ui/prefs.ts
+++ b/src/ui/prefs.ts
@@ -6,6 +6,7 @@
 export const COURTS_KEY = 'pickleball.courts';
 export const AUTO_START_KEY = 'pickleball.autoStart';
 export const PLAY_TO_KEY = 'pickleball.playTo';
+export const REGULARS_FIRST_KEY = 'pickleball.regularsFirst';
 
 /** The scores a game can be played to. */
 export const PLAY_TO_CHOICES = [11, 15, 21] as const;
````

**Modify `src/ui/App.tsx`**

````diff
--- a/src/ui/App.tsx
+++ b/src/ui/App.tsx
@@ -3,11 +3,13 @@
 import { useAuthStore } from '../sync/auth';
 import { startSyncCoordinator } from '../sync/coordinator';
 import { useUpdateStore } from '../pwa';
+import { useHistoryStore } from '../store/historyStore';
 import { useSessionStore } from '../store/sessionStore';
 import { AccountButton } from './AccountButton';
 import { ErrorBoundary } from './ErrorBoundary';
 import { SignInBanner } from './SignInBanner';
 import { LiveScreen } from './LiveScreen';
+import { PastSessionsScreen } from './PastSessionsScreen';
 import { SavedPlayersScreen } from './SavedPlayersScreen';
 import { SettingsScreen } from './SettingsScreen';
 import { SetupScreen } from './SetupScreen';
@@ -24,10 +26,11 @@
   const rosterPersistent = useRosterStore((s) => s.persistent);
   const rosterBlocked = useRosterStore((s) => s.blocked);
   const loadRoster = useRosterStore((s) => s.load);
+  const loadHistory = useHistoryStore((s) => s.load);
   const initAuth = useAuthStore((s) => s.init);
   const [keepAwake] = useBoolPref(KEEP_AWAKE_KEY, true);
   const sessionConflict = useSessionConflict();
-  const [view, setView] = useState<'setup' | 'saved' | 'settings'>('setup');
+  const [view, setView] = useState<'setup' | 'saved' | 'settings' | 'history'>('setup');
   // Saved players can be opened from Setup or from Settings; Back returns to whichever it came from.
   const [savedFrom, setSavedFrom] = useState<'setup' | 'settings'>('setup');
   const openSaved = (from: 'setup' | 'settings') => {
@@ -41,6 +44,10 @@
   }, [loadRoster]);
 
   useEffect(() => {
+    void loadHistory();
+  }, [loadHistory]);
+
+  useEffect(() => {
     void initAuth();
   }, [initAuth]);
 
@@ -60,11 +67,14 @@
           <SetupScreen onManage={() => openSaved('setup')} />
         </div>
         {view === 'saved' && <SavedPlayersScreen onBack={() => setView(savedFrom)} />}
-        {view === 'settings' && <SettingsScreen onBack={() => setView('setup')} onManage={() => openSaved('settings')} />}
+        {view === 'settings' && <SettingsScreen onBack={() => setView('setup')} onManage={() => openSaved('settings')} onHistory={() => setView('history')} />}
+        {view === 'history' && <PastSessionsScreen onBack={() => setView('settings')} />}
       </>
     );
   } else if (view === 'settings') {
-    screen = <SettingsScreen onBack={() => setView('setup')} onManage={() => openSaved('settings')} />;
+    screen = <SettingsScreen onBack={() => setView('setup')} onManage={() => openSaved('settings')} onHistory={() => setView('history')} />;
+  } else if (view === 'history') {
+    screen = <PastSessionsScreen onBack={() => setView('settings')} />;
   } else if (view === 'saved') {
     screen = <SavedPlayersScreen onBack={() => setView(savedFrom)} />;
   } else if (session.endedAt) {
@@ -81,7 +91,7 @@
       {!live && (
         <header className="app-header">
           <span className="app-title">PIKLMatch</span>
-          {view !== 'settings' && <AccountButton onClick={() => setView('settings')} />}
+          {view !== 'settings' && view !== 'history' && <AccountButton onClick={() => setView('settings')} />}
         </header>
       )}
       {updateReady && (
````

**Modify `src/ui/SettingsScreen.tsx`**

````diff
--- a/src/ui/SettingsScreen.tsx
+++ b/src/ui/SettingsScreen.tsx
@@ -4,15 +4,17 @@
 import { useSyncStore } from '../sync/syncStore';
 import { SyncStatusLine } from './SyncStatusLine';
 import { useDefaultMode } from './matchmaking';
-import { AUTO_START_KEY, KEEP_AWAKE_KEY, PLAY_TO_CHOICES, useBoolPref, usePlayTo, VIBRATE_KEY } from './prefs';
+import { AUTO_START_KEY, KEEP_AWAKE_KEY, PLAY_TO_CHOICES, REGULARS_FIRST_KEY, useBoolPref, usePlayTo, VIBRATE_KEY } from './prefs';
 import { useTheme } from './useTheme';
 
 interface Props {
   onBack: () => void;
   onManage: () => void;
+  onHistory: () => void;
 }
 
-export function SettingsScreen({ onBack, onManage }: Props) {
+export function SettingsScreen({ onBack, onManage, onHistory }: Props) {
+  const [regularsFirst, setRegularsFirst] = useBoolPref(REGULARS_FIRST_KEY, true);
   const { status, email, error, busy, sendLink, changeEmail, signOut } = useAuthStore();
   const [emailInput, setEmailInput] = useState('');
   const syncStatus = useSyncStore((s) => s.status);
@@ -122,6 +124,15 @@
           Manage players
         </button>
         <p className="muted">Rename or remove saved players, and add their photos.</p>
+        <button type="button" className="btn" onClick={onHistory}>
+          Past sessions
+        </button>
+        <p className="muted">Look back at sessions you have ended. They stay on this phone.</p>
+        <label className="switch-row">
+          <span>Show regulars first</span>
+          <input type="checkbox" role="switch" checked={regularsFirst} onChange={(e) => setRegularsFirst(e.target.checked)} />
+        </label>
+        <p className="muted">When you set up a session, the people who come most often are listed first.</p>
       </section>
 
       <section className="card stack" aria-labelledby="account-title">
````

**Modify `src/styles/app.css`**

````diff
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -1639,3 +1639,8 @@
   font-size: 13px;
   text-align: right;
 }
+
+/* Past sessions and attendance */
+.past-row { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 12px 14px; text-align: left; background: none; border: 0; color: inherit; font: inherit; cursor: pointer; }
+.saved-name { display: flex; flex-direction: column; min-width: 0; }
+.saved-att { font-size: 0.8125rem; }
````

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/ui/pastSessions.test.tsx` and `npx tsc --noEmit -p .`
Expected: All pass. Settings also has the Show regulars first switch now; Task 5 uses it.

- [ ] **Step 5: Commit**

```bash
git add src/ui/PastSessionsScreen.tsx src/ui/App.tsx src/ui/SettingsScreen.tsx src/ui/prefs.ts src/styles/app.css src/test/historyFixtures.ts src/ui/pastSessions.test.tsx
git commit -m "Add the Past sessions screen"
```

### Task 5: Attendance on Saved players, regulars first, the weekday chip

**Files:**
- Modify: `src/ui/SavedPlayersScreen.tsx`, `src/ui/SetupScreen.tsx`
- Test: `src/ui/regulars.test.tsx`

- [ ] **Step 1: Write the tests**

**Create `src/ui/regulars.test.tsx`**

````tsx
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetHistoryDbForTests } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { pastSession, seed } from '../test/historyFixtures';
import App from './App';
import { setDefaultMode } from './matchmaking';

beforeEach(async () => {
  localStorage.clear();
  setDefaultMode('fairness');
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  await resetRosterDbForTests();
  await resetHistoryDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
  useHistoryStore.setState({ entries: [], loaded: false, persistent: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const openSettings = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Settings' }));

describe('Saved players shows who comes', () => {
  it('says how often and when, and that someone has not played', async () => {
    const names = ['Ann', 'Ben', 'Cy', 'Dee'];
    const ids = await seed([...names, 'Newbie']);
    await pastSession(names, ids, 2026, 10, 4);
    await pastSession(names.slice(0, 2).concat(['Cy', 'Dee']), ids, 2026, 10, 11);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /edit players/i }));
    expect(await screen.findAllByText('2 sessions, last Wed 11 Nov')).toHaveLength(4);
    const rows = screen.getAllByRole('listitem');
    expect(rows.find((r) => r.textContent?.includes('Newbie'))).toHaveTextContent('No sessions yet');
  });
});

describe('Setup puts regulars first', () => {
  async function names() {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(useHistoryStore.getState().loaded).toBe(true));
    await waitFor(() => expect(useRosterStore.getState().loaded).toBe(true));
    return { user, order: () => within(screen.getByRole('list', { name: 'Saved players' })).getAllByRole('listitem').map((li) => li.querySelector('.row-name')?.textContent) };
  }

  it('lists the most frequent players first', async () => {
    const all = ['Ann', 'Ben', 'Cy', 'Dee', 'Zed'];
    const ids = await seed(all);
    await pastSession(['Zed', 'Cy', 'Ann', 'Ben'], ids, 2026, 10, 1);
    await pastSession(['Zed', 'Cy', 'Dee', 'Ben'], ids, 2026, 10, 2);
    await pastSession(['Zed', 'Cy', 'Dee', 'Ann'], ids, 2026, 10, 3);
    const { order } = await names();
    await waitFor(() => expect(order()[0]).toBe('Cy'));
    expect(order()).toEqual(['Cy', 'Zed', 'Ann', 'Dee', 'Ben']);
  });

  it('keeps alphabetical order when switched off in Settings', async () => {
    const ids = await seed(['Ann', 'Ben', 'Cy', 'Dee', 'Zed']);
    await pastSession(['Zed', 'Cy', 'Dee', 'Ben'], ids, 2026, 10, 1);
    await pastSession(['Zed', 'Cy', 'Dee', 'Ben'], ids, 2026, 10, 2);
    localStorage.setItem('pickleball.regularsFirst', 'false');
    const { order } = await names();
    expect(order()).toEqual(['Ann', 'Ben', 'Cy', 'Dee', 'Zed']);
  });

  it('has the switch in Settings, on by default', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSettings(user);
    const sw = screen.getByRole('switch', { name: 'Show regulars first' });
    expect(sw).toBeChecked();
    await user.click(sw);
    expect(localStorage.getItem('pickleball.regularsFirst')).toBe('false');
  });
});

describe('the weekday chip', () => {
  const group = ['Ann', 'Ben', 'Cy', 'Dee'];
  it('offers this weekday’s regulars once they have come twice', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 18, 12)); // a Wednesday
    const ids = await seed([...group, 'Eve']);
    await pastSession(group, ids, 2026, 10, 4);
    await pastSession(group, ids, 2026, 10, 11);
    await pastSession(['Eve', 'Ann', 'Ben', 'Cy'], ids, 2026, 10, 12); // a Thursday
    render(<App />);
    const chip = await screen.findByRole('button', { name: 'Wednesday regulars (4)' });
    vi.useRealTimers();
    await userEvent.setup().click(chip);
    expect(screen.getByText('4 selected')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Eve/ })).not.toBeChecked();
  });

  it('is not offered when fewer than four are regulars', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 18, 12)); // a Wednesday
    const ids = await seed([...group, 'Eve']);
    await pastSession(group, ids, 2026, 10, 4);
    await pastSession(['Ann', 'Ben', 'Cy', 'Eve'], ids, 2026, 10, 11);
    render(<App />);
    await waitFor(() => expect(useHistoryStore.getState().loaded).toBe(true));
    expect(screen.queryByRole('button', { name: /regulars \(/ })).not.toBeInTheDocument();
  });

  it('is not offered with fewer than four, or on a day with no pattern', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 19, 12)); // a Thursday
    const ids = await seed(group);
    await pastSession(group, ids, 2026, 10, 4);
    await pastSession(group, ids, 2026, 10, 11);
    render(<App />);
    await waitFor(() => expect(useHistoryStore.getState().loaded).toBe(true));
    expect(screen.queryByRole('button', { name: /regulars \(/ })).not.toBeInTheDocument();
  });
});
````

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/regulars.test.tsx`
Expected: FAIL on the attendance line, the ordering and the weekday chip. The Settings switch test already passes.

- [ ] **Step 3: Write the code**

**Modify `src/ui/SavedPlayersScreen.tsx`**

````diff
--- a/src/ui/SavedPlayersScreen.tsx
+++ b/src/ui/SavedPlayersScreen.tsx
@@ -1,4 +1,6 @@
-import { useRef, useState } from 'react';
+import { useMemo, useRef, useState } from 'react';
+import { attendanceByRoster, attendanceLine } from '../store/attendance';
+import { useHistoryStore } from '../store/historyStore';
 import { useRosterStore } from '../store/rosterStore';
 import { PhotoSheet } from './PhotoSheet';
 import { PlayerAvatar } from './PlayerAvatar';
@@ -10,6 +12,8 @@
 
 export function SavedPlayersScreen({ onBack }: Props) {
   const roster = useRosterStore((s) => s.players);
+  const history = useHistoryStore((s) => s.entries);
+  const attendance = useMemo(() => attendanceByRoster(history), [history]);
   const rename = useRosterStore((s) => s.rename);
   const remove = useRosterStore((s) => s.remove);
   const add = useRosterStore((s) => s.add);
@@ -170,7 +174,10 @@
                         </span>
                       )}
                     </button>
-                    <span className="row-name">{p.name}</span>
+                    <span className="saved-name">
+                      <span className="row-name">{p.name}</span>
+                      <span className="muted saved-att">{attendanceLine(attendance.get(p.id))}</span>
+                    </span>
                   </span>
                   <span className="saved-actions">
                     <button
````

**Modify `src/ui/SetupScreen.tsx`**

````diff
--- a/src/ui/SetupScreen.tsx
+++ b/src/ui/SetupScreen.tsx
@@ -1,13 +1,16 @@
-import { useEffect, useRef, useState } from 'react';
+import { useEffect, useMemo, useRef, useState } from 'react';
+import { attendanceByRoster, regularsForWeekday, sortByAttendance } from '../store/attendance';
+import { useHistoryStore } from '../store/historyStore';
 import { lastSessionIds } from '../store/rosterDb';
 import { useRosterStore } from '../store/rosterStore';
 import { useSessionStore } from '../store/sessionStore';
 import { getDefaultMode, useDefaultMode } from './matchmaking';
-import { AUTO_START_KEY, COURTS_KEY, getBoolPref, getNumPref, setNumPref } from './prefs';
+import { AUTO_START_KEY, COURTS_KEY, getBoolPref, getNumPref, REGULARS_FIRST_KEY, setNumPref, useBoolPref } from './prefs';
 import { PlayerAvatar } from './PlayerAvatar';
 
 const MIN_PLAYERS = 4;
 const MAX_COURTS = 12;
+const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
 
 interface Props {
   onManage: () => void;
@@ -21,7 +24,16 @@
 }
 
 export function SetupScreen({ onManage }: Props) {
-  const roster = useRosterStore((s) => s.players);
+  const saved = useRosterStore((s) => s.players);
+  const history = useHistoryStore((s) => s.entries);
+  const [regularsFirst] = useBoolPref(REGULARS_FIRST_KEY, true);
+  // The people who come most often go first, so the usual crowd is at the top of a long list.
+  const roster = useMemo(() => (regularsFirst ? sortByAttendance(saved, attendanceByRoster(history)) : saved), [saved, history, regularsFirst]);
+  const weekday = new Date().getDay();
+  const weekdayIds = useMemo(() => {
+    const here = new Set(saved.map((p) => p.id));
+    return regularsForWeekday(history, weekday).filter((id) => here.has(id));
+  }, [saved, history, weekday]);
   const addToRoster = useRosterStore((s) => s.add);
   const start = useSessionStore((s) => s.start);
   const [mode] = useDefaultMode();
@@ -143,6 +155,11 @@
               Same as last time ({lastIds.length})
             </button>
           )}
+          {weekdayIds.length >= MIN_PLAYERS && (
+            <button type="button" className="btn btn-small" onClick={() => setSelected(new Set(weekdayIds))}>
+              {DAY_NAMES[weekday]} regulars ({weekdayIds.length})
+            </button>
+          )}
           <button type="button" className="btn btn-ghost btn-small" onClick={() => setSelected(new Set(roster.map((p) => p.id)))}>
             Select all
           </button>
````

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/ui/regulars.test.tsx` and `npx tsc --noEmit -p .`
Expected: All 10 pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/SavedPlayersScreen.tsx src/ui/SetupScreen.tsx src/ui/regulars.test.tsx
git commit -m "Show attendance, list regulars first and offer the weekday regulars"
```

### Task 6: Delete all my data also clears history

**Files:**
- Modify: `src/sync/dataActions.ts`
- Test: `src/sync/dataActions.test.ts`

- [ ] **Step 1: Write the tests**

**Modify `src/sync/dataActions.test.ts`**

````diff
--- a/src/sync/dataActions.test.ts
+++ b/src/sync/dataActions.test.ts
@@ -9,8 +9,10 @@
   setRosterPhoto,
   setSyncMeta,
 } from '../store/rosterDb';
+import { clearHistory, listHistory, resetHistoryDbForTests, saveSessionToHistory } from '../store/historyDb';
 import { USER_A, USER_B } from './db/harness';
 import { clearThisDevice, deleteAllMyData, removeAllPhotoFiles, type DataActionDeps } from './dataActions';
+import { createSession } from '../engine';
 import { createFakeServer, type FakeServer } from './fakeServer';
 import { RemoteError } from './remote';
 
@@ -41,6 +43,7 @@
 
 beforeEach(async () => {
   await resetRosterDbForTests();
+  await resetHistoryDbForTests();
   await server.db.exec('truncate public.players');
   server.files.clear();
   server.calls.length = 0;
@@ -60,6 +63,26 @@
 });
 afterEach(() => vi.restoreAllMocks());
 
+const endedSession = () => {
+  const ctx = { now: 1000, rng: () => 0.5, newId: () => 'hs1' };
+  return { ...createSession({ name: 'Night', mode: 'fairness', courtCount: 1, players: [] }, ctx), endedAt: 2000 };
+};
+
+describe('past sessions and the data actions', () => {
+  it('delete all my data forgets past sessions too', async () => {
+    await saveSessionToHistory(endedSession());
+    await deleteAllMyData(deps());
+    expect(await listHistory()).toEqual([]);
+  });
+
+  it('clearing this device leaves past sessions alone', async () => {
+    await saveSessionToHistory(endedSession());
+    await clearThisDevice(deps());
+    expect(await listHistory()).toHaveLength(1);
+    await clearHistory();
+  });
+});
+
 describe('deleting all my data', () => {
   it('removes every photo file and player from the account, then clears this device, and touches nobody else', async () => {
     expect(await deleteAllMyData(deps())).toEqual({ ok: true });
````

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/sync/dataActions.test.ts`
Expected: FAIL on "delete all my data forgets past sessions too".

- [ ] **Step 3: Write the code**

**Modify `src/sync/dataActions.ts`**

````diff
--- a/src/sync/dataActions.ts
+++ b/src/sync/dataActions.ts
@@ -1,3 +1,5 @@
+import { clearHistory } from '../store/historyDb';
+import { useHistoryStore } from '../store/historyStore';
 import { clearRosterData } from '../store/rosterDb';
 import { useRosterStore } from '../store/rosterStore';
 import { useAuthStore } from './auth';
@@ -60,6 +62,9 @@
     await removeAllPhotoFiles(server.remote, server.userId, deps.batchSize);
     await server.remote.deleteAllMyPlayers();
     await clearRosterData();
+    // Past sessions name the same people, so they go with the account's data.
+    await clearHistory();
+    void useHistoryStore.getState().load();
     useSyncStore.setState({ pending: 0, lastSyncedAt: null });
     deps.refresh();
     return { ok: true };
````

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/sync/dataActions.test.ts` and `npx tsc --noEmit -p .`
Expected: All 13 pass. "Clear this device" still keeps history.

- [ ] **Step 5: Commit**

```bash
git add src/sync/dataActions.ts src/sync/dataActions.test.ts
git commit -m "Clear past sessions when all data is deleted"
```

### Task 7: Record the design in the spec, then run everything

**Files:**
- Modify: `docs/superpowers/specs/2026-11-07-organizer-experience-phases.md`

- [ ] **Step 1: Write the tests**

No new tests. This task records what was built and where it differs from the first sketch (own database, whole session stored, saved when the summary opens, Past sessions from Settings only, attendance line without a sort control, one weekday suggestion).

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run`
Expected: Nothing to fail yet.

- [ ] **Step 3: Write the code**

**Modify `docs/superpowers/specs/2026-11-07-organizer-experience-phases.md`**

````diff
--- a/docs/superpowers/specs/2026-11-07-organizer-experience-phases.md
+++ b/docs/superpowers/specs/2026-11-07-organizer-experience-phases.md
@@ -235,25 +235,26 @@
 
 ### 3.1 Session history
 
-- New IndexedDB store `sessions` (database version 4, additive). On End session, save a compact record: id, name, start and end time, per-player games, games list (teams by roster id and name, court, length), and which players were present. Keep the last 100 sessions; older ones are dropped.
-- The upgrade must branch on `oldVersion` like the version 3 upgrade, and an old tab opening the new database must not look like "storage unavailable" (the follow-ups note already documents this trap).
-- **Past sessions** screen, reached from Settings and from the summary. A list (date, name, games, time). Tapping one opens the same summary screen, read-only, with Share.
-- The summary's **Start new session** warning ("you have not shared it yet") stops mattering once history exists: the session is saved. Keep the warning only if saving failed.
+- **A database of its own**, `pickleball-history` (version 1, one store `sessions`), not a bump of the roster database. Saved players, their photos and their sync stay exactly as they were: no upgrade to get wrong, no old tab blocking it, and "Clear this device" keeps meaning saved players only. If it cannot open (private mode), history lives in memory for that visit and the Past sessions screen says so.
+- **The whole finished session is stored**, plus its name, start, end and game count for the list. The summary screen reads a session, so a past session opens in the same screen and its numbers cannot drift from a second copy of the maths. It is capped at the last 100 sessions; older ones are dropped when a new one is saved. Entries that fail a shape check are left out of the list.
+- A session is saved when its summary opens, once, and saving again replaces the same entry. That covers a reload on the summary screen as well as the moment of ending.
+- **Past sessions** is reached from Settings. A list (name, short date, games, players). Tapping one opens the same summary, read-only: Share or Copy stays, Start new session goes, and a Back button returns to the list.
+- The summary's **Start new session** warning ("you have not shared it yet") only shows now when the session is not in history, that is, when saving failed.
+- **Delete all my data** also clears history. **Clear saved players on this device** does not.
 
 ### 3.2 Attendance on saved players
 
-- Derived from history, no new roster fields: sessions attended, total games, last played.
-- Saved players shows a muted second line under the name ("12 sessions, last Sat") and a sort control: A to Z, Recently played, Most sessions.
-- The second line only shows when there is history, and long text is cut off with an ellipsis so every row keeps the same height, as the icon-button rows do today.
+- Derived from history, no new roster fields: sessions attended (once per session however many games) and the date the latest one ended.
+- Saved players shows a muted second line under each name ("12 sessions, last Sat 8 Nov", or "No sessions yet"). The list stays A to Z so a player is easy to find to rename or remove. Ordering by attendance happens on New session instead (3.3).
 
 ### 3.3 Regulars first, suggested groups
 
-- New session: sort the chips **recently played first** by default (a Settings switch brings back A to Z).
-- Suggested shortcuts, computed from history with no stored groups: **Same as last time** (exists) and, when there is enough history, **Tuesday regulars (14)**: players who attended at least half of the last six sessions that started on that weekday. At most two suggestions show.
+- New session lists the people who come most often first, then the most recent, then A to Z. People with no history keep their usual order after them. A Settings switch, **Show regulars first**, on by default, brings back A to Z.
+- One weekday suggestion, computed from history with no stored groups: **Wednesday regulars (6)**, the saved players who came to at least two sessions that started on today's weekday. It only shows with at least four of them. **Same as last time** stays as it is.
 - Real named groups are Phase 5 (they must sync).
 
 ### Acceptance
-End a session and it appears in Past sessions with correct numbers (the same numbers as the summary). Attendance counts match history. Upgrading from database version 3 keeps every saved player and photo (reuse the Task 6 browser upgrade check from the 3B1 plan). The suggestions are deterministic and tested with fixed dates.
+End a session and it appears in Past sessions with the same numbers as the summary. Attendance counts match history. The roster database is untouched, so no upgrade check is needed. The suggestions are deterministic and tested with fixed dates. Checked at 360 px: Settings, Past sessions, the read-only summary.
 
 ### Open point
 History is local to the device in this phase, so clearing browser data loses it. Syncing it is in Phase 5.
````

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run` and `npx tsc --noEmit -p .`
Expected: 85 files, 835 tests pass (with this plan file committed as well), `tsc` is clean, `npx vite build` succeeds.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-11-07-organizer-experience-phases.md docs/superpowers/plans/2026-11-07-organizer-phase-3.md
git commit -m "Record the Phase 3 design in the spec and add its plan"
```

---

## Phone check (after merge)

1. End a session. Open Settings, Past sessions: it is in the list. Open it: the same numbers as the summary, Share or Copy works, Back returns.
2. Saved players: each name has "N sessions, last Wed 4 Nov" under it. Someone new says "No sessions yet".
3. New session: the people who come most are at the top. Settings, Show regulars first off, and the list is A to Z again.
4. After two sessions on the same weekday with the same four or more people, a "Wednesday regulars (N)" button appears on that weekday.
5. Private browsing: Past sessions says this browser cannot keep history.
