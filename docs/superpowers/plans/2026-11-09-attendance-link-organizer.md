# Attendance link, Plan 2 of 4: the organizer side Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in organizer can create an attendance link for a weekly slot, see the answers on the Home slot card, share the link, reset it, cancel a week (and undo), and the link moves to the next week when a session ends. All of it is hidden behind a preview switch until the member page exists.

**Architecture:** A client for the attendance database (a remote with a real version and an in-memory test version), a store that keeps a per-account copy on the device and works offline, a hook that keeps the answers fresh, and one card on Home with two sheets. A session remembers its slot so ending it can close the right date. Everything visible sits behind a Settings switch, off by default.

**Tech Stack:** React, TypeScript, Vite, Zustand, Supabase client, Vitest, PGlite (in-memory Postgres for the tests). No new dependencies.

Design, audit and the four plans: `docs/superpowers/specs/2026-11-09-attendance-link.md`. Pictures: `docs/superpowers/sketches/attendance-v2.png` (screen 3 is the Home card). The database this client talks to: Plan 1, `docs/superpowers/plans/2026-11-09-attendance-link-database.md`, already on production and applied to the real project.

**Where this fits.** Plan 2 of 4: the database (done), the organizer side (this plan), the public member page, the session flow (pre-fill, late players, review names, copy list). After this plan the organizer can create and manage a link behind a preview switch. Members cannot open it yet.

**Before you start.** Work from a clean checkout of production (`origin/claude/pickleball-matchmaking-app-i4baca`, commit `3ff5c1a` or later). Baseline: 1523 tests across 121 files, `npx tsc --noEmit` clean. After this plan: 1776 tests across 133 files. Node modules are already installed. Stage files by name, never `git add -A`. Do not touch `src/ui/EditSlotSheet*`, `src/ui/PlayerSheet*`, `src/styles/editSlot.css` or `src/styles/playerSheet.css`.

**Decisions this plan carries out (do not revisit).**
- The card and everything it shows sit behind the preview switch, `pikl.attendancePreview`, off by default.
- Signed in only. A saved sign-in that cannot be checked (offline) is neither signed in nor signed out: cached data shows, a sign-in prompt never does.
- One link per slot, created by the organizer with a button. Title is "{Weekday} open play". The time zone is the device's, or `Asia/Manila` when it does not fit the database rule.
- The database decides which date a link is about. The client only computes the date a session started on, in the device's zone, to close it.
- A slot saved for good updates its link after 800 ms. A "this time only" edit never reaches the link. The update never changes the code or the closed date.
- Cancel is a delete then an insert. Undo is a delete. Both use the date from the latest answers.
- Offline: the last good copy stays. "Updated 4:12 pm" shows when it is older than 2 minutes or the last fetch failed. Write actions say "No connection. Try again when you are online." and change nothing.
- Closing a date only moves forward, and is queued and retried when it cannot be sent.
- Share: the share sheet when there is one, else copy to the clipboard, else a selected field. Reset and Cancel ask first in a sheet.
- Signing out, clearing this device and deleting all data clear the copy. Another account signing in on the same device never sees the previous copy.

## File structure

| File | Job |
|---|---|
| `src/sync/attendance/types.ts`, `links.ts` | Types and pure helpers |
| `src/sync/attendance/remote.ts` | The client for the attendance database (interface and the real version) |
| `src/sync/attendance/fakeRemote.ts` | The in-memory version the tests use |
| `src/sync/attendance/store.ts`, `start.ts` | The store with its device copy, and the watcher for slots and sign-out |
| `src/engine/session.ts`, `types.ts`, `src/store/persistence.ts`, `src/ui/SetupScreen.tsx` | `slotId` on a session |
| `src/ui/LiveScreen.tsx` | Closes the date when a session ends |
| `src/ui/prefs.ts`, `src/ui/SettingsScreen.tsx` | The preview switch |
| `src/ui/useAttendance.ts` | Keeps the answers fresh |
| `src/ui/AttendanceCard.tsx`, `AttendanceSheets.tsx`, `src/styles/app.css` | The card and its sheets |
| `src/ui/HomeScreen.tsx`, `src/ui/App.tsx` | Shows the card, starts the watcher |
| `src/sync/remote.ts`, `src/sync/dataActions.ts` | One word exported, and two clearing lines |

---

### Task 1: The helpers: titles, rows, summaries and the last change

Everything the card says is worked out by pure helpers first: the title and the link row for a slot, the counts for the card, display names (with a last initial when two players share a first name), the "latest change" note, the calendar date in a time zone, and the share address. No network and no screens.

**Files:**
- Create: `src/sync/attendance/links.ts`
- Create: `src/sync/attendance/types.ts`
- Create: `src/sync/attendance/links.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/sync/attendance/links.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { Slot } from '../../store/slots';
import { diffChange, displayNames, linkRow, localDate, safeTimezone, shareUrl, summarize, titleFor, weekdayName } from './links';
import type { AttendanceStatus, AttendanceViewData } from './types';

const player = (id: string, first: string, initial: string | null = null) => ({
  id,
  first_name: first,
  last_initial: initial,
  has_photo: false,
  photo_seq: 0,
});

describe('weekdayName and titleFor', () => {
  it('names Sunday to Saturday', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(weekdayName)).toEqual([
      'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
    ]);
  });

  it('titles a slot "{Weekday} open play"', () => {
    expect(titleFor({ id: 'tue', weekday: 2 })).toBe('Tuesday open play');
    expect(titleFor({ id: 'sun', weekday: 0 })).toBe('Sunday open play');
  });
});

describe('safeTimezone', () => {
  it('keeps a plausible zone name', () => {
    expect(safeTimezone('Asia/Manila')).toBe('Asia/Manila');
    expect(safeTimezone('America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
    expect(safeTimezone('Etc/GMT+8')).toBe('Etc/GMT+8');
    expect(safeTimezone('UTC')).toBe('UTC');
  });

  it('falls back to Asia/Manila for anything else', () => {
    for (const raw of [undefined, null, '', 'Not a zone', 'Asia/Man ila', '/Asia', 'Asia//Manila', "Asia/Manila'; drop", 'GMT+8 ']) {
      expect(safeTimezone(raw)).toBe('Asia/Manila');
    }
  });
});

describe('linkRow', () => {
  it('copies the slot into the columns the client writes', () => {
    const slot: Slot = { id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: ' Sample Hall ', courts: 3 };
    expect(linkRow(slot, 'Asia/Manila')).toEqual({
      slot_id: 'tue',
      title: 'Tuesday open play',
      weekday: 2,
      start_min: 1140,
      end_min: 1260,
      venue: 'Sample Hall',
      courts: 3,
      timezone: 'Asia/Manila',
    });
  });

  it('writes nulls for what the slot lacks, so a removed time is cleared on the link', () => {
    const row = linkRow({ id: 'sat', weekday: 6, venue: '   ' }, 'Asia/Manila');
    expect(row).toMatchObject({ start_min: null, end_min: null, venue: null, courts: null });
  });

  it('never carries the code or closed_through', () => {
    const keys = Object.keys(linkRow({ id: 'tue', weekday: 2 }, 'Asia/Manila'));
    expect(keys).not.toContain('code');
    expect(keys).not.toContain('closed_through');
  });

  it('replaces an unsafe zone', () => {
    expect(linkRow({ id: 'tue', weekday: 2 }, 'nope nope').timezone).toBe('Asia/Manila');
    expect(linkRow({ id: 'tue', weekday: 2 }, 'Australia/Sydney').timezone).toBe('Australia/Sydney');
  });
});

describe('displayNames', () => {
  it('uses the first name alone when it is unique', () => {
    expect(displayNames([player('a', 'Ana', 'R'), player('b', 'Ben', 'C')])).toEqual({ a: 'Ana', b: 'Ben' });
  });

  it('adds the last initial when two players share a first name, ignoring case', () => {
    const names = displayNames([player('a', 'Ben', 'C'), player('b', 'ben', 'D'), player('c', 'Ana', 'R')]);
    expect(names).toEqual({ a: 'Ben C.', b: 'ben D.', c: 'Ana' });
  });

  it('leaves a shared first name bare when there is no initial', () => {
    expect(displayNames([player('a', 'Ben', null), player('b', 'Ben', 'D')])).toEqual({ a: 'Ben', b: 'Ben D.' });
  });
});

describe('summarize', () => {
  const view = (over: Partial<AttendanceViewData> = {}): AttendanceViewData => ({
    title: 'Tuesday open play',
    weekday: 2,
    venue: null,
    start_min: null,
    end_min: null,
    courts: null,
    play_date: '2026-11-10',
    cancelled: null,
    players: [player('a', 'Ana'), player('b', 'Ben'), player('c', 'Cy'), player('d', 'Di'), player('e', 'Ed')],
    answers: [
      { player_id: 'a', status: 'in', late: true },
      { player_id: 'b', status: 'in', late: false },
      { player_id: 'c', status: 'maybe', late: false },
      { player_id: 'd', status: 'out', late: false },
    ],
    friends: 2,
    ...over,
  });

  it('counts in, maybe, out and late, and keeps friends and waiting names', () => {
    const waiting = [{ id: 'g1', name: 'Zed', broughtBy: null }];
    const s = summarize('tue', 'abc', view(), waiting, 5000);
    expect(s).toEqual({
      slotId: 'tue',
      code: 'abc',
      playDate: '2026-11-10',
      cancelled: null,
      counts: { in: 2, maybe: 1, out: 1, late: 1 },
      friends: 2,
      waiting,
      answers: { a: 'in', b: 'in', c: 'maybe', d: 'out' },
      names: { a: 'Ana', b: 'Ben', c: 'Cy', d: 'Di', e: 'Ed' },
      fetchedAt: 5000,
    });
  });

  it('counts a player who has not answered nowhere', () => {
    const s = summarize('tue', 'abc', view({ answers: [] }), [], 1);
    expect(s.counts).toEqual({ in: 0, maybe: 0, out: 0, late: 0 });
  });

  it('ignores an answer from someone no longer on the roster', () => {
    const s = summarize('tue', 'abc', view({ answers: [{ player_id: 'gone', status: 'in', late: false }] }), [], 1);
    expect(s.counts.in).toBe(0);
    expect(s.answers).toEqual({});
  });

  it('carries the cancellation', () => {
    const s = summarize('tue', 'abc', view({ cancelled: { reason: 'Rain' } }), [], 1);
    expect(s.cancelled).toEqual({ reason: 'Rain' });
  });
});

describe('diffChange', () => {
  const names = { a: 'Ana', b: 'Ben' };
  const answers = (o: Record<string, AttendanceStatus>) => o;

  it('reports a player who changed to a different status', () => {
    expect(diffChange(answers({ a: 'in', b: 'in' }), answers({ a: 'in', b: 'out' }), names, 99)).toEqual({
      player: 'Ben',
      from: 'in',
      to: 'out',
      at: 99,
    });
  });

  it('does not count a first answer as a change', () => {
    expect(diffChange(answers({ a: 'in' }), answers({ a: 'in', b: 'out' }), names, 1)).toBeNull();
  });

  it('returns null when nothing changed, or when there is no previous list', () => {
    expect(diffChange(answers({ a: 'in' }), answers({ a: 'in' }), names, 1)).toBeNull();
    expect(diffChange(undefined, answers({ a: 'in' }), names, 1)).toBeNull();
  });

  it('keeps the last of several changes, in the order of the new answers', () => {
    const note = diffChange(answers({ a: 'in', b: 'in' }), answers({ a: 'maybe', b: 'out' }), names, 7);
    expect(note).toEqual({ player: 'Ben', from: 'in', to: 'out', at: 7 });
  });

  it('does not report an answer that went away', () => {
    expect(diffChange(answers({ a: 'in', b: 'in' }), answers({ a: 'in' }), names, 1)).toBeNull();
  });

  it('skips a player with no display name', () => {
    expect(diffChange(answers({ z: 'in' }), answers({ z: 'out' }), names, 1)).toBeNull();
  });
});

describe('localDate', () => {
  it('rolls to the next day in Manila when UTC is late evening', () => {
    const ms = Date.UTC(2026, 10, 9, 23, 30); // 9 Nov 23:30 UTC is 10 Nov 07:30 in Manila
    expect(localDate(ms, 'UTC')).toBe('2026-11-09');
    expect(localDate(ms, 'Asia/Manila')).toBe('2026-11-10');
  });

  it('goes back a day in a zone behind UTC', () => {
    const ms = Date.UTC(2026, 10, 10, 3, 0); // 10 Nov 03:00 UTC is 9 Nov 22:00 in New York
    expect(localDate(ms, 'America/New_York')).toBe('2026-11-09');
    expect(localDate(ms, 'Asia/Manila')).toBe('2026-11-10');
  });

  it('pads month and day', () => {
    expect(localDate(Date.UTC(2026, 0, 5, 12), 'UTC')).toBe('2026-01-05');
  });
});

describe('shareUrl', () => {
  it('joins the origin, /j/ and the code', () => {
    expect(shareUrl('https://pikl.example', 'abc123')).toBe('https://pikl.example/j/abc123');
  });

  it('does not double a trailing slash', () => {
    expect(shareUrl('https://pikl.example/', 'abc')).toBe('https://pikl.example/j/abc');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/sync/attendance/links.test.ts`

Expected: it fails. Test Files `1 failed (1)`, Tests `no tests`.

- [ ] **Step 3: Write the code**

Create `src/sync/attendance/links.ts`:

```typescript
import type { Slot } from '../../store/slots';
import type { AttendanceStatus, AttendanceViewData, ChangeNote, LinkRow, Summary, WaitingName } from './types';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The zone every link uses unless the device has a usable one. */
export const DEFAULT_TIMEZONE = 'Asia/Manila';
// The same rule the database applies to a link's time zone.
const TIMEZONE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/;

export const weekdayName = (weekday: number): string => WEEKDAYS[weekday] ?? '';

/** "Tuesday open play", the same way sessions are named. */
export const titleFor = (slot: Slot): string => `${weekdayName(slot.weekday)} open play`;

export function safeTimezone(raw: string | null | undefined): string {
  return typeof raw === 'string' && TIMEZONE.test(raw) ? raw : DEFAULT_TIMEZONE;
}

/** The columns a slot writes on its link. Missing times, venue and courts are written as null so they clear. */
export function linkRow(slot: Slot, timezone: string): LinkRow {
  return {
    slot_id: slot.id,
    title: titleFor(slot),
    weekday: slot.weekday,
    start_min: slot.startMin ?? null,
    end_min: slot.endMin ?? null,
    venue: slot.venue?.trim() || null,
    courts: slot.courts ?? null,
    timezone: safeTimezone(timezone),
  };
}

type ViewPlayer = AttendanceViewData['players'][number];

/** First names by player id. Two players with the same first name get their last initial: "Ben C.". */
export function displayNames(players: ViewPlayer[]): Record<string, string> {
  const taken = new Map<string, number>();
  for (const p of players) {
    const key = p.first_name.toLowerCase();
    taken.set(key, (taken.get(key) ?? 0) + 1);
  }
  const names: Record<string, string> = {};
  for (const p of players) {
    const shared = (taken.get(p.first_name.toLowerCase()) ?? 0) > 1;
    names[p.id] = shared && p.last_initial ? `${p.first_name} ${p.last_initial}.` : p.first_name;
  }
  return names;
}

export function summarize(
  slotId: string,
  code: string,
  view: AttendanceViewData,
  waiting: WaitingName[],
  now: number,
): Summary {
  const names = displayNames(view.players);
  const counts = { in: 0, maybe: 0, out: 0, late: 0 };
  const answers: Record<string, AttendanceStatus> = {};
  for (const a of view.answers) {
    // An answer from someone removed from the roster is not counted.
    if (!(a.player_id in names)) continue;
    answers[a.player_id] = a.status;
    counts[a.status] += 1;
    if (a.status === 'in' && a.late) counts.late += 1;
  }
  return {
    slotId,
    code,
    playDate: view.play_date,
    cancelled: view.cancelled,
    counts,
    friends: view.friends,
    waiting,
    answers,
    names,
    fetchedAt: now,
  };
}

/**
 * The latest answer that changed to a different status between two lists. A first answer is not a change, and
 * neither is an answer that went away. Several changes at once: the last in the new list wins.
 */
export function diffChange(
  prev: Record<string, AttendanceStatus> | undefined,
  next: Record<string, AttendanceStatus>,
  names: Record<string, string>,
  now: number,
): ChangeNote | null {
  if (!prev) return null;
  let found: ChangeNote | null = null;
  for (const [id, to] of Object.entries(next)) {
    const from = prev[id];
    if (from === undefined || from === to || names[id] === undefined) continue;
    found = { player: names[id], from, to, at: now };
  }
  return found;
}

/** The calendar date of a moment in a time zone, as YYYY-MM-DD. */
export function localDate(ms: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(ms),
  );
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export const shareUrl = (origin: string, code: string): string => `${origin.replace(/\/+$/, '')}/j/${code}`;
```

Create `src/sync/attendance/types.ts`:

```typescript
export type AttendanceStatus = 'in' | 'maybe' | 'out';

/** Why a request failed, as the card reports it. The same three kinds as `RemoteFailure`. */
export type Failure = 'offline' | 'auth' | 'server';

/** What `attendance_view` returns for a link code. */
export interface AttendanceViewData {
  title: string;
  weekday: number;
  venue: string | null;
  start_min: number | null;
  end_min: number | null;
  courts: number | null;
  /** The date the link is about, as YYYY-MM-DD. The database decides it. */
  play_date: string;
  cancelled: { reason: string | null } | null;
  players: { id: string; first_name: string; last_initial: string | null; has_photo: boolean; photo_seq: number }[];
  answers: { player_id: string; status: AttendanceStatus; late: boolean }[];
  friends: number;
}

/** A name waiting for the organizer: a new member asking to join, or a friend someone is bringing. */
export interface WaitingName {
  id: string;
  name: string;
  broughtBy: string | null;
}

/** What the Home card shows for one slot. */
export interface Summary {
  slotId: string;
  code: string;
  playDate: string;
  cancelled: { reason: string | null } | null;
  counts: { in: number; maybe: number; out: number; late: number };
  friends: number;
  waiting: WaitingName[];
  answers: Record<string, AttendanceStatus>;
  /** Display first name by player id, with a last initial when two players share a first name. */
  names: Record<string, string>;
  /** When this summary was fetched, in ms. */
  fetchedAt: number;
}

/** The columns the client writes on a link. Never `code` or `closed_through`. */
export interface LinkRow {
  slot_id: string;
  title: string;
  weekday: number;
  start_min: number | null;
  end_min: number | null;
  venue: string | null;
  courts: number | null;
  timezone: string;
}

/** The latest answer that changed, for the "Ben changed to Out" line. */
export interface ChangeNote {
  player: string;
  from: AttendanceStatus;
  to: AttendanceStatus;
  at: number;
}
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/sync/attendance/links.test.ts`

Expected: it passes. Test Files `1 passed (1)`, Tests `26 passed (26)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 1549 tests across 122 files.

- [ ] **Step 5: Commit**

```bash
git add src/sync/attendance/links.test.ts src/sync/attendance/links.ts src/sync/attendance/types.ts
git commit -m "Add the attendance link helpers: titles, rows, summaries and last change"
```

---

### Task 2: The remote: the real client, an in-memory version, and the exact requests

The client for the attendance database. An interface, the real version over the Supabase client, a test version that runs the real SQL on the in-memory Postgres (so the database rules really apply), and tests of the exact requests the real client sends, the way `remote.wire.test.ts` does for players. One existing line changes: `fail` in `src/sync/remote.ts` is exported so the new code reuses its offline, auth and server sorting. A cancellation is a delete then an insert, because the database allows no update on cancellations.

**Files:**
- Create: `src/sync/attendance/fakeRemote.ts`
- Create: `src/sync/attendance/remote.ts`
- Modify: `src/sync/remote.ts`
- Create: `src/sync/attendance/remote.test.ts`
- Create: `src/sync/attendance/remote.wire.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/sync/attendance/remote.test.ts`:

```typescript
// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { USER_A, USER_B, createDb, run } from '../db/harness';
import { isRemoteError } from '../remote';
import { fakeAttendanceRemote, type FakeFlags } from './fakeRemote';
import { linkRow } from './links';
import type { AttendanceRemote } from './remote';

const ANA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';

let db: PGlite;
let flags: FakeFlags;
let a: AttendanceRemote;
let b: AttendanceRemote;

beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec('truncate public.players, public.attendance_links cascade');
  await db.exec(`
    insert into public.players (owner_id, id, name) values ('${USER_A}', '${ANA}', 'Ana Reyes'), ('${USER_A}', '${BEN}', 'Ben Cruz')
  `);
  flags = { offline: false, calls: [] };
  a = fakeAttendanceRemote(db, USER_A, flags);
  b = fakeAttendanceRemote(db, USER_B);
});

const tue = linkRow({ id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Sample Hall', courts: 3 }, 'Asia/Manila');
const row = async (user: string, slot = 'tue') =>
  (await db.query<Record<string, unknown>>(
    'select code, title, venue, courts, closed_through::text as closed_through from public.attendance_links where owner_id = $1 and slot_id = $2',
    [user, slot],
  )).rows[0];
const cancellations = async () =>
  (await db.query<{ slot_id: string; play_date: string; reason: string | null; owner_id: string }>(
    'select owner_id, slot_id, play_date::text as play_date, reason from public.attendance_cancellations order by owner_id, slot_id, play_date',
  )).rows;
const answerAs = (code: string, player: string, status: string) =>
  run(db, 'anon', 'select public.attendance_answer($1, $2, $3, false)', [code, player, status]);
const guest = (code: string, name: string, by: string | null = null) =>
  run(db, 'anon', 'select public.attendance_add_guest($1, $2, $3)', [code, name, by]);

describe('the link', () => {
  it('is created, and found again with its code and no closed date', async () => {
    expect(await a.getLink('tue')).toBeNull();
    await a.upsertLink(tue);
    const link = await a.getLink('tue');
    expect(link?.code).toMatch(/^[0-9a-f]{24}$/);
    expect(link?.closedThrough).toBeNull();
  });

  it('is updated without changing its code or closed date', async () => {
    await a.upsertLink(tue);
    const before = await a.getLink('tue');
    await a.closeThrough('tue', '2026-11-10');
    await a.upsertLink({ ...tue, venue: 'New Hall', courts: 5, title: 'Tuesday open play' });
    const after = await a.getLink('tue');
    expect(after).toEqual({ code: before!.code, closedThrough: '2026-11-10' });
    expect(await row(USER_A)).toMatchObject({ venue: 'New Hall', courts: 5 });
  });

  it('clears a time that was removed from the slot', async () => {
    await a.upsertLink(tue);
    await a.upsertLink({ ...tue, start_min: null, end_min: null, venue: null, courts: null });
    const { rows } = await db.query('select start_min, end_min, venue, courts from public.attendance_links');
    expect(rows).toEqual([{ start_min: null, end_min: null, venue: null, courts: null }]);
  });

  it('gets a new code from resetLink, and the old code stops working', async () => {
    await a.upsertLink(tue);
    const old = (await a.getLink('tue'))!.code;
    const fresh = await a.resetLink('tue');
    expect(fresh).toMatch(/^[0-9a-f]{24}$/);
    expect(fresh).not.toBe(old);
    expect((await a.getLink('tue'))!.code).toBe(fresh);
    expect(await a.view(old)).toBeNull();
    expect(await a.view(fresh!)).not.toBeNull();
  });

  it('gives null from resetLink when there is no link', async () => {
    expect(await a.resetLink('tue')).toBeNull();
  });
});

describe('another organizer', () => {
  it('cannot see, reset, close or cancel the first organizer link', async () => {
    await a.upsertLink(tue);
    const code = (await a.getLink('tue'))!.code;
    expect(await b.getLink('tue')).toBeNull();
    expect(await b.resetLink('tue')).toBeNull();
    await b.closeThrough('tue', '2030-01-01');
    await expect(b.cancel('tue', '2026-11-10', 'x')).rejects.toMatchObject({ kind: 'server' });
    expect(await row(USER_A)).toMatchObject({ code, closed_through: null });
    expect(await cancellations()).toEqual([]);
  });

  it('writing the same slot id makes their own link and leaves the first alone', async () => {
    await a.upsertLink(tue);
    await b.upsertLink({ ...tue, venue: 'B Hall' });
    expect((await row(USER_A))!.venue).toBe('Sample Hall');
    expect((await row(USER_B))!.venue).toBe('B Hall');
    expect((await b.getLink('tue'))!.code).not.toBe((await a.getLink('tue'))!.code);
  });

  it('cannot undo the first organizer cancellation', async () => {
    await a.upsertLink(tue);
    await a.cancel('tue', '2026-11-10', 'Rain');
    await b.undoCancel('tue', '2026-11-10');
    expect(await cancellations()).toHaveLength(1);
  });
});

describe('cancel and undo', () => {
  it('records a reason, and a second cancel replaces it', async () => {
    await a.upsertLink(tue);
    await a.cancel('tue', '2026-11-10', 'Rain');
    expect(await cancellations()).toEqual([{ owner_id: USER_A, slot_id: 'tue', play_date: '2026-11-10', reason: 'Rain' }]);
    await a.cancel('tue', '2026-11-10', 'Court closed');
    expect(await cancellations()).toEqual([{ owner_id: USER_A, slot_id: 'tue', play_date: '2026-11-10', reason: 'Court closed' }]);
  });

  it('stores no reason as null, and keeps other dates', async () => {
    await a.upsertLink(tue);
    await a.cancel('tue', '2026-11-10', '');
    await a.cancel('tue', '2026-11-17', 'Holiday');
    expect((await cancellations()).map((c) => [c.play_date, c.reason])).toEqual([
      ['2026-11-10', null],
      ['2026-11-17', 'Holiday'],
    ]);
  });

  it('refuses a reason over 140 characters', async () => {
    await a.upsertLink(tue);
    await expect(a.cancel('tue', '2026-11-10', 'x'.repeat(141))).rejects.toMatchObject({ kind: 'server' });
  });

  it('undo removes only that date', async () => {
    await a.upsertLink(tue);
    await a.cancel('tue', '2026-11-10', 'Rain');
    await a.cancel('tue', '2026-11-17', null);
    await a.undoCancel('tue', '2026-11-10');
    expect((await cancellations()).map((c) => c.play_date)).toEqual(['2026-11-17']);
  });

  it('shows in the view for the date, and members then see it cancelled', async () => {
    await a.upsertLink(tue);
    const code = (await a.getLink('tue'))!.code;
    const date = (await a.view(code))!.play_date;
    await a.cancel('tue', date, 'Rain');
    expect((await a.view(code))!.cancelled).toEqual({ reason: 'Rain' });
    await a.undoCancel('tue', date);
    expect((await a.view(code))!.cancelled).toBeNull();
  });
});

describe('closeThrough', () => {
  it('moves forward only', async () => {
    await a.upsertLink(tue);
    await a.closeThrough('tue', '2026-11-10');
    expect((await row(USER_A))!.closed_through).toBe('2026-11-10');
    await a.closeThrough('tue', '2026-11-03');
    expect((await row(USER_A))!.closed_through).toBe('2026-11-10');
    await a.closeThrough('tue', '2026-11-10');
    expect((await row(USER_A))!.closed_through).toBe('2026-11-10');
    await a.closeThrough('tue', '2026-11-17');
    expect((await row(USER_A))!.closed_through).toBe('2026-11-17');
  });

  it('does nothing for a slot with no link', async () => {
    await expect(a.closeThrough('wed', '2026-11-10')).resolves.toBeUndefined();
  });
});

describe('view and waiting names', () => {
  it('shows the organizer the roster, the answers and the friends count', async () => {
    await a.upsertLink(tue);
    const code = (await a.getLink('tue'))!.code;
    await answerAs(code, ANA, 'in');
    await answerAs(code, BEN, 'maybe');
    await guest(code, 'Zed Zane', ANA);
    const v = await a.view(code);
    expect(v).toMatchObject({ title: 'Tuesday open play', weekday: 2, venue: 'Sample Hall', courts: 3, friends: 1 });
    expect(v!.players.map((p) => p.first_name)).toEqual(['Ana', 'Ben']);
    expect(v!.answers.map((x) => [x.player_id, x.status]).sort()).toEqual([[ANA, 'in'], [BEN, 'maybe']]);
  });

  it('returns null for an unknown code', async () => {
    expect(await a.view('0'.repeat(24))).toBeNull();
  });

  it('lists only pending names for the date, with who brought them', async () => {
    await a.upsertLink(tue);
    const code = (await a.getLink('tue'))!.code;
    const date = (await a.view(code))!.play_date;
    await guest(code, 'Newbie');
    await guest(code, 'Friend', ANA);
    await guest(code, 'Done');
    await run(db, { user: USER_A }, "update public.attendance_guests set state = 'added' where name = 'Done'");
    await run(db, { user: USER_A }, "update public.attendance_guests set state = 'dismissed' where name = 'Friend'");
    await guest(code, 'Friend2', BEN);
    const list = await a.listWaiting('tue', date);
    expect(list.map((g) => [g.name, g.broughtBy]).sort()).toEqual([['Friend2', BEN], ['Newbie', null]]);
    expect(list[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await a.listWaiting('tue', '2020-01-07')).toEqual([]);
  });

  it('does not list another organizer waiting names', async () => {
    await a.upsertLink(tue);
    const code = (await a.getLink('tue'))!.code;
    const date = (await a.view(code))!.play_date;
    await guest(code, 'Newbie');
    expect(await b.listWaiting('tue', date)).toEqual([]);
  });
});

describe('the in-memory remote itself', () => {
  it('fails with an offline error and changes nothing while offline', async () => {
    flags.offline = true;
    const error = await a.upsertLink(tue).catch((e: unknown) => e);
    expect(isRemoteError(error) && error.kind).toBe('offline');
    flags.offline = false;
    expect(await a.getLink('tue')).toBeNull();
  });

  it('logs each call by name', async () => {
    await a.upsertLink(tue);
    await a.getLink('tue');
    await a.cancel('tue', '2026-11-10', null);
    await a.undoCancel('tue', '2026-11-10');
    await a.closeThrough('tue', '2026-11-10');
    await a.resetLink('tue');
    await a.listWaiting('tue', '2026-11-10');
    await a.view('abc');
    expect(flags.calls).toEqual([
      'upsertLink:tue',
      'getLink:tue',
      'cancel:tue:2026-11-10',
      'undoCancel:tue:2026-11-10',
      'closeThrough:tue:2026-11-10',
      'resetLink:tue',
      'listWaiting:tue:2026-11-10',
      'view',
    ]);
  });
});
```

Create `src/sync/attendance/remote.wire.test.ts`:

```typescript
// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { isRemoteError } from '../remote';
import { linkRow } from './links';
import { supabaseAttendanceRemote } from './remote';

const OWNER = '0a1b2c3d-0000-4000-8000-00000000000a';
const ROW = linkRow({ id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Hall', courts: 3 }, 'Asia/Manila');

interface Seen {
  method: string;
  url: URL;
  headers: Headers;
  body: string | undefined;
}
let seen: Seen[];
let reply: (request: Seen, index: number) => Response;

/** The real Supabase client, with the network replaced: what the adapter really sends. */
function realRemote() {
  const fetchStub: typeof fetch = async (input, init) => {
    const request = new Request(input as string, init);
    const entry: Seen = {
      method: request.method,
      url: new URL(request.url),
      headers: request.headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    seen.push(entry);
    return reply(entry, seen.length - 1);
  };
  const client = createClient('http://localhost:54321', 'sb_publishable_test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchStub },
  });
  return supabaseAttendanceRemote(client, OWNER);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  seen = [];
  reply = () => json(200, []);
});

describe('what the attendance remote sends', () => {
  it('upserts the link on owner and slot, with no code and no closed date', async () => {
    reply = () => new Response(null, { status: 201 });
    await realRemote().upsertLink(ROW);
    const [call] = seen;
    expect(call.method).toBe('POST');
    expect(call.url.pathname).toBe('/rest/v1/attendance_links');
    expect(call.url.searchParams.get('on_conflict')).toBe('owner_id,slot_id');
    expect(call.headers.get('prefer')).toContain('resolution=merge-duplicates');
    const body = JSON.parse(call.body!);
    expect(body).toEqual({ owner_id: OWNER, ...ROW });
    expect(body).not.toHaveProperty('code');
    expect(body).not.toHaveProperty('closed_through');
  });

  it('reads one link by slot, asking for the code and the closed date only', async () => {
    reply = () => json(200, [{ code: 'abc', closed_through: '2026-11-10' }]);
    expect(await realRemote().getLink('tue')).toEqual({ code: 'abc', closedThrough: '2026-11-10' });
    const { method, url } = seen[0];
    expect(method).toBe('GET');
    expect(url.pathname).toBe('/rest/v1/attendance_links');
    expect(url.searchParams.get('select')).toBe('code,closed_through');
    expect(url.searchParams.get('slot_id')).toBe('eq.tue');
  });

  it('reads no link as null', async () => {
    reply = () => json(200, []);
    expect(await realRemote().getLink('tue')).toBeNull();
  });

  it('asks the database function for the view, by code', async () => {
    const view = { title: 'Tuesday open play', play_date: '2026-11-10' };
    reply = () => json(200, view);
    expect(await realRemote().view('abc123')).toEqual(view);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url.pathname).toBe('/rest/v1/rpc/attendance_view');
    expect(JSON.parse(seen[0].body!)).toEqual({ p_code: 'abc123' });
  });

  it('reads an unknown code as null', async () => {
    reply = () => json(200, null);
    expect(await realRemote().view('nope')).toBeNull();
  });

  it('lists the pending names for a slot and date, oldest first', async () => {
    reply = () => json(200, [{ id: 'g1', name: 'Zed', brought_by: null }, { id: 'g2', name: 'Fay', brought_by: 'p1' }]);
    expect(await realRemote().listWaiting('tue', '2026-11-10')).toEqual([
      { id: 'g1', name: 'Zed', broughtBy: null },
      { id: 'g2', name: 'Fay', broughtBy: 'p1' },
    ]);
    const { method, url } = seen[0];
    expect(method).toBe('GET');
    expect(url.pathname).toBe('/rest/v1/attendance_guests');
    expect(url.searchParams.get('select')).toBe('id,name,brought_by');
    expect(url.searchParams.get('slot_id')).toBe('eq.tue');
    expect(url.searchParams.get('play_date')).toBe('eq.2026-11-10');
    expect(url.searchParams.get('state')).toBe('eq.pending');
    expect(url.searchParams.get('order')).toBe('created_at.asc');
  });

  it('resets the link through the database function and returns the new code', async () => {
    reply = () => json(200, 'newcode0123456789abcdef');
    expect(await realRemote().resetLink('tue')).toBe('newcode0123456789abcdef');
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url.pathname).toBe('/rest/v1/rpc/reset_attendance_link');
    expect(JSON.parse(seen[0].body!)).toEqual({ p_slot_id: 'tue' });
  });

  it('reads a reset with no link as null', async () => {
    reply = () => json(200, null);
    expect(await realRemote().resetLink('tue')).toBeNull();
  });

  it('cancels by deleting any row for the date, then inserting one', async () => {
    reply = (_r, i) => (i === 0 ? new Response(null, { status: 204 }) : new Response(null, { status: 201 }));
    await realRemote().cancel('tue', '2026-11-10', 'Rain');
    expect(seen).toHaveLength(2);
    const [del, ins] = seen;
    expect(del.method).toBe('DELETE');
    expect(del.url.pathname).toBe('/rest/v1/attendance_cancellations');
    expect(del.url.searchParams.get('slot_id')).toBe('eq.tue');
    expect(del.url.searchParams.get('play_date')).toBe('eq.2026-11-10');
    expect(ins.method).toBe('POST');
    expect(ins.url.pathname).toBe('/rest/v1/attendance_cancellations');
    expect(ins.url.searchParams.get('on_conflict')).toBeNull();
    expect(ins.headers.get('prefer') ?? '').not.toContain('merge-duplicates');
    expect(JSON.parse(ins.body!)).toEqual({ owner_id: OWNER, slot_id: 'tue', play_date: '2026-11-10', reason: 'Rain' });
  });

  it('writes an empty reason as null', async () => {
    reply = () => new Response(null, { status: 204 });
    await realRemote().cancel('tue', '2026-11-10', '   ');
    expect(JSON.parse(seen[1].body!).reason).toBeNull();
  });

  it('undoes a cancellation by deleting the row for the date', async () => {
    reply = () => new Response(null, { status: 204 });
    await realRemote().undoCancel('tue', '2026-11-10');
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('DELETE');
    expect(seen[0].url.pathname).toBe('/rest/v1/attendance_cancellations');
    expect(seen[0].url.searchParams.get('slot_id')).toBe('eq.tue');
    expect(seen[0].url.searchParams.get('play_date')).toBe('eq.2026-11-10');
  });

  it('closes a date with an update that only moves forward', async () => {
    reply = () => new Response(null, { status: 204 });
    await realRemote().closeThrough('tue', '2026-11-10');
    const { method, url, body } = seen[0];
    expect(method).toBe('PATCH');
    expect(url.pathname).toBe('/rest/v1/attendance_links');
    expect(url.searchParams.get('slot_id')).toBe('eq.tue');
    expect(url.searchParams.get('or')).toBe('(closed_through.is.null,closed_through.lt.2026-11-10)');
    expect(JSON.parse(body!)).toEqual({ closed_through: '2026-11-10' });
  });

  it('turns a dropped connection into an offline error', async () => {
    reply = () => {
      throw new TypeError('Failed to fetch');
    };
    const error = await realRemote().upsertLink(ROW).catch((e: unknown) => e);
    expect(isRemoteError(error) && error.kind).toBe('offline');
  });

  it('turns a rejected session into an auth error, for a read, a write and a function call', async () => {
    reply = () => json(401, { code: 'PGRST301', message: 'JWT expired' });
    for (const call of [
      (r: ReturnType<typeof realRemote>) => r.getLink('tue'),
      (r: ReturnType<typeof realRemote>) => r.upsertLink(ROW),
      (r: ReturnType<typeof realRemote>) => r.view('abc'),
      (r: ReturnType<typeof realRemote>) => r.closeThrough('tue', '2026-11-10'),
    ]) {
      const error = await call(realRemote()).catch((e: unknown) => e);
      expect(isRemoteError(error) && error.kind).toBe('auth');
    }
  });

  it('turns any other failure into a server error', async () => {
    reply = () => json(500, { code: 'XX000', message: 'boom' });
    const error = await realRemote().listWaiting('tue', '2026-11-10').catch((e: unknown) => e);
    expect(isRemoteError(error) && error.kind).toBe('server');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/sync/attendance/remote.test.ts src/sync/attendance/remote.wire.test.ts`

Expected: it fails. Test Files `2 failed (2)`, Tests `no tests`.

- [ ] **Step 3: Write the code**

Create `src/sync/attendance/fakeRemote.ts`:

```typescript
import type { PGlite } from '@electric-sql/pglite';
import { run } from '../db/harness';
import { RemoteError } from '../remote';
import type { AttendanceRemote } from './remote';
import type { AttendanceViewData } from './types';

/** Switches and a log a test holds on to. */
export interface FakeFlags {
  /** While true, every request fails the way a request with no connection does. */
  offline: boolean;
  /** What the remote was asked, in order, as `method` or `method:detail`. */
  calls: string[];
}

/**
 * A stand-in for the real server, for tests: the same operations as real SQL, run as the organizer `user` on the
 * in-memory Postgres from `createDb()`, so the migration's rules (row-level security, grants, checks) really apply.
 * A refused statement becomes a `RemoteError('server')`, as a refused request does.
 */
export function fakeAttendanceRemote(db: PGlite, user: string, flags: FakeFlags = { offline: false, calls: [] }): AttendanceRemote {
  const sql = async (call: string | null, text: string, params: unknown[] = []) => {
    if (call) flags.calls.push(call);
    if (flags.offline) throw new RemoteError('offline');
    try {
      return (await run(db, { user }, text, params)).rows as Record<string, unknown>[];
    } catch {
      throw new RemoteError('server');
    }
  };
  return {
    async getLink(slotId) {
      const rows = await sql(`getLink:${slotId}`, 'select code, closed_through::text as closed_through from public.attendance_links where slot_id = $1', [slotId]);
      return rows[0] ? { code: String(rows[0].code), closedThrough: (rows[0].closed_through as string | null) ?? null } : null;
    },
    async upsertLink(row) {
      await sql(
        `upsertLink:${row.slot_id}`,
        `insert into public.attendance_links (owner_id, slot_id, title, weekday, start_min, end_min, venue, courts, timezone)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (owner_id, slot_id) do update set title = excluded.title, weekday = excluded.weekday,
           start_min = excluded.start_min, end_min = excluded.end_min, venue = excluded.venue, courts = excluded.courts,
           timezone = excluded.timezone`,
        [user, row.slot_id, row.title, row.weekday, row.start_min, row.end_min, row.venue, row.courts, row.timezone],
      );
    },
    async view(code) {
      const rows = await sql('view', 'select public.attendance_view($1) as v', [code]);
      return (rows[0]?.v as AttendanceViewData | null) ?? null;
    },
    async listWaiting(slotId, playDate) {
      const rows = await sql(
        `listWaiting:${slotId}:${playDate}`,
        `select id, name, brought_by from public.attendance_guests
         where slot_id = $1 and play_date = $2::date and state = 'pending' order by created_at, id`,
        [slotId, playDate],
      );
      return rows.map((g) => ({ id: String(g.id), name: String(g.name), broughtBy: (g.brought_by as string | null) ?? null }));
    },
    async resetLink(slotId) {
      const rows = await sql(`resetLink:${slotId}`, 'select public.reset_attendance_link($1) as code', [slotId]);
      return typeof rows[0]?.code === 'string' ? rows[0].code : null;
    },
    async cancel(slotId, playDate, reason) {
      await sql(`cancel:${slotId}:${playDate}`, 'delete from public.attendance_cancellations where slot_id = $1 and play_date = $2::date', [slotId, playDate]);
      await sql(
        null,
        'insert into public.attendance_cancellations (owner_id, slot_id, play_date, reason) values ($1, $2, $3::date, $4)',
        [user, slotId, playDate, reason?.trim() || null],
      );
    },
    async undoCancel(slotId, playDate) {
      await sql(`undoCancel:${slotId}:${playDate}`, 'delete from public.attendance_cancellations where slot_id = $1 and play_date = $2::date', [slotId, playDate]);
    },
    async closeThrough(slotId, date) {
      await sql(
        `closeThrough:${slotId}:${date}`,
        `update public.attendance_links set closed_through = $2::date
         where slot_id = $1 and (closed_through is null or closed_through < $2::date)`,
        [slotId, date],
      );
    },
  };
}
```

Create `src/sync/attendance/remote.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { fail } from '../remote';
import type { AttendanceViewData, LinkRow, WaitingName } from './types';

/** What the organizer's attendance link asks of the server. Every method throws a `RemoteError` when it fails. */
export interface AttendanceRemote {
  /** The link of this slot, or null when there is none. */
  getLink(slotId: string): Promise<{ code: string; closedThrough: string | null } | null>;
  /** Creates the link, or updates what the slot shows. Never sends or changes the code or the closed date. */
  upsertLink(row: LinkRow): Promise<void>;
  /** What the public page shows for a code, or null for an unknown code. */
  view(code: string): Promise<AttendanceViewData | null>;
  /** Names waiting for the organizer on a date. Pending ones only. */
  listWaiting(slotId: string, playDate: string): Promise<WaitingName[]>;
  /** A new code for the slot's link, or null when there is no link. */
  resetLink(slotId: string): Promise<string | null>;
  /** Cancels a date, replacing any earlier cancellation and its reason. */
  cancel(slotId: string, playDate: string, reason: string | null): Promise<void>;
  undoCancel(slotId: string, playDate: string): Promise<void>;
  /** Closes the link through a date. Only ever moves forward. */
  closeThrough(slotId: string, date: string): Promise<void>;
}

/** The real server, as the signed-in organizer `ownerId`. */
export function supabaseAttendanceRemote(client: SupabaseClient, ownerId: string): AttendanceRemote {
  return {
    async getLink(slotId) {
      const { data, error, status } = await client.from('attendance_links').select('code,closed_through').eq('slot_id', slotId).maybeSingle();
      if (error) fail(error, status);
      return data ? { code: String(data.code), closedThrough: (data.closed_through as string | null) ?? null } : null;
    },
    async upsertLink(row) {
      const { error, status } = await client.from('attendance_links').upsert({ owner_id: ownerId, ...row }, { onConflict: 'owner_id,slot_id' });
      if (error) fail(error, status);
    },
    async view(code) {
      const { data, error, status } = await client.rpc('attendance_view', { p_code: code });
      if (error) fail(error, status);
      return (data as AttendanceViewData | null) ?? null;
    },
    async listWaiting(slotId, playDate) {
      const { data, error, status } = await client
        .from('attendance_guests')
        .select('id,name,brought_by')
        .eq('slot_id', slotId)
        .eq('play_date', playDate)
        .eq('state', 'pending')
        .order('created_at', { ascending: true });
      if (error) fail(error, status);
      return (data ?? []).map((g) => ({ id: String(g.id), name: String(g.name), broughtBy: (g.brought_by as string | null) ?? null }));
    },
    async resetLink(slotId) {
      const { data, error, status } = await client.rpc('reset_attendance_link', { p_slot_id: slotId });
      if (error) fail(error, status);
      return typeof data === 'string' ? data : null;
    },
    async cancel(slotId, playDate, reason) {
      // The database lets an organizer delete and insert a cancellation but not update one, so this is not an upsert.
      const removed = await client.from('attendance_cancellations').delete().eq('slot_id', slotId).eq('play_date', playDate);
      if (removed.error) fail(removed.error, removed.status);
      const { error, status } = await client
        .from('attendance_cancellations')
        .insert({ owner_id: ownerId, slot_id: slotId, play_date: playDate, reason: reason?.trim() || null });
      if (error) fail(error, status);
    },
    async undoCancel(slotId, playDate) {
      const { error, status } = await client.from('attendance_cancellations').delete().eq('slot_id', slotId).eq('play_date', playDate);
      if (error) fail(error, status);
    },
    async closeThrough(slotId, date) {
      const { error, status } = await client
        .from('attendance_links')
        .update({ closed_through: date })
        .eq('slot_id', slotId)
        .or(`closed_through.is.null,closed_through.lt.${date}`);
      if (error) fail(error, status);
    },
  };
}
```

Apply this patch to `src/sync/remote.ts`:

```diff
diff --git a/src/sync/remote.ts b/src/sync/remote.ts
index 7088e16..abda3a6 100644
--- a/src/sync/remote.ts
+++ b/src/sync/remote.ts
@@ -52,7 +52,7 @@ interface Failure {
 const NETWORK = /failed to fetch|network|load failed|fetch failed/i;
 
 /** Turns a failed request into a `RemoteError`. Status 0 is how supabase-js reports a request that never arrived. */
-function fail(error: Failure, status?: number): never {
+export function fail(error: Failure, status?: number): never {
   const code = status ?? error.status;
   const offline = code === 0 || NETWORK.test(error.message ?? '') || (typeof navigator !== 'undefined' && navigator.onLine === false);
   throw new RemoteError(offline ? 'offline' : code === 401 || error.code === 'PGRST301' ? 'auth' : 'server');
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/sync/attendance/remote.test.ts src/sync/attendance/remote.wire.test.ts`

Expected: it passes. Test Files `2 passed (2)`, Tests `36 passed (36)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 1585 tests across 124 files.

- [ ] **Step 5: Commit**

```bash
git add src/sync/attendance/remote.test.ts src/sync/attendance/remote.wire.test.ts src/sync/attendance/fakeRemote.ts src/sync/attendance/remote.ts src/sync/remote.ts
git commit -m "Add the attendance remote: real client, in-memory version and request shape tests"
```

---

### Task 3: Remember which slot a session started from

A session gets an optional `slotId`, so ending it knows which link to close. It is kept by the session saver, set by `createSession`, and passed by Who's playing when a session starts from a slot. A one-off session has none.

**Files:**
- Modify: `src/engine/session.ts`
- Modify: `src/engine/types.ts`
- Modify: `src/store/persistence.ts`
- Modify: `src/ui/SetupScreen.tsx`
- Modify: `src/engine/session.test.ts`
- Modify: `src/store/persistence.test.ts`
- Modify: `src/ui/homeWiring.test.tsx`

- [ ] **Step 1: Write the failing tests**

Apply this patch to `src/engine/session.test.ts`:

```diff
diff --git a/src/engine/session.test.ts b/src/engine/session.test.ts
index e233e1d..ceba0d7 100644
--- a/src/engine/session.test.ts
+++ b/src/engine/session.test.ts
@@ -12,6 +12,13 @@ describe('createSession', () => {
     expect('weekday' in createSession({ name: 'x', mode: 'fairness', courtCount: 1, players: [] }, makeCtx())).toBe(false);
   });
 
+  it('remembers the slot it started from, and leaves the field off when there is none', () => {
+    const make = (slotId?: string) => createSession({ name: 'x', mode: 'fairness', courtCount: 1, players: [], slotId }, makeCtx());
+    expect(make('tue').slotId).toBe('tue');
+    expect('slotId' in make()).toBe(false);
+    expect('slotId' in make('')).toBe(false);
+  });
+
   it('creates numbered empty courts when there are fewer than 4 players', () => {
     const s = newTestSession(['Ann', 'Ben', 'Cy'], { courts: 2 });
     expect(s.courts.map((c) => [c.number, c.status])).toEqual([
```

Apply this patch to `src/store/persistence.test.ts`:

```diff
diff --git a/src/store/persistence.test.ts b/src/store/persistence.test.ts
index 7459104..ef10bef 100644
--- a/src/store/persistence.test.ts
+++ b/src/store/persistence.test.ts
@@ -225,3 +225,29 @@ describe('persisted weekday', () => {
     }
   });
 });
+
+describe('persisted slot id', () => {
+  const store = (session: unknown) =>
+    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, session, undoStack: [] }));
+
+  it('keeps the slot a session started from, through a save and a load', () => {
+    const s = newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }, makeCtx());
+    savePersisted({ session: { ...s, slotId: 'tue' }, undoStack: [] });
+    expect(loadPersisted()?.session?.slotId).toBe('tue');
+  });
+
+  it('loads sessions saved without one', () => {
+    const s = newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }, makeCtx());
+    store(s);
+    expect(loadPersisted()?.session).toEqual(s);
+    expect(loadPersisted()?.session).not.toHaveProperty('slotId');
+  });
+
+  it('rejects a slot id that is not a string', () => {
+    const s = newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }, makeCtx());
+    for (const bad of [5, null, {}, ['tue'], true]) {
+      store({ ...s, slotId: bad });
+      expect(loadPersisted()).toBeNull();
+    }
+  });
+});
```

Apply this patch to `src/ui/homeWiring.test.tsx`:

```diff
diff --git a/src/ui/homeWiring.test.tsx b/src/ui/homeWiring.test.tsx
index 2026083..338383a 100644
--- a/src/ui/homeWiring.test.tsx
+++ b/src/ui/homeWiring.test.tsx
@@ -121,6 +121,16 @@ describe('Home is the landing screen', () => {
     expect(s.plannedEndAt).toBe(timestampAt(1260, FRIDAY.getTime()));
   });
 
+  it('remembers the slot the session started from', async () => {
+    useSlotsStore.setState({ slots: [{ id: 'thu', weekday: 4 }] });
+    const user = setup();
+    render(<App />);
+    await startThursday(user);
+    await user.type(box(), four);
+    await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
+    expect(useSessionStore.getState().session!.slotId).toBe('thu');
+  });
+
   it('uses this time only values for the session and then forgets them', async () => {
     useSlotsStore.setState({ slots: [{ id: 'thu', weekday: 4, venue: 'Hall A' }], tonight: { thu: { venue: 'Park' } } });
     const user = setup();
@@ -142,6 +152,7 @@ describe('Home is the landing screen', () => {
     expect(s.name).toBe('Friday open play');
     expect(s).not.toHaveProperty('venue');
     expect(s).not.toHaveProperty('plannedEndAt');
+    expect(s).not.toHaveProperty('slotId');
   });
 
   it('uses the slot’s weekday for the regulars shortcut, not today’s', async () => {
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/engine/session.test.ts src/store/persistence.test.ts src/ui/homeWiring.test.tsx`

Expected: it fails. Test Files `3 failed (3)`, Tests `3 failed | 61 passed (64)`.

- [ ] **Step 3: Write the code**

Apply this patch to `src/engine/session.ts`:

```diff
diff --git a/src/engine/session.ts b/src/engine/session.ts
index fb1e779..da2e407 100644
--- a/src/engine/session.ts
+++ b/src/engine/session.ts
@@ -60,6 +60,7 @@ export function createSession(input: NewSessionInput, ctx: Ctx): Session {
     ...(venue ? { venue } : {}),
     ...(input.plannedEndAt === undefined ? {} : { plannedEndAt: input.plannedEndAt }),
     ...(isWeekday(input.weekday) ? { weekday: input.weekday } : {}),
+    ...(input.slotId ? { slotId: input.slotId } : {}),
   };
   // Players are inserted first and courts filled once, so a whole group starts together.
   for (const p of input.players) insertPlayer(s, p, ctx);
```

Apply this patch to `src/engine/types.ts`:

```diff
diff --git a/src/engine/types.ts b/src/engine/types.ts
index 54537d1..3dee9a9 100644
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -81,6 +81,8 @@ export interface Session {
   createdAt: number;
   /** The slot's weekday, 0 Sunday to 6 Saturday. A slot can start on any day, so this can differ from createdAt. */
   weekday?: number;
+  /** The slot this session started from, so its attendance link can be closed when the session ends. */
+  slotId?: string;
   endedAt?: number;
   /**
    * False means every game waits for the organizer's Start. Missing or true means games start by themselves, which is
@@ -119,4 +121,6 @@ export interface NewSessionInput {
   plannedEndAt?: number;
   /** The slot's weekday, 0 Sunday to 6 Saturday. */
   weekday?: number;
+  /** The slot this session started from. A one-off session has none. */
+  slotId?: string;
 }
```

Apply this patch to `src/store/persistence.ts`:

```diff
diff --git a/src/store/persistence.ts b/src/store/persistence.ts
index 1c938bd..bbb6f31 100644
--- a/src/store/persistence.ts
+++ b/src/store/persistence.ts
@@ -77,6 +77,7 @@ function isSession(x: unknown): x is Session {
     isNum(x.gameSeq) &&
     isNum(x.createdAt) &&
     (x.weekday === undefined || (typeof x.weekday === 'number' && Number.isInteger(x.weekday) && x.weekday >= 0 && x.weekday <= 6)) &&
+    (x.slotId === undefined || typeof x.slotId === 'string') &&
     (x.venue === undefined || typeof x.venue === 'string') &&
     (x.plannedEndAt === undefined || isNum(x.plannedEndAt)) &&
     (x.pinned === undefined || (Array.isArray(x.pinned) && x.pinned.every((id) => typeof id === 'string')))
```

Apply this patch to `src/ui/SetupScreen.tsx`:

```diff
diff --git a/src/ui/SetupScreen.tsx b/src/ui/SetupScreen.tsx
index 5364445..3eb5817 100644
--- a/src/ui/SetupScreen.tsx
+++ b/src/ui/SetupScreen.tsx
@@ -143,6 +143,7 @@ export function SetupScreen({ onManage, plan, onBack }: Props) {
       venue: plan?.venue,
       plannedEndAt: plan?.plannedEndAt,
       weekday: plan?.weekday,
+      slotId: plan?.slotId,
     });
     if (res.ok) {
       setNumPref(COURTS_KEY, courtCount);
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/engine/session.test.ts src/store/persistence.test.ts src/ui/homeWiring.test.tsx`

Expected: it passes. Test Files `3 passed (3)`, Tests `64 passed (64)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 1590 tests across 124 files.

- [ ] **Step 5: Commit**

```bash
git add src/engine/session.test.ts src/store/persistence.test.ts src/ui/homeWiring.test.tsx src/engine/session.ts src/engine/types.ts src/store/persistence.ts src/ui/SetupScreen.tsx
git commit -m "Remember which slot a session started from"
```

---

### Task 4: The store: cache, refresh, reset, cancel, close and slot sync

The store behind the card. It keeps the last good copy on the device (tied to one account, ignored when another account signs in), refreshes the answers, creates and resets links, cancels and undoes a week, closes a date (queued when it cannot be sent), and keeps a link's details in step with its slot. `startAttendanceSync` watches the slots and the account. "Clear saved players on this device" and "Delete all my data" also clear the copy.

**Files:**
- Create: `src/sync/attendance/start.ts`
- Create: `src/sync/attendance/store.ts`
- Modify: `src/sync/dataActions.ts`
- Create: `src/sync/attendance/start.test.ts`
- Create: `src/sync/attendance/store.test.ts`
- Modify: `src/sync/dataActions.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/sync/attendance/start.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SLOTS, useSlotsStore } from '../../store/slots';
import { useAuthStore } from '../auth';
import type { AttendanceRemote } from './remote';
import { startAttendanceSync } from './start';
import { ATTENDANCE_KEY, resetAttendanceDeps, setAttendanceDeps, useAttendanceStore } from './store';

const USER = '0a1b2c3d-0000-4000-8000-00000000000a';
const OTHER = '0a1b2c3d-0000-4000-8000-00000000000b';

let upserts: { slot_id: string; venue: string | null; start_min: number | null; title: string }[];
let stop: () => void;

/** A remote that only notes what it is asked. The store keeps the rest. */
const remote = (): AttendanceRemote => ({
  getLink: async () => null,
  upsertLink: async (row) => void upserts.push(row),
  view: async () => null,
  listWaiting: async () => [],
  resetLink: async () => null,
  cancel: async () => undefined,
  undoCancel: async () => undefined,
  closeThrough: async () => undefined,
});

const seedCache = (userId: string) =>
  useAttendanceStore.setState({
    ownerId: userId,
    links: { tue: { code: 'c1' } },
    summaries: {},
    lastChange: {},
    lastError: {},
    pendingClose: [{ slotId: 'tue', date: '2026-11-10' }],
  });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  upserts = [];
  useAuthStore.setState({ status: 'signedIn', userId: USER, email: 'a@b.c' });
  useSlotsStore.setState({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {} });
  useAttendanceStore.getState().clear();
  setAttendanceDeps({ server: () => ({ remote: remote(), userId: USER }), now: () => 0, timezone: () => 'Asia/Manila' });
});
afterEach(() => {
  stop?.();
  resetAttendanceDeps();
  vi.useRealTimers();
});

describe('sending slot changes to their link', () => {
  it('updates the link 800 ms after a slot is saved, once for several quick saves', async () => {
    seedCache(USER);
    stop = startAttendanceSync();
    useSlotsStore.getState().saveSlot('tue', { venue: 'Hall' });
    await vi.advanceTimersByTimeAsync(700);
    useSlotsStore.getState().saveSlot('tue', { venue: 'Park', startMin: 1140 });
    await vi.advanceTimersByTimeAsync(799);
    expect(upserts).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ slot_id: 'tue', venue: 'Park', start_min: 1140, title: 'Tuesday open play' });
  });

  it('does nothing for a slot with no link', async () => {
    seedCache(USER);
    stop = startAttendanceSync();
    useSlotsStore.getState().saveSlot('thu', { venue: 'Hall' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(upserts).toEqual([]);
  });

  it('sends each slot that changed, and only that slot', async () => {
    seedCache(USER);
    useAttendanceStore.setState({ links: { tue: { code: 'c1' }, thu: { code: 'c2' } } });
    stop = startAttendanceSync();
    useSlotsStore.getState().saveSlot('tue', { courts: 2 });
    useSlotsStore.getState().saveSlot('thu', { courts: 3 });
    await vi.advanceTimersByTimeAsync(800);
    expect(upserts.map((u) => u.slot_id).sort()).toEqual(['thu', 'tue']);
  });

  it('never sends a this time only edit', async () => {
    seedCache(USER);
    stop = startAttendanceSync();
    useSlotsStore.getState().setTonight('tue', { venue: 'Elsewhere' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(upserts).toEqual([]);
  });

  it('does not send when saving changed nothing, or when only venues were added', async () => {
    seedCache(USER);
    stop = startAttendanceSync();
    useSlotsStore.getState().saveSlot('tue', {});
    useSlotsStore.getState().addVenue('New venue');
    await vi.advanceTimersByTimeAsync(2000);
    expect(upserts).toEqual([]);
  });

  it('stops when torn down, and drops a change still waiting', async () => {
    seedCache(USER);
    stop = startAttendanceSync();
    useSlotsStore.getState().saveSlot('tue', { venue: 'Hall' });
    stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(upserts).toEqual([]);
    useSlotsStore.getState().saveSlot('tue', { venue: 'Park' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(upserts).toEqual([]);
  });

  it('uses the delay it is given', async () => {
    seedCache(USER);
    stop = startAttendanceSync(50);
    useSlotsStore.getState().saveSlot('tue', { venue: 'Hall' });
    await vi.advanceTimersByTimeAsync(50);
    expect(upserts).toHaveLength(1);
  });
});

describe('clearing with the account', () => {
  it('clears when the organizer signs out', () => {
    seedCache(USER);
    stop = startAttendanceSync();
    expect(useAttendanceStore.getState().links.tue).toBeDefined();
    useAuthStore.setState({ status: 'signedOut', userId: null, email: null });
    expect(useAttendanceStore.getState()).toMatchObject({ ownerId: null, links: {}, pendingClose: [] });
    expect(localStorage.getItem(ATTENDANCE_KEY)).toBeNull();
  });

  it('clears when a different account signs in', () => {
    seedCache(USER);
    useAuthStore.setState({ status: 'loading', userId: null });
    stop = startAttendanceSync();
    useAuthStore.setState({ status: 'signedIn', userId: OTHER });
    expect(useAttendanceStore.getState()).toMatchObject({ ownerId: null, links: {}, pendingClose: [] });
  });

  it('clears at start when a saved copy belongs to a different account', () => {
    seedCache(USER);
    useAuthStore.setState({ status: 'signedIn', userId: OTHER });
    stop = startAttendanceSync();
    expect(useAttendanceStore.getState().links).toEqual({});
  });

  it('keeps the copy for the same account, while loading, and when the sign-in cannot be checked', () => {
    seedCache(USER);
    useAuthStore.setState({ status: 'loading', userId: null });
    stop = startAttendanceSync();
    expect(useAttendanceStore.getState().links.tue).toBeDefined();
    useAuthStore.setState({ status: 'unknown', userId: null });
    expect(useAttendanceStore.getState().links.tue).toBeDefined();
    useAuthStore.setState({ status: 'signedIn', userId: USER });
    expect(useAttendanceStore.getState().links.tue).toBeDefined();
  });

  it('stops watching the account when torn down', () => {
    seedCache(USER);
    stop = startAttendanceSync();
    stop();
    useAuthStore.setState({ status: 'signedOut', userId: null, email: null });
    expect(useAttendanceStore.getState().links.tue).toBeDefined();
  });
});
```

Create `src/sync/attendance/store.test.ts`:

```typescript
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newTestSession } from '../../engine/testing';
import type { Session } from '../../engine';
import type { Slot } from '../../store/slots';
import { USER_A, USER_B, createDb, run } from '../db/harness';
import { RemoteError } from '../remote';
import { fakeAttendanceRemote, type FakeFlags } from './fakeRemote';
import type { AttendanceRemote } from './remote';
import { ATTENDANCE_KEY, parseAttendanceCache, resetAttendanceDeps, setAttendanceDeps, useAttendanceStore } from './store';

const ANA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const BEN2 = '33333333-3333-4333-8333-333333333333';
const TUE: Slot = { id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Hall', courts: 3 };
const THU: Slot = { id: 'thu', weekday: 4 };
const OFFLINE = 'No connection. Try again when you are online.';

let db: PGlite;
let flags: FakeFlags;
let now: number;
let zone: string;
let signedIn: string | null;
/** Wraps the real in-memory remote so a test can make single methods fail. */
let override: Partial<AttendanceRemote>;

beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec('truncate public.players, public.attendance_links cascade');
  await db.exec(`insert into public.players (owner_id, id, name) values
    ('${USER_A}', '${ANA}', 'Ana Reyes'), ('${USER_A}', '${BEN}', 'Ben Cruz')`);
  localStorage.clear();
  flags = { offline: false, calls: [] };
  now = Date.UTC(2026, 10, 9, 8, 0);
  zone = 'Asia/Manila';
  signedIn = USER_A;
  override = {};
  useAttendanceStore.getState().clear();
  setAttendanceDeps({
    server: () => {
      if (!signedIn) return null;
      const real = fakeAttendanceRemote(db, signedIn, flags);
      return { remote: { ...real, ...override }, userId: signedIn };
    },
    now: () => now,
    timezone: () => zone,
  });
});
afterEach(() => {
  resetAttendanceDeps();
  vi.restoreAllMocks();
});

const state = () => useAttendanceStore.getState();
const codeOf = async (slot = 'tue') =>
  (await db.query<{ code: string }>('select code from public.attendance_links where slot_id = $1', [slot])).rows[0]?.code;
const answerAs = (code: string, player: string, status: string, late = false) =>
  run(db, 'anon', 'select public.attendance_answer($1, $2, $3, $4)', [code, player, status, late]);
const guest = (code: string, name: string, by: string | null = null) =>
  run(db, 'anon', 'select public.attendance_add_guest($1, $2, $3)', [code, name, by]);
const closedThrough = async (slot = 'tue') =>
  (await db.query<{ d: string | null }>('select closed_through::text as d from public.attendance_links where slot_id = $1', [slot])).rows[0]?.d;
const cancellationRows = async () =>
  (await db.query<{ play_date: string; reason: string | null }>(
    'select play_date::text as play_date, reason from public.attendance_cancellations order by play_date',
  )).rows;
const sessionFrom = (slotId: string | undefined, createdAt: number): Session => ({
  ...newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }),
  createdAt,
  ...(slotId ? { slotId } : {}),
});
const cached = () => JSON.parse(localStorage.getItem(ATTENDANCE_KEY) ?? 'null');

describe('creating the link', () => {
  it('writes the link from the slot, remembers its code and loads the first summary', async () => {
    expect(await state().ensureLink(TUE)).toEqual({ ok: true });
    const code = await codeOf();
    expect(code).toMatch(/^[0-9a-f]{24}$/);
    expect(state().links).toEqual({ tue: { code } });
    expect(state().summaries.tue).toMatchObject({ slotId: 'tue', code, counts: { in: 0, maybe: 0, out: 0, late: 0 }, fetchedAt: now });
    expect(state().ownerId).toBe(USER_A);
    expect(state().busy.tue).toBeFalsy();
    const row = (await db.query('select title, weekday, start_min, end_min, venue, courts, timezone from public.attendance_links')).rows[0];
    expect(row).toEqual({ title: 'Tuesday open play', weekday: 2, start_min: 1140, end_min: 1260, venue: 'Hall', courts: 3, timezone: 'Asia/Manila' });
  });

  it('uses the device time zone when it is usable, and Asia/Manila when it is not', async () => {
    zone = 'Australia/Sydney';
    await state().ensureLink(TUE);
    expect((await db.query('select timezone from public.attendance_links')).rows[0]).toEqual({ timezone: 'Australia/Sydney' });
    await state().ensureLink(THU);
    zone = 'not a zone';
    await state().ensureLink({ ...THU, id: 'thu2' });
    expect((await db.query("select timezone from public.attendance_links where slot_id = 'thu2'")).rows[0]).toEqual({ timezone: 'Asia/Manila' });
  });

  it('is safe to press twice: one link, same code', async () => {
    await state().ensureLink(TUE);
    const code = await codeOf();
    await state().ensureLink(TUE);
    expect(await codeOf()).toBe(code);
    expect((await db.query('select count(*)::int as n from public.attendance_links')).rows[0]).toEqual({ n: 1 });
  });

  it('shows busy while it works', async () => {
    const seen: boolean[] = [];
    const unsubscribe = useAttendanceStore.subscribe((s) => seen.push(Boolean(s.busy.tue)));
    await state().ensureLink(TUE);
    unsubscribe();
    expect(seen).toContain(true);
    expect(seen.at(-1)).toBe(false);
  });
});

describe('refresh', () => {
  async function withAnswers() {
    await state().ensureLink(TUE);
    const code = (await codeOf())!;
    await answerAs(code, ANA, 'in', true);
    await answerAs(code, BEN, 'maybe');
    await guest(code, 'Zed', ANA);
    await guest(code, 'Newbie');
    return code;
  }

  it('reads the counts, the friends, the waiting names and the names', async () => {
    await withAnswers();
    now += 5000;
    expect(await state().refresh('tue')).toEqual({ ok: true });
    const s = state().summaries.tue;
    expect(s.counts).toEqual({ in: 1, maybe: 1, out: 0, late: 1 });
    expect(s.friends).toBe(1);
    expect(s.waiting.map((w) => w.name).sort()).toEqual(['Newbie', 'Zed']);
    expect(s.names).toEqual({ [ANA]: 'Ana', [BEN]: 'Ben' });
    expect(s.fetchedAt).toBe(now);
    expect(state().lastError.tue).toBeNull();
  });

  it('keeps the cached summary when the request fails offline, and says why', async () => {
    await withAnswers();
    await state().refresh('tue');
    const before = state().summaries.tue;
    flags.offline = true;
    now += 60_000;
    const result = await state().refresh('tue');
    expect(result).toEqual({ ok: false, message: OFFLINE });
    expect(state().summaries.tue).toBe(before);
    expect(state().lastError.tue).toBe('offline');
    flags.offline = false;
    expect(await state().refresh('tue')).toEqual({ ok: true });
    expect(state().lastError.tue).toBeNull();
    expect(state().summaries.tue.fetchedAt).toBe(now);
  });

  it('keeps the cache and records an auth or server failure', async () => {
    await withAnswers();
    const before = state().summaries.tue;
    override = { view: async () => { throw new RemoteError('auth'); } };
    expect((await state().refresh('tue')).ok).toBe(false);
    expect(state().lastError.tue).toBe('auth');
    override = { view: async () => { throw new RemoteError('server'); } };
    expect((await state().refresh('tue')).ok).toBe(false);
    expect(state().lastError.tue).toBe('server');
    expect(state().summaries.tue).toBe(before);
  });

  it('finds a link made on another device', async () => {
    await run(db, { user: USER_A }, "insert into public.attendance_links (slot_id, title, weekday) values ('tue', 'Tuesday open play', 2)");
    expect(state().links.tue).toBeUndefined();
    await state().refresh('tue');
    expect(state().links.tue.code).toBe(await codeOf());
    expect(state().summaries.tue).toBeDefined();
  });

  it('leaves a slot with no link without a summary or an error', async () => {
    expect(await state().refresh('thu')).toEqual({ ok: true });
    expect(state().links.thu).toBeUndefined();
    expect(state().summaries.thu).toBeUndefined();
    expect(state().lastError.thu ?? null).toBeNull();
  });

  it('picks up a code reset on another device', async () => {
    await state().ensureLink(TUE);
    const staleCode = state().links.tue.code;
    const other = fakeAttendanceRemote(db, USER_A);
    const fresh = (await other.resetLink('tue'))!;
    await state().refresh('tue');
    expect(state().links.tue.code).toBe(fresh);
    expect(state().links.tue.code).not.toBe(staleCode);
    expect(state().summaries.tue.code).toBe(fresh);
  });

  it('drops the link when it no longer exists on the server', async () => {
    await state().ensureLink(TUE);
    await db.exec('truncate public.attendance_links cascade');
    await state().refresh('tue');
    expect(state().links.tue).toBeUndefined();
    expect(state().summaries.tue).toBeUndefined();
  });

  it('does nothing and changes nothing when nobody is signed in', async () => {
    await state().ensureLink(TUE);
    const before = state().summaries.tue;
    signedIn = null;
    flags.calls.length = 0;
    const result = await state().refresh('tue');
    expect(result.ok).toBe(false);
    expect(flags.calls).toEqual([]);
    expect(state().summaries.tue).toBe(before);
    expect(state().lastError.tue ?? null).toBeNull();
  });

  it('ignores a result that arrives after the cache was cleared', async () => {
    await state().ensureLink(TUE);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const real = fakeAttendanceRemote(db, USER_A);
    override = { view: async (code) => { await gate; return real.view(code); } };
    const pending = state().refresh('tue');
    state().clear();
    release();
    await pending;
    expect(state().summaries).toEqual({});
    expect(state().links).toEqual({});
  });
});

describe('the last change', () => {
  it('names the latest answer that changed, with the time', async () => {
    await state().ensureLink(TUE);
    const code = (await codeOf())!;
    await answerAs(code, ANA, 'in');
    await answerAs(code, BEN, 'in');
    await state().refresh('tue');
    expect(state().lastChange.tue ?? null).toBeNull();
    await answerAs(code, BEN, 'out');
    now += 1000;
    await state().refresh('tue');
    expect(state().lastChange.tue).toEqual({ player: 'Ben', from: 'in', to: 'out', at: now });
  });

  it('keeps the last change when later refreshes find none', async () => {
    await state().ensureLink(TUE);
    const code = (await codeOf())!;
    await answerAs(code, BEN, 'in');
    await state().refresh('tue');
    await answerAs(code, BEN, 'maybe');
    await state().refresh('tue');
    const note = state().lastChange.tue;
    now += 60_000;
    await state().refresh('tue');
    expect(state().lastChange.tue).toEqual(note);
  });

  it('does not count a first answer as a change', async () => {
    await state().ensureLink(TUE);
    const code = (await codeOf())!;
    await state().refresh('tue');
    await answerAs(code, ANA, 'in');
    await state().refresh('tue');
    expect(state().lastChange.tue ?? null).toBeNull();
  });

  it('adds a last initial when two players share a first name', async () => {
    await db.exec(`insert into public.players (owner_id, id, name) values ('${USER_A}', '${BEN2}', 'Ben Dale')`);
    await state().ensureLink(TUE);
    const code = (await codeOf())!;
    await answerAs(code, BEN2, 'in');
    await state().refresh('tue');
    await answerAs(code, BEN2, 'out');
    await state().refresh('tue');
    expect(state().lastChange.tue?.player).toBe('Ben D.');
  });

  it('starts again when the link moves to a new date', async () => {
    await state().ensureLink(TUE);
    const code = (await codeOf())!;
    await answerAs(code, BEN, 'in');
    await state().refresh('tue');
    await answerAs(code, BEN, 'out');
    await state().refresh('tue');
    expect(state().lastChange.tue).not.toBeNull();
    const date = state().summaries.tue.playDate;
    await fakeAttendanceRemote(db, USER_A).closeThrough('tue', date);
    await state().refresh('tue');
    expect(state().summaries.tue.playDate).not.toBe(date);
    expect(state().lastChange.tue ?? null).toBeNull();
  });
});

describe('reset, cancel and undo', () => {
  it('resets to a new code, keeps the answers, and the old code stops working', async () => {
    await state().ensureLink(TUE);
    const old = (await codeOf())!;
    await answerAs(old, ANA, 'in');
    await state().refresh('tue');
    expect(await state().resetLink('tue')).toEqual({ ok: true });
    const fresh = (await codeOf())!;
    expect(fresh).not.toBe(old);
    expect(state().links.tue.code).toBe(fresh);
    expect(state().summaries.tue.code).toBe(fresh);
    expect(state().summaries.tue.counts.in).toBe(1);
    expect(await fakeAttendanceRemote(db, USER_A).view(old)).toBeNull();
  });

  it('says so when there is no link to reset', async () => {
    const result = await state().resetLink('tue');
    expect(result.ok).toBe(false);
  });

  it('cancels the date of the latest summary, then replaces the reason', async () => {
    await state().ensureLink(TUE);
    const date = state().summaries.tue.playDate;
    expect(await state().cancelWeek('tue', 'Rain')).toEqual({ ok: true });
    expect(await cancellationRows()).toEqual([{ play_date: date, reason: 'Rain' }]);
    expect(state().summaries.tue.cancelled).toEqual({ reason: 'Rain' });
    await state().cancelWeek('tue', 'Court closed');
    expect(await cancellationRows()).toEqual([{ play_date: date, reason: 'Court closed' }]);
    expect(state().summaries.tue.cancelled).toEqual({ reason: 'Court closed' });
  });

  it('trims the reason, keeps at most 140 characters, and stores none as null', async () => {
    await state().ensureLink(TUE);
    await state().cancelWeek('tue', `  ${'x'.repeat(200)}  `);
    expect((await cancellationRows())[0].reason).toBe('x'.repeat(140));
    await state().cancelWeek('tue', '   ');
    expect((await cancellationRows())[0].reason).toBeNull();
    expect(state().summaries.tue.cancelled).toEqual({ reason: null });
  });

  it('undoes a cancellation', async () => {
    await state().ensureLink(TUE);
    await state().cancelWeek('tue', 'Rain');
    expect(await state().undoCancel('tue')).toEqual({ ok: true });
    expect(await cancellationRows()).toEqual([]);
    expect(state().summaries.tue.cancelled).toBeNull();
  });

  it('refuses to cancel before the date is known', async () => {
    expect((await state().cancelWeek('tue', 'Rain')).ok).toBe(false);
    expect((await state().undoCancel('tue')).ok).toBe(false);
    expect(await cancellationRows()).toEqual([]);
  });

  it('shows busy only while a write runs', async () => {
    await state().ensureLink(TUE);
    const seen: boolean[] = [];
    const unsubscribe = useAttendanceStore.subscribe((s) => seen.push(Boolean(s.busy.tue)));
    await state().cancelWeek('tue', '');
    unsubscribe();
    expect(seen).toContain(true);
    expect(state().busy.tue).toBeFalsy();
  });
});

describe('writes with no connection', () => {
  it('say so and change nothing', async () => {
    await state().ensureLink(TUE);
    const before = { links: state().links, summaries: state().summaries, lastError: state().lastError, cache: localStorage.getItem(ATTENDANCE_KEY) };
    const codeBefore = await codeOf();
    flags.offline = true;
    for (const result of [
      await state().ensureLink({ ...TUE, venue: 'Elsewhere' }),
      await state().resetLink('tue'),
      await state().cancelWeek('tue', 'Rain'),
      await state().undoCancel('tue'),
    ]) {
      expect(result).toEqual({ ok: false, message: OFFLINE });
    }
    flags.offline = false;
    expect(state().links).toBe(before.links);
    expect(state().summaries).toBe(before.summaries);
    expect(state().lastError).toBe(before.lastError);
    expect(localStorage.getItem(ATTENDANCE_KEY)).toBe(before.cache);
    expect(await codeOf()).toBe(codeBefore);
    expect(await cancellationRows()).toEqual([]);
    expect((await db.query('select venue from public.attendance_links')).rows[0]).toEqual({ venue: 'Hall' });
  });

  it('are refused with a sign-in message when nobody is signed in', async () => {
    signedIn = null;
    for (const result of [
      await state().ensureLink(TUE),
      await state().resetLink('tue'),
      await state().cancelWeek('tue', ''),
      await state().undoCancel('tue'),
    ]) {
      expect(result.ok).toBe(false);
    }
    expect(flags.calls).toEqual([]);
  });
});

describe('closing a date when a session ends', () => {
  it('closes the link of the session slot through the date the session started, in the link zone', async () => {
    await state().ensureLink(TUE);
    // 9 Nov 23:30 UTC is already 10 Nov in Manila.
    const result = await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 9, 23, 30)));
    expect(result).toEqual({ ok: true });
    expect(await closedThrough()).toBe('2026-11-10');
    expect(state().pendingClose).toEqual([]);
  });

  it('uses the time zone of the device', async () => {
    zone = 'America/New_York';
    await state().ensureLink(TUE);
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 3, 0)));
    expect(await closedThrough()).toBe('2026-11-09');
  });

  it('touches only the slot of the session', async () => {
    await state().ensureLink(TUE);
    await state().ensureLink(THU);
    await state().closeForSession(sessionFrom('thu', Date.UTC(2026, 10, 12, 4, 0)));
    expect(await closedThrough('tue')).toBeNull();
    expect(await closedThrough('thu')).toBe('2026-11-12');
  });

  it('does nothing for a one-off session', async () => {
    await state().ensureLink(TUE);
    flags.calls.length = 0;
    expect(await state().closeForSession(sessionFrom(undefined, Date.UTC(2026, 10, 10)))).toEqual({ ok: true });
    expect(flags.calls).toEqual([]);
    expect(state().pendingClose).toEqual([]);
  });

  it('only moves forward', async () => {
    await state().ensureLink(TUE);
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 17, 4, 0)));
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
    expect(await closedThrough()).toBe('2026-11-17');
  });

  it('keeps a failed close in a saved queue, and sends it on the next refresh', async () => {
    await state().ensureLink(TUE);
    flags.offline = true;
    const result = await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
    expect(result.ok).toBe(false);
    expect(state().pendingClose).toEqual([{ slotId: 'tue', date: '2026-11-10' }]);
    expect(cached().pendingClose).toEqual([{ slotId: 'tue', date: '2026-11-10' }]);
    expect(await closedThrough()).toBeNull();
    flags.offline = false;
    await state().refresh('tue');
    expect(await closedThrough()).toBe('2026-11-10');
    expect(state().pendingClose).toEqual([]);
    expect(cached().pendingClose).toEqual([]);
  });

  it('keeps the close queued while the retry still fails', async () => {
    await state().ensureLink(TUE);
    flags.offline = true;
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
    await state().refresh('tue');
    expect(state().pendingClose).toEqual([{ slotId: 'tue', date: '2026-11-10' }]);
  });

  it('keeps one queued close per slot, the latest date', async () => {
    await state().ensureLink(TUE);
    flags.offline = true;
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 17, 4, 0)));
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 3, 4, 0)));
    expect(state().pendingClose).toEqual([{ slotId: 'tue', date: '2026-11-17' }]);
  });

  it('queues the close when the sign-in could not be checked, and not when nobody ever signed in', async () => {
    await state().ensureLink(TUE);
    signedIn = null;
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
    expect(state().pendingClose).toEqual([{ slotId: 'tue', date: '2026-11-10' }]);
    state().clear();
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
    expect(state().pendingClose).toEqual([]);
  });

  it('never throws, even when the remote throws something odd', async () => {
    await state().ensureLink(TUE);
    override = { closeThrough: async () => { throw new Error('boom'); } };
    await expect(state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)))).resolves.toMatchObject({ ok: false });
    expect(state().pendingClose).toHaveLength(1);
  });
});

describe('syncing a slot to its link', () => {
  it('updates the title, times, venue and courts, but not the code or the closed date', async () => {
    await state().ensureLink(TUE);
    const code = await codeOf();
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
    expect(await state().syncSlot({ ...TUE, startMin: 1080, endMin: 1200, venue: 'Park', courts: 4 })).toEqual({ ok: true });
    const row = (await db.query('select start_min, end_min, venue, courts, code, closed_through::text as c from public.attendance_links')).rows[0];
    expect(row).toEqual({ start_min: 1080, end_min: 1200, venue: 'Park', courts: 4, code, c: '2026-11-10' });
  });

  it('does nothing for a slot with no link', async () => {
    flags.calls.length = 0;
    expect(await state().syncSlot(THU)).toEqual({ ok: true });
    expect(flags.calls).toEqual([]);
    expect((await db.query('select count(*)::int as n from public.attendance_links')).rows[0]).toEqual({ n: 0 });
  });

  it('reports a failure without throwing', async () => {
    await state().ensureLink(TUE);
    flags.offline = true;
    expect(await state().syncSlot({ ...TUE, venue: 'Park' })).toEqual({ ok: false, message: OFFLINE });
  });

  it('does nothing when nobody is signed in', async () => {
    await state().ensureLink(TUE);
    signedIn = null;
    flags.calls.length = 0;
    expect((await state().syncSlot({ ...TUE, venue: 'Park' })).ok).toBe(false);
    expect(flags.calls).toEqual([]);
  });
});

describe('the saved copy', () => {
  it('records the account, links, summaries, last change and queue', async () => {
    await state().ensureLink(TUE);
    const saved = cached();
    expect(saved.version).toBe(1);
    expect(saved.userId).toBe(USER_A);
    expect(saved.links.tue.code).toBe(await codeOf());
    expect(saved.summaries.tue.slotId).toBe('tue');
    expect(saved.pendingClose).toEqual([]);
  });

  it('does not save the failure or busy flags', async () => {
    await state().ensureLink(TUE);
    flags.offline = true;
    await state().refresh('tue');
    const saved = cached();
    expect(saved).not.toHaveProperty('lastError');
    expect(saved).not.toHaveProperty('busy');
  });

  it('is read again when the app starts', async () => {
    await state().ensureLink(TUE);
    const before = state();
    vi.resetModules();
    const fresh = await import('./store');
    const loaded = fresh.useAttendanceStore.getState();
    expect(loaded.ownerId).toBe(USER_A);
    expect(loaded.links).toEqual(before.links);
    expect(loaded.summaries).toEqual(before.summaries);
  });

  it('survives storage that throws', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    await expect(state().ensureLink(TUE)).resolves.toEqual({ ok: true });
    expect(state().links.tue).toBeDefined();
  });
});

describe('reading a bad saved copy', () => {
  const summary = {
    slotId: 'tue', code: 'c', playDate: '2026-11-10', cancelled: null,
    counts: { in: 1, maybe: 0, out: 0, late: 0 }, friends: 0, waiting: [], answers: { p: 'in' }, names: { p: 'Ana' }, fetchedAt: 5,
  };
  const good = { version: 1, userId: 'u', links: { tue: { code: 'c' } }, summaries: { tue: summary }, lastChange: {}, pendingClose: [] };

  it('accepts a good copy', () => {
    expect(parseAttendanceCache(JSON.stringify(good))).toMatchObject({ ownerId: 'u', links: { tue: { code: 'c' } }, summaries: { tue: summary } });
  });

  it('gives nothing for missing, broken or foreign data', () => {
    for (const raw of [null, '', 'nope', '[]', '5', JSON.stringify({ ...good, version: 2 }), JSON.stringify({ ...good, userId: 5 }), JSON.stringify({ ...good, userId: '' })]) {
      expect(parseAttendanceCache(raw)).toBeNull();
    }
  });

  it('drops only the entries that are wrong', () => {
    const raw = JSON.stringify({
      ...good,
      links: { tue: { code: 'c' }, thu: { code: 5 }, sat: 'x', sun: { code: '' } },
      summaries: {
        tue: summary,
        thu: { ...summary, slotId: 'thu', counts: { in: 'many' } },
        sat: { ...summary, slotId: 'other' },
        bad: null,
      },
      lastChange: {
        tue: { player: 'Ben', from: 'in', to: 'out', at: 1 },
        thu: { player: 'Ben', from: 'in', to: 'sideways', at: 1 },
        sat: null,
      },
      pendingClose: [{ slotId: 'tue', date: '2026-11-10' }, { slotId: 'tue', date: 'tomorrow' }, { slotId: 5, date: '2026-11-10' }, null],
    });
    const parsed = parseAttendanceCache(raw)!;
    expect(Object.keys(parsed.links)).toEqual(['tue']);
    expect(Object.keys(parsed.summaries)).toEqual(['tue']);
    expect(Object.keys(parsed.lastChange)).toEqual(['tue']);
    expect(parsed.pendingClose).toEqual([{ slotId: 'tue', date: '2026-11-10' }]);
  });

  it('drops a summary whose answers or waiting names are malformed', () => {
    for (const bad of [
      { ...summary, answers: { p: 'perhaps' } },
      { ...summary, names: { p: 5 } },
      { ...summary, waiting: [{ id: 'g', name: 5, broughtBy: null }] },
      { ...summary, cancelled: { reason: 5 } },
      { ...summary, fetchedAt: 'now' },
      { ...summary, friends: -1 },
    ]) {
      expect(parseAttendanceCache(JSON.stringify({ ...good, summaries: { tue: bad } }))!.summaries).toEqual({});
    }
  });

  it('starts empty from a bad copy instead of crashing', async () => {
    localStorage.setItem(ATTENDANCE_KEY, '{{{');
    vi.resetModules();
    const fresh = await import('./store');
    expect(fresh.useAttendanceStore.getState()).toMatchObject({ ownerId: null, links: {}, summaries: {}, pendingClose: [] });
  });
});

describe('clearing', () => {
  it('empties everything and removes the saved copy', async () => {
    await state().ensureLink(TUE);
    flags.offline = true;
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
    state().clear();
    expect(state()).toMatchObject({ ownerId: null, links: {}, summaries: {}, lastChange: {}, lastError: {}, pendingClose: [] });
    expect(localStorage.getItem(ATTENDANCE_KEY)).toBeNull();
  });

  it('keeps one account from seeing another account cache', async () => {
    await state().ensureLink(TUE);
    expect(state().summaries.tue).toBeDefined();
    signedIn = USER_B;
    await state().refresh('tue');
    expect(state().ownerId).toBe(USER_B);
    expect(state().links).toEqual({});
    expect(state().summaries).toEqual({});
    expect(cached().userId).toBe(USER_B);
  });

  it('also drops the queue of the other account', async () => {
    await state().ensureLink(TUE);
    flags.offline = true;
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
    flags.offline = false;
    signedIn = USER_B;
    await state().refresh('tue');
    expect(state().pendingClose).toEqual([]);
    expect(await closedThrough()).toBeNull();
  });

  it('applies to a saved copy of another account found at start', async () => {
    await state().ensureLink(TUE);
    signedIn = USER_B;
    await state().ensureLink(THU);
    expect(state().links).toEqual({ thu: { code: await codeOf('thu') } });
  });
});
```

Apply this patch to `src/sync/dataActions.test.ts`:

```diff
diff --git a/src/sync/dataActions.test.ts b/src/sync/dataActions.test.ts
index 793e4e4..314cc26 100644
--- a/src/sync/dataActions.test.ts
+++ b/src/sync/dataActions.test.ts
@@ -15,6 +15,7 @@ import { clearThisDevice, deleteAllMyData, removeAllPhotoFiles, type DataActionD
 import { createSession } from '../engine';
 import { createFakeServer, type FakeServer } from './fakeServer';
 import { RemoteError } from './remote';
+import { ATTENDANCE_KEY, useAttendanceStore } from './attendance/store';
 
 let server: FakeServer;
 beforeAll(async () => {
@@ -172,3 +173,50 @@ describe('clearing this device', () => {
     expect(events).toEqual(['pause', 'resume', 'syncNow']);
   });
 });
+
+describe('the attendance cache', () => {
+  const memory = new Map<string, string>();
+  beforeEach(() => {
+    memory.clear();
+    vi.stubGlobal('localStorage', {
+      getItem: (k: string) => memory.get(k) ?? null,
+      setItem: (k: string, v: string) => void memory.set(k, v),
+      removeItem: (k: string) => void memory.delete(k),
+    });
+    useAttendanceStore.setState({
+      ownerId: USER_A,
+      links: { tue: { code: 'abc' } },
+      summaries: {},
+      lastChange: {},
+      lastError: {},
+      pendingClose: [{ slotId: 'tue', date: '2026-11-10' }],
+    });
+    memory.set(ATTENDANCE_KEY, '{"version":1}');
+  });
+  afterEach(() => {
+    vi.unstubAllGlobals();
+    useAttendanceStore.getState().clear();
+  });
+  const cleared = () => useAttendanceStore.getState().ownerId === null && Object.keys(useAttendanceStore.getState().links).length === 0;
+
+  it('is cleared, with its queue, by delete all my data', async () => {
+    expect(await deleteAllMyData(deps())).toEqual({ ok: true });
+    expect(cleared()).toBe(true);
+    expect(useAttendanceStore.getState().pendingClose).toEqual([]);
+    expect(memory.has(ATTENDANCE_KEY)).toBe(false);
+  });
+
+  it('is cleared by clearing this device', async () => {
+    expect(await clearThisDevice(deps())).toEqual({ ok: true });
+    expect(cleared()).toBe(true);
+    expect(useAttendanceStore.getState().pendingClose).toEqual([]);
+    expect(memory.has(ATTENDANCE_KEY)).toBe(false);
+  });
+
+  it('is kept when delete all my data fails, because nothing on the device was removed', async () => {
+    server.offline = true;
+    await deleteAllMyData(deps());
+    expect(cleared()).toBe(false);
+    expect(memory.has(ATTENDANCE_KEY)).toBe(true);
+  });
+});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/sync/attendance/start.test.ts src/sync/attendance/store.test.ts src/sync/dataActions.test.ts`

Expected: it fails. Test Files `3 failed (3)`, Tests `no tests`.

- [ ] **Step 3: Write the code**

Create `src/sync/attendance/start.ts`:

```typescript
import { useSlotsStore, type Slot } from '../../store/slots';
import { useAuthStore } from '../auth';
import { useAttendanceStore } from './store';

/** A saved slot reaches its link this long after the last save, so a few quick edits send once. */
const SLOT_DELAY_MS = 800;

// The parts of a slot its link shows.
const shown = (s: Slot) => [s.weekday, s.startMin, s.endMin, s.venue, s.courts].join('|');

/**
 * Keeps the attendance link in step with the app: a slot saved for good updates its link, and the saved copy is
 * cleared when the organizer signs out or another account signs in. Returns a function that stops it.
 */
export function startAttendanceSync(delayMs = SLOT_DELAY_MS): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const unwatchSlots = useSlotsStore.subscribe((state, prev) => {
    if (state.slots === prev.slots) return;
    const before = new Map(prev.slots.map((s) => [s.id, s]));
    for (const slot of state.slots) {
      const old = before.get(slot.id);
      if (old && shown(old) === shown(slot)) continue;
      clearTimeout(timers.get(slot.id));
      timers.set(
        slot.id,
        setTimeout(() => {
          timers.delete(slot.id);
          const saved = useSlotsStore.getState().slots.find((s) => s.id === slot.id);
          if (saved) void useAttendanceStore.getState().syncSlot(saved);
        }, delayMs),
      );
    }
  });

  // Signed out, or a different account: the saved copy is not for this person. A sign-in that cannot be checked
  // (`unknown`) clears nothing.
  function followAccount() {
    const { status, userId } = useAuthStore.getState();
    const { ownerId, clear } = useAttendanceStore.getState();
    if (status === 'signedOut' || (status === 'signedIn' && userId && ownerId && ownerId !== userId)) clear();
  }
  followAccount();
  const unwatchAuth = useAuthStore.subscribe(followAccount);

  return () => {
    unwatchSlots();
    unwatchAuth();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
}
```

Create `src/sync/attendance/store.ts`:

```typescript
import { create } from 'zustand';
import type { Session } from '../../engine';
import type { Slot } from '../../store/slots';
import { useAuthStore } from '../auth';
import { getSupabase } from '../client';
import { isRemoteError, RemoteError } from '../remote';
import { diffChange, linkRow, localDate, safeTimezone, summarize } from './links';
import { supabaseAttendanceRemote, type AttendanceRemote } from './remote';
import type { AttendanceStatus, ChangeNote, Failure, Summary } from './types';

export const ATTENDANCE_KEY = 'pickleball.attendance.v1';
const VERSION = 1;
const MAX_REASON = 140;

export type AttendanceResult = { ok: true } | { ok: false; message: string };

export interface AttendanceDeps {
  /** The server for the signed-in organizer and their id, or null when there is no backend or nobody is signed in. */
  server(): { remote: AttendanceRemote; userId: string } | null;
  now(): number;
  /** The IANA zone links are written in. */
  timezone(): string;
}

const defaultDeps: AttendanceDeps = {
  server() {
    const client = getSupabase();
    const { status, userId } = useAuthStore.getState();
    return client && status === 'signedIn' && userId ? { remote: supabaseAttendanceRemote(client, userId), userId } : null;
  },
  now: () => Date.now(),
  timezone: () => safeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone),
};

let deps: AttendanceDeps = defaultDeps;
/** Replaces the server, clock and zone. For tests. */
export const setAttendanceDeps = (next: AttendanceDeps) => {
  deps = next;
};
export const resetAttendanceDeps = () => {
  deps = defaultDeps;
};

/** What is kept on the device, and so survives a restart. */
interface Data {
  /** The account this copy belongs to. */
  ownerId: string | null;
  links: Record<string, { code: string }>;
  summaries: Record<string, Summary>;
  lastChange: Record<string, ChangeNote | null>;
  /** Closes that could not be sent yet, at most one per slot. */
  pendingClose: { slotId: string; date: string }[];
}

interface AttendanceState extends Data {
  lastError: Record<string, Failure | null>;
  /** Slots with a write in progress. */
  busy: Record<string, boolean>;
  /** Reads the answers again. Keeps the last good copy when it fails. */
  refresh: (slotId: string) => Promise<AttendanceResult>;
  ensureLink: (slot: Slot) => Promise<AttendanceResult>;
  resetLink: (slotId: string) => Promise<AttendanceResult>;
  cancelWeek: (slotId: string, reason: string) => Promise<AttendanceResult>;
  undoCancel: (slotId: string) => Promise<AttendanceResult>;
  /** Closes the date a session started on. Never throws. */
  closeForSession: (session: Session) => Promise<AttendanceResult>;
  /** Sends a saved slot to its link, when it has one. */
  syncSlot: (slot: Slot) => Promise<AttendanceResult>;
  clear: () => void;
}

const SIGN_IN = 'Sign in to use the attendance link.';
const MESSAGES: Record<Failure, string> = {
  offline: 'No connection. Try again when you are online.',
  auth: 'Your sign-in ended. Sign in again.',
  server: 'Something went wrong. Try again.',
};
const failure = (kind: Failure): AttendanceResult => ({ ok: false, message: MESSAGES[kind] });
const kindOf = (error: unknown): Failure => (isRemoteError(error) ? error.kind : 'server');

// Reading the saved copy. Anything wrong is dropped, never trusted.

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStatus = (x: unknown): x is AttendanceStatus => x === 'in' || x === 'maybe' || x === 'out';
const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const isDate = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const isText = (x: unknown): x is string => typeof x === 'string' && x !== '';
const everyValue = (x: unknown, ok: (v: unknown) => boolean) => isObject(x) && Object.values(x).every(ok);

function isSummary(key: string, x: unknown): x is Summary {
  if (!isObject(x)) return false;
  const { counts, cancelled, waiting } = x;
  return (
    x.slotId === key &&
    isText(x.code) &&
    isDate(x.playDate) &&
    (cancelled === null || (isObject(cancelled) && (cancelled.reason === null || typeof cancelled.reason === 'string'))) &&
    isObject(counts) &&
    isCount(counts.in) &&
    isCount(counts.maybe) &&
    isCount(counts.out) &&
    isCount(counts.late) &&
    isCount(x.friends) &&
    Array.isArray(waiting) &&
    waiting.every(
      (w) => isObject(w) && typeof w.id === 'string' && typeof w.name === 'string' && (w.broughtBy === null || typeof w.broughtBy === 'string'),
    ) &&
    everyValue(x.answers, isStatus) &&
    everyValue(x.names, (v) => typeof v === 'string') &&
    typeof x.fetchedAt === 'number' &&
    Number.isFinite(x.fetchedAt)
  );
}

function isChange(x: unknown): x is ChangeNote {
  return isObject(x) && typeof x.player === 'string' && isStatus(x.from) && isStatus(x.to) && typeof x.at === 'number' && Number.isFinite(x.at);
}

/** The saved copy, or null when there is none or it is not ours. Wrong entries are dropped one by one. */
export function parseAttendanceCache(raw: string | null): Data | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isObject(data) || data.version !== VERSION || !isText(data.userId)) return null;
    const links: Data['links'] = {};
    if (isObject(data.links)) {
      for (const [slotId, link] of Object.entries(data.links)) if (isObject(link) && isText(link.code)) links[slotId] = { code: link.code };
    }
    const summaries: Data['summaries'] = {};
    if (isObject(data.summaries)) {
      for (const [slotId, s] of Object.entries(data.summaries)) if (slotId in links && isSummary(slotId, s)) summaries[slotId] = s;
    }
    const lastChange: Data['lastChange'] = {};
    if (isObject(data.lastChange)) {
      for (const [slotId, note] of Object.entries(data.lastChange)) if (slotId in links && isChange(note)) lastChange[slotId] = note;
    }
    const pendingClose = Array.isArray(data.pendingClose)
      ? data.pendingClose.flatMap((p: unknown) => (isObject(p) && isText(p.slotId) && isDate(p.date) ? [{ slotId: p.slotId, date: p.date }] : []))
      : [];
    return { ownerId: data.userId, links, summaries, lastChange, pendingClose };
  } catch {
    return null;
  }
}

const empty = (): Data => ({ ownerId: null, links: {}, summaries: {}, lastChange: {}, pendingClose: [] });

function readCache(): Data {
  try {
    return parseAttendanceCache(localStorage.getItem(ATTENDANCE_KEY)) ?? empty();
  } catch {
    return empty();
  }
}

function writeCache(data: Data): void {
  try {
    if (data.ownerId === null) {
      localStorage.removeItem(ATTENDANCE_KEY);
      return;
    }
    const { ownerId, links, summaries, lastChange, pendingClose } = data;
    localStorage.setItem(ATTENDANCE_KEY, JSON.stringify({ version: VERSION, userId: ownerId, links, summaries, lastChange, pendingClose }));
  } catch {
    /* the copy is only a convenience; the screen still works from memory */
  }
}

// Bumped when the copy is cleared, so an answer that arrives later is dropped.
let epoch = 0;
// Which request for a slot is the latest, so an older answer never overwrites a newer one.
const latest = new Map<string, number>();
const inFlight = new Map<string, Promise<AttendanceResult>>();

export const useAttendanceStore = create<AttendanceState>()((set, get) => {
  /** Changes what is kept, and saves it. */
  function commit(patch: Partial<AttendanceState>) {
    set(patch);
    const { ownerId, links, summaries, lastChange, pendingClose } = get();
    writeCache({ ownerId, links, summaries, lastChange, pendingClose });
  }

  /** This copy belongs to one account. Another account signing in on the device starts from nothing. */
  function claim(userId: string) {
    const { ownerId } = get();
    if (ownerId === userId) return;
    if (ownerId !== null) get().clear();
    set({ ownerId: userId });
  }

  function dropLink(slotId: string) {
    const { [slotId]: _link, ...links } = get().links;
    const { [slotId]: _summary, ...summaries } = get().summaries;
    const { [slotId]: _change, ...lastChange } = get().lastChange;
    commit({ links, summaries, lastChange });
  }

  function enqueue(slotId: string, date: string) {
    const queue = get().pendingClose;
    const existing = queue.find((p) => p.slotId === slotId);
    if (existing && existing.date >= date) return;
    commit({ pendingClose: [...queue.filter((p) => p.slotId !== slotId), { slotId, date }] });
  }

  /** Forgets queued closes that a close through `date` has made unnecessary. */
  function dequeue(slotId: string, date: string) {
    const queue = get().pendingClose;
    const rest = queue.filter((p) => !(p.slotId === slotId && p.date <= date));
    if (rest.length !== queue.length) commit({ pendingClose: rest });
  }

  async function flushQueue(remote: AttendanceRemote, mine: number) {
    for (const { slotId, date } of get().pendingClose) {
      try {
        await remote.closeThrough(slotId, date);
        if (mine === epoch) dequeue(slotId, date);
      } catch {
        /* stays queued for the next refresh */
      }
    }
  }

  async function load(slotId: string): Promise<AttendanceResult> {
    const server = deps.server();
    if (!server) return { ok: false, message: SIGN_IN };
    claim(server.userId);
    const { remote } = server;
    const mine = epoch;
    const turn = (latest.get(slotId) ?? 0) + 1;
    latest.set(slotId, turn);
    const current = () => mine === epoch && latest.get(slotId) === turn;
    try {
      await flushQueue(remote, mine);
      let code = get().links[slotId]?.code;
      let view = code ? await remote.view(code) : null;
      if (!view) {
        // No code yet, or the saved one stopped working (reset on another device): ask for the link itself.
        const link = await remote.getLink(slotId);
        if (!link) {
          if (current()) {
            dropLink(slotId);
            commit({ lastError: { ...get().lastError, [slotId]: null } });
          }
          return { ok: true };
        }
        code = link.code;
        view = await remote.view(code);
        if (!view) throw new RemoteError('server');
      }
      const waiting = await remote.listWaiting(slotId, view.play_date);
      if (!current()) return { ok: true };
      const now = deps.now();
      const summary = summarize(slotId, code!, view, waiting, now);
      const before = get().summaries[slotId];
      let change = get().lastChange[slotId] ?? null;
      if (before && before.playDate !== summary.playDate) change = null;
      else if (before) change = diffChange(before.answers, summary.answers, summary.names, now) ?? change;
      commit({
        links: { ...get().links, [slotId]: { code: code! } },
        summaries: { ...get().summaries, [slotId]: summary },
        lastChange: { ...get().lastChange, [slotId]: change },
        lastError: { ...get().lastError, [slotId]: null },
      });
      return { ok: true };
    } catch (error) {
      const kind = kindOf(error);
      if (current()) set({ lastError: { ...get().lastError, [slotId]: kind } });
      return failure(kind);
    }
  }

  /** A change the organizer asked for. It changes nothing when it fails, then reads the answers again. */
  async function write(
    slotId: string,
    act: (remote: AttendanceRemote) => Promise<string | void>,
  ): Promise<AttendanceResult> {
    const server = deps.server();
    if (!server) return { ok: false, message: SIGN_IN };
    claim(server.userId);
    set({ busy: { ...get().busy, [slotId]: true } });
    try {
      const refused = await act(server.remote);
      if (refused) return { ok: false, message: refused };
      await load(slotId);
      return { ok: true };
    } catch (error) {
      return failure(kindOf(error));
    } finally {
      set({ busy: { ...get().busy, [slotId]: false } });
    }
  }

  return {
    ...readCache(),
    lastError: {},
    busy: {},

    refresh(slotId) {
      const running = inFlight.get(slotId);
      if (running) return running;
      const started = load(slotId).finally(() => inFlight.delete(slotId));
      inFlight.set(slotId, started);
      return started;
    },

    ensureLink(slot) {
      return write(slot.id, async (remote) => {
        await remote.upsertLink(linkRow(slot, deps.timezone()));
        const link = await remote.getLink(slot.id);
        if (!link) throw new RemoteError('server');
        commit({ links: { ...get().links, [slot.id]: { code: link.code } } });
      });
    },

    resetLink(slotId) {
      return write(slotId, async (remote) => {
        const code = await remote.resetLink(slotId);
        if (code === null) {
          dropLink(slotId);
          return 'That link no longer exists.';
        }
        commit({ links: { ...get().links, [slotId]: { code } } });
      });
    },

    async cancelWeek(slotId, reason) {
      const date = get().summaries[slotId]?.playDate;
      if (!date) return { ok: false, message: 'Could not find the date. Try again.' };
      const clean = reason.trim().slice(0, MAX_REASON).trim();
      return write(slotId, (remote) => remote.cancel(slotId, date, clean || null));
    },

    async undoCancel(slotId) {
      const date = get().summaries[slotId]?.playDate;
      if (!date) return { ok: false, message: 'Could not find the date. Try again.' };
      return write(slotId, (remote) => remote.undoCancel(slotId, date));
    },

    async closeForSession(session) {
      try {
        const slotId = session.slotId;
        if (!slotId) return { ok: true };
        // The calendar date the session started, where the link lives.
        const date = localDate(session.createdAt, deps.timezone());
        const server = deps.server();
        if (!server) {
          // Signed in before but not checkable now: keep it for later. Never signed in: there is no link to close.
          if (get().ownerId !== null) enqueue(slotId, date);
          return { ok: false, message: SIGN_IN };
        }
        claim(server.userId);
        try {
          await server.remote.closeThrough(slotId, date);
          dequeue(slotId, date);
          return { ok: true };
        } catch (error) {
          enqueue(slotId, date);
          return failure(kindOf(error));
        }
      } catch {
        return failure('server');
      }
    },

    async syncSlot(slot) {
      if (!get().links[slot.id]) return { ok: true };
      const server = deps.server();
      if (!server) return { ok: false, message: SIGN_IN };
      try {
        await server.remote.upsertLink(linkRow(slot, deps.timezone()));
        return { ok: true };
      } catch (error) {
        return failure(kindOf(error));
      }
    },

    clear() {
      epoch += 1;
      latest.clear();
      inFlight.clear();
      set({ ...empty(), lastError: {}, busy: {} });
      writeCache(empty());
    },
  };
});
```

Apply this patch to `src/sync/dataActions.ts`:

```diff
diff --git a/src/sync/dataActions.ts b/src/sync/dataActions.ts
index 31185ef..c7ea5da 100644
--- a/src/sync/dataActions.ts
+++ b/src/sync/dataActions.ts
@@ -2,6 +2,7 @@ import { clearHistory } from '../store/historyDb';
 import { useHistoryStore } from '../store/historyStore';
 import { clearRosterData } from '../store/rosterDb';
 import { useRosterStore } from '../store/rosterStore';
+import { useAttendanceStore } from './attendance/store';
 import { useAuthStore } from './auth';
 import { getSupabase } from './client';
 import { pauseSync, syncNow } from './coordinator';
@@ -64,6 +65,8 @@ export async function deleteAllMyData(deps: DataActionDeps = defaultDeps): Promi
     await clearRosterData();
     // Past sessions name the same people, so they go with the account's data.
     await clearHistory();
+    // The attendance copy is part of the account's data.
+    useAttendanceStore.getState().clear();
     void useHistoryStore.getState().load();
     useSyncStore.setState({ pending: 0, lastSyncedAt: null });
     deps.refresh();
@@ -89,6 +92,7 @@ export async function clearThisDevice(deps: DataActionDeps = defaultDeps): Promi
   const resume = await deps.pause();
   try {
     await clearRosterData();
+    useAttendanceStore.getState().clear();
     useSyncStore.setState({ pending: 0, lastSyncedAt: null });
     deps.refresh();
     return { ok: true };
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/sync/attendance/start.test.ts src/sync/attendance/store.test.ts src/sync/dataActions.test.ts`

Expected: it passes. Test Files `3 passed (3)`, Tests `82 passed (82)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 1659 tests across 126 files.

- [ ] **Step 5: Commit**

```bash
git add src/sync/attendance/start.test.ts src/sync/attendance/store.test.ts src/sync/dataActions.test.ts src/sync/attendance/start.ts src/sync/attendance/store.ts src/sync/dataActions.ts
git commit -m "Add the attendance store: cache, refresh, reset, cancel, close and slot sync"
```

---

### Task 5: Close the date when a session ends

When the organizer ends a session, the date it started on is closed on its link, so the link moves to the next week at once. It never blocks or breaks ending a session.

**Files:**
- Modify: `src/ui/LiveScreen.tsx`
- Modify: `src/ui/liveScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

Apply this patch to `src/ui/liveScreen.test.tsx`:

```diff
diff --git a/src/ui/liveScreen.test.tsx b/src/ui/liveScreen.test.tsx
index f0d265e..34ddd6c 100644
--- a/src/ui/liveScreen.test.tsx
+++ b/src/ui/liveScreen.test.tsx
@@ -9,9 +9,14 @@ import { useUpdateStore } from '../pwa';
 import { useSessionStore } from '../store/sessionStore';
 import { renderAtSetup } from '../test/renderAtSetup';
 import { newTestSession } from '../engine/testing';
+import type { Session } from '../engine';
 import { LiveScreen } from './LiveScreen';
+import App from './App';
+import type { AttendanceRemote } from '../sync/attendance/remote';
+import { resetAttendanceDeps, setAttendanceDeps, useAttendanceStore } from '../sync/attendance/store';
 
 type User = ReturnType<typeof userEvent.setup>;
+const realClose = useAttendanceStore.getState().closeForSession;
 
 beforeEach(async () => {
   localStorage.clear();
@@ -24,6 +29,9 @@ beforeEach(async () => {
 afterEach(() => {
   vi.restoreAllMocks();
   vi.unstubAllGlobals();
+  resetAttendanceDeps();
+  useAttendanceStore.setState({ closeForSession: realClose });
+  useAttendanceStore.getState().clear();
 });
 
 async function startSession(user: User, names: string) {
@@ -412,3 +420,58 @@ describe('extending the session', () => {
     expect(plannedEnd()).toBe(END);
   });
 });
+
+describe('ending a session and the attendance link', () => {
+  const PLAYERS = ['Ann', 'Ben', 'Cy', 'Dee'].map((name) => ({ name }));
+  const startFromSlot = (slotId?: string) => {
+    expect(useSessionStore.getState().start({ name: 'Tuesday open play', mode: 'fairness', courtCount: 1, players: PLAYERS, slotId }).ok).toBe(true);
+  };
+  const endIt = async (user: User) => {
+    render(<App />);
+    await user.click(await screen.findByRole('button', { name: 'Menu' }));
+    await user.click(screen.getByRole('button', { name: 'End session' }));
+  };
+
+  it('closes the date of the session slot once it has really ended', async () => {
+    const close = vi.fn(async (_session: Session) => ({ ok: true as const }));
+    useAttendanceStore.setState({ closeForSession: close });
+    vi.spyOn(window, 'confirm').mockReturnValue(true);
+    startFromSlot('tue');
+    await endIt(userEvent.setup());
+    expect(close).toHaveBeenCalledTimes(1);
+    expect(close.mock.calls[0][0]).toMatchObject({ slotId: 'tue' });
+    expect(useSessionStore.getState().session?.endedAt).toBeDefined();
+  });
+
+  it('sends the close to the link through the store', async () => {
+    const closeThrough = vi.fn(async () => undefined);
+    const stub = { closeThrough } as unknown as AttendanceRemote;
+    setAttendanceDeps({ server: () => ({ remote: stub, userId: 'u1' }), now: () => Date.now(), timezone: () => 'Asia/Manila' });
+    vi.spyOn(window, 'confirm').mockReturnValue(true);
+    startFromSlot('tue');
+    const startedAt = useSessionStore.getState().session!.createdAt;
+    await endIt(userEvent.setup());
+    await vi.waitFor(() => expect(closeThrough).toHaveBeenCalledTimes(1));
+    const [slot, date] = closeThrough.mock.calls[0] as unknown as [string, string];
+    expect(slot).toBe('tue');
+    expect(date).toBe(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(startedAt));
+  });
+
+  it('does not close anything when ending is not confirmed', async () => {
+    const close = vi.fn(async () => ({ ok: true as const }));
+    useAttendanceStore.setState({ closeForSession: close });
+    vi.spyOn(window, 'confirm').mockReturnValue(false);
+    startFromSlot('tue');
+    await endIt(userEvent.setup());
+    expect(close).not.toHaveBeenCalled();
+    expect(useSessionStore.getState().session?.endedAt).toBeUndefined();
+  });
+
+  it('still ends the session when closing the date fails', async () => {
+    useAttendanceStore.setState({ closeForSession: () => Promise.reject(new Error('boom')) });
+    vi.spyOn(window, 'confirm').mockReturnValue(true);
+    startFromSlot('tue');
+    await endIt(userEvent.setup());
+    expect(useSessionStore.getState().session?.endedAt).toBeDefined();
+  });
+});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/liveScreen.test.tsx`

Expected: it fails. Test Files `1 failed (1)`, Tests `2 failed | 33 passed (35)`.

- [ ] **Step 3: Write the code**

Apply this patch to `src/ui/LiveScreen.tsx`:

```diff
diff --git a/src/ui/LiveScreen.tsx b/src/ui/LiveScreen.tsx
index 603ac88..f145210 100644
--- a/src/ui/LiveScreen.tsx
+++ b/src/ui/LiveScreen.tsx
@@ -5,6 +5,7 @@ import type { GameResult, Session } from '../engine';
 import { useRosterStore } from '../store/rosterStore';
 import { formatClock } from '../store/slots';
 import { useSessionStore, type SessionAction } from '../store/sessionStore';
+import { useAttendanceStore } from '../sync/attendance/store';
 import { AddPlayerSheet } from './AddPlayerSheet';
 import { CourtCard } from './CourtCard';
 import { CourtTabs } from './CourtTabs';
@@ -107,6 +108,8 @@ export function LiveScreen({ session, onHome, onSettings, onShowBoard }: { sessi
     const ended = run((s, ctx) => engine.endSession(s, ctx));
     // Only record "last played" if the session really ended; roster bookkeeping must never block ending it.
     if (ended) markPlayed(rosterIds, Date.now()).catch(() => {});
+    // The link moves on to the next date. It never blocks ending the session.
+    if (ended) useAttendanceStore.getState().closeForSession(session).catch(() => {});
   }
 
   // The planned end as a local clock time, while the session is still running.
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/liveScreen.test.tsx`

Expected: it passes. Test Files `1 passed (1)`, Tests `35 passed (35)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 1663 tests across 126 files.

- [ ] **Step 5: Commit**

```bash
git add src/ui/liveScreen.test.tsx src/ui/LiveScreen.tsx
git commit -m "Close the attendance date when a session ends"
```

---

### Task 6: Cover the gaps the first break-it-on-purpose run found (data layer)

Tests only. They were added after deliberate breaks to Tasks 1 to 5 got through. They pass on the code from Tasks 1 to 5.

**Files:**
- Modify: `src/sync/attendance/start.test.ts`
- Modify: `src/sync/attendance/store.test.ts`
- Modify: `src/ui/liveScreen.test.tsx`

- [ ] **Step 1: Add the tests**

Apply this patch to `src/sync/attendance/start.test.ts`:

```diff
diff --git a/src/sync/attendance/start.test.ts b/src/sync/attendance/start.test.ts
index e52488d..8b07b78 100644
--- a/src/sync/attendance/start.test.ts
+++ b/src/sync/attendance/start.test.ts
@@ -80,6 +80,14 @@ describe('sending slot changes to their link', () => {
     expect(upserts.map((u) => u.slot_id).sort()).toEqual(['thu', 'tue']);
   });
 
+  it('sends a slot whose weekday changed', async () => {
+    seedCache(USER);
+    stop = startAttendanceSync();
+    useSlotsStore.setState({ slots: useSlotsStore.getState().slots.map((s) => (s.id === 'tue' ? { ...s, weekday: 3 } : s)) });
+    await vi.advanceTimersByTimeAsync(800);
+    expect(upserts).toHaveLength(1);
+  });
+
   it('never sends a this time only edit', async () => {
     seedCache(USER);
     stop = startAttendanceSync();
```

Apply this patch to `src/sync/attendance/store.test.ts`:

```diff
diff --git a/src/sync/attendance/store.test.ts b/src/sync/attendance/store.test.ts
index a7a8f3a..3efa2f9 100644
--- a/src/sync/attendance/store.test.ts
+++ b/src/sync/attendance/store.test.ts
@@ -221,8 +221,10 @@ describe('refresh', () => {
     let release!: () => void;
     const gate = new Promise<void>((resolve) => (release = resolve));
     const real = fakeAttendanceRemote(db, USER_A);
-    override = { view: async (code) => { await gate; return real.view(code); } };
+    let asked = 0;
+    override = { view: async (code) => { asked += 1; await gate; return real.view(code); } };
     const pending = state().refresh('tue');
+    await vi.waitFor(() => expect(asked).toBe(1));
     state().clear();
     release();
     await pending;
@@ -231,6 +233,42 @@ describe('refresh', () => {
   });
 });
 
+describe('refreshes that overlap', () => {
+  it('send one request while one is already running for the slot', async () => {
+    await state().ensureLink(TUE);
+    let release!: () => void;
+    const gate = new Promise<void>((resolve) => (release = resolve));
+    const real = fakeAttendanceRemote(db, USER_A);
+    let asked = 0;
+    override = { view: async (code) => { asked += 1; await gate; return real.view(code); } };
+    const first = state().refresh('tue');
+    const second = state().refresh('tue');
+    release();
+    await Promise.all([first, second]);
+    expect(asked).toBe(1);
+  });
+
+  it('drop an answer from before the cache was cleared, even when a new refresh has started since', async () => {
+    await state().ensureLink(TUE);
+    let release!: () => void;
+    const gate = new Promise<void>((resolve) => (release = resolve));
+    const real = fakeAttendanceRemote(db, USER_A);
+    let asked = 0;
+    override = { view: async (code) => { asked += 1; await gate; return real.view(code); } };
+    const old = state().refresh('tue');
+    await vi.waitFor(() => expect(asked).toBe(1));
+    state().clear();
+    signedIn = USER_B;
+    // Two refreshes, so the new account's request counter reaches the old request's number.
+    await state().refresh('tue');
+    await state().refresh('tue');
+    release();
+    await old;
+    expect(state().links).toEqual({});
+    expect(state().summaries).toEqual({});
+  });
+});
+
 describe('the last change', () => {
   it('names the latest answer that changed, with the time', async () => {
     await state().ensureLink(TUE);
@@ -342,9 +380,11 @@ describe('reset, cancel and undo', () => {
     expect(state().summaries.tue.cancelled).toBeNull();
   });
 
-  it('refuses to cancel before the date is known', async () => {
-    expect((await state().cancelWeek('tue', 'Rain')).ok).toBe(false);
-    expect((await state().undoCancel('tue')).ok).toBe(false);
+  it('refuses to cancel before the date is known, without asking the server', async () => {
+    const message = 'Could not find the date. Try again.';
+    expect(await state().cancelWeek('tue', 'Rain')).toEqual({ ok: false, message });
+    expect(await state().undoCancel('tue')).toEqual({ ok: false, message });
+    expect(flags.calls).toEqual([]);
     expect(await cancellationRows()).toEqual([]);
   });
 
@@ -460,6 +500,20 @@ describe('closing a date when a session ends', () => {
     expect(state().pendingClose).toEqual([{ slotId: 'tue', date: '2026-11-10' }]);
   });
 
+  it('forgets an older queued close when a later one goes through, and keeps a later queued one', async () => {
+    await state().ensureLink(TUE);
+    flags.offline = true;
+    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 3, 4, 0)));
+    flags.offline = false;
+    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
+    expect(state().pendingClose).toEqual([]);
+    flags.offline = true;
+    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 24, 4, 0)));
+    flags.offline = false;
+    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 17, 4, 0)));
+    expect(state().pendingClose).toEqual([{ slotId: 'tue', date: '2026-11-24' }]);
+  });
+
   it('keeps one queued close per slot, the latest date', async () => {
     await state().ensureLink(TUE);
     flags.offline = true;
@@ -613,6 +667,19 @@ describe('reading a bad saved copy', () => {
     }
   });
 
+  it('drops a summary or last change for a slot that has no link, and a summary filed under the wrong slot', () => {
+    const note = { player: 'Ben', from: 'in', to: 'out', at: 1 };
+    const raw = JSON.stringify({
+      ...good,
+      links: { tue: { code: 'c' }, thu: { code: 'd' } },
+      summaries: { tue: summary, thu: { ...summary, slotId: 'tue' }, sat: { ...summary, slotId: 'sat' } },
+      lastChange: { tue: note, sat: note },
+    });
+    const parsed = parseAttendanceCache(raw)!;
+    expect(Object.keys(parsed.summaries)).toEqual(['tue']);
+    expect(Object.keys(parsed.lastChange)).toEqual(['tue']);
+  });
+
   it('starts empty from a bad copy instead of crashing', async () => {
     localStorage.setItem(ATTENDANCE_KEY, '{{{');
     vi.resetModules();
```

Apply this patch to `src/ui/liveScreen.test.tsx`:

```diff
diff --git a/src/ui/liveScreen.test.tsx b/src/ui/liveScreen.test.tsx
index 34ddd6c..b352d7d 100644
--- a/src/ui/liveScreen.test.tsx
+++ b/src/ui/liveScreen.test.tsx
@@ -17,6 +17,7 @@ import { resetAttendanceDeps, setAttendanceDeps, useAttendanceStore } from '../s
 
 type User = ReturnType<typeof userEvent.setup>;
 const realClose = useAttendanceStore.getState().closeForSession;
+const realApply = useSessionStore.getState().apply;
 
 beforeEach(async () => {
   localStorage.clear();
@@ -31,6 +32,7 @@ afterEach(() => {
   vi.unstubAllGlobals();
   resetAttendanceDeps();
   useAttendanceStore.setState({ closeForSession: realClose });
+  useSessionStore.setState({ apply: realApply });
   useAttendanceStore.getState().clear();
 });
 
@@ -467,6 +469,16 @@ describe('ending a session and the attendance link', () => {
     expect(useSessionStore.getState().session?.endedAt).toBeUndefined();
   });
 
+  it('does not close anything when the session could not be ended', async () => {
+    const close = vi.fn(async (_session: Session) => ({ ok: true as const }));
+    useAttendanceStore.setState({ closeForSession: close });
+    vi.spyOn(window, 'confirm').mockReturnValue(true);
+    startFromSlot('tue');
+    useSessionStore.setState({ apply: () => ({ ok: false, error: 'nope' }) });
+    await endIt(userEvent.setup());
+    expect(close).not.toHaveBeenCalled();
+  });
+
   it('still ends the session when closing the date fails', async () => {
     useAttendanceStore.setState({ closeForSession: () => Promise.reject(new Error('boom')) });
     vi.spyOn(window, 'confirm').mockReturnValue(true);
```

- [ ] **Step 2: Run them, then the whole project**

Run: `npx vitest run src/sync/attendance/start.test.ts src/sync/attendance/store.test.ts src/ui/liveScreen.test.tsx`

Expected: it passes. Test Files `3 passed (3)`, Tests `107 passed (107)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 1669 tests across 126 files.

- [ ] **Step 3: Commit**

```bash
git add src/sync/attendance/start.test.ts src/sync/attendance/store.test.ts src/ui/liveScreen.test.tsx
git commit -m "Cover a gap found by the mutation check"
```

---

### Task 7: The preview switch

Nothing about the attendance card is visible until the organizer turns on "Attendance link (preview)" in Settings. It is off by default, because members cannot open the link until the member page exists (Plan 3), and a Share button would send them a dead link. Plan 3 removes the switch.

**Files:**
- Modify: `src/ui/SettingsScreen.tsx`
- Modify: `src/ui/prefs.ts`
- Create: `src/ui/attendancePreview.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/attendancePreview.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../sync/auth';
import { SettingsScreen } from './SettingsScreen';
import { ATTENDANCE_PREVIEW_KEY, getBoolPref } from './prefs';

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ status: 'unconfigured', email: null, userId: null, error: null, busy: false });
});
afterEach(() => cleanup());

const row = () => screen.getByRole('switch', { name: 'Attendance link (preview)' });
const renderSettings = () => render(<SettingsScreen onBack={() => {}} onManage={() => {}} onHistory={() => {}} />);

describe('the attendance preview switch', () => {
  it('uses the pref key pikl.attendancePreview', () => {
    expect(ATTENDANCE_PREVIEW_KEY).toBe('pikl.attendancePreview');
  });

  it('has a Settings row that starts off, with its help line', () => {
    renderSettings();
    expect(row()).not.toBeChecked();
    expect(screen.getByText('Shows an attendance card on Home. Members cannot open the link yet.')).toBeInTheDocument();
    expect(getBoolPref(ATTENDANCE_PREVIEW_KEY, false)).toBe(false);
  });

  it('turns on and off and keeps the choice', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(row());
    expect(row()).toBeChecked();
    expect(localStorage.getItem('pikl.attendancePreview')).toBe('true');
    cleanup();
    renderSettings();
    expect(row()).toBeChecked();
    await user.click(row());
    expect(row()).not.toBeChecked();
    expect(localStorage.getItem('pikl.attendancePreview')).toBe('false');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/attendancePreview.test.tsx`

Expected: it fails. Test Files `1 failed (1)`, Tests `3 failed (3)`.

- [ ] **Step 3: Write the code**

Apply this patch to `src/ui/SettingsScreen.tsx`:

```diff
diff --git a/src/ui/SettingsScreen.tsx b/src/ui/SettingsScreen.tsx
index 95a0171..d753fd2 100644
--- a/src/ui/SettingsScreen.tsx
+++ b/src/ui/SettingsScreen.tsx
@@ -5,7 +5,7 @@ import { useSyncStore } from '../sync/syncStore';
 import { RatingsSection } from './RatingsSection';
 import { SyncStatusLine } from './SyncStatusLine';
 import { useDefaultMode } from './matchmaking';
-import { AUTO_START_KEY, KEEP_AWAKE_KEY, PLAY_TO_CHOICES, REDUCE_MOTION_KEY, REGULARS_FIRST_KEY, useBoolPref, usePlayTo, VIBRATE_KEY } from './prefs';
+import { ATTENDANCE_PREVIEW_KEY, AUTO_START_KEY, KEEP_AWAKE_KEY, PLAY_TO_CHOICES, REDUCE_MOTION_KEY, REGULARS_FIRST_KEY, useBoolPref, usePlayTo, VIBRATE_KEY } from './prefs';
 import { useTheme } from './useTheme';
 
 interface Props {
@@ -26,6 +26,7 @@ export function SettingsScreen({ onBack, onManage, onHistory }: Props) {
   const [reduceMotion, setReduceMotion] = useBoolPref(REDUCE_MOTION_KEY, false);
   const [autoStart, setAutoStart] = useBoolPref(AUTO_START_KEY, false);
   const [playTo, setPlayTo] = usePlayTo();
+  const [attendancePreview, setAttendancePreview] = useBoolPref(ATTENDANCE_PREVIEW_KEY, false);
   const [working, setWorking] = useState(false);
   const [outcome, setOutcome] = useState<{ result: DataResult; done: string } | null>(null);
 
@@ -143,6 +144,17 @@ export function SettingsScreen({ onBack, onManage, onHistory }: Props) {
 
       <RatingsSection />
 
+      <section className="card stack" aria-labelledby="attendance-title">
+        <h2 id="attendance-title" className="section-title">
+          Attendance
+        </h2>
+        <label className="switch-row">
+          <span>Attendance link (preview)</span>
+          <input type="checkbox" role="switch" checked={attendancePreview} onChange={(e) => setAttendancePreview(e.target.checked)} />
+        </label>
+        <p className="muted">Shows an attendance card on Home. Members cannot open the link yet.</p>
+      </section>
+
       <section className="card stack" aria-labelledby="account-title">
         <h2 id="account-title" className="section-title">
           Account
```

Apply this patch to `src/ui/prefs.ts`:

```diff
diff --git a/src/ui/prefs.ts b/src/ui/prefs.ts
index 8067433..df7cba7 100644
--- a/src/ui/prefs.ts
+++ b/src/ui/prefs.ts
@@ -8,6 +8,8 @@ export const AUTO_START_KEY = 'pickleball.autoStart';
 export const PLAY_TO_KEY = 'pickleball.playTo';
 export const REGULARS_FIRST_KEY = 'pickleball.regularsFirst';
 export const REDUCE_MOTION_KEY = 'pickleball.reduceMotion';
+/** Shows the attendance card on Home while members cannot open the link yet. Off until the member page exists. */
+export const ATTENDANCE_PREVIEW_KEY = 'pikl.attendancePreview';
 
 /** The scores a game can be played to. */
 export const PLAY_TO_CHOICES = [11, 15, 21] as const;
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/attendancePreview.test.tsx`

Expected: it passes. Test Files `1 passed (1)`, Tests `3 passed (3)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 1672 tests across 127 files.

- [ ] **Step 5: Commit**

```bash
git add src/ui/attendancePreview.test.tsx src/ui/SettingsScreen.tsx src/ui/prefs.ts
git commit -m "Add the attendance preview switch to Settings"
```

---

### Task 8: The hook that keeps the answers fresh

A hook that refreshes the answers when Home opens, every 60 seconds while the page is visible, and when the page becomes visible again. It does nothing unless the preview is on and the organizer is signed in.

**Files:**
- Create: `src/ui/useAttendance.ts`
- Create: `src/ui/useAttendance.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/useAttendance.test.tsx`:

```tsx
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAttendanceStore } from '../sync/attendance/store';
import { useAuthStore } from '../sync/auth';
import { ATTENDANCE_PREVIEW_KEY, setBoolPref } from './prefs';
import { useAttendance } from './useAttendance';

const original = useAttendanceStore.getState().refresh;
let refresh: ReturnType<typeof vi.fn>;
let visibility: DocumentVisibilityState;

const signIn = () => useAuthStore.setState({ status: 'signedIn', email: 'o@example.com', userId: 'user-a' });
const setVisible = (v: DocumentVisibilityState) => {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  refresh = vi.fn(async () => ({ ok: true as const }));
  useAttendanceStore.setState({ refresh });
  useAuthStore.setState({ status: 'unconfigured', email: null, userId: null, error: null, busy: false });
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  useAttendanceStore.setState({ refresh: original });
});

describe('useAttendance', () => {
  it('does nothing while the preview is off', () => {
    signIn();
    const { result } = renderHook(() => useAttendance('tue'));
    vi.advanceTimersByTime(180_000);
    setVisible('visible');
    expect(refresh).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
  });

  it('does nothing when nobody is signed in', () => {
    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
    for (const status of ['signedOut', 'unknown', 'loading', 'unconfigured', 'linkSent'] as const) {
      useAuthStore.setState({ status, userId: null });
      const { result, unmount } = renderHook(() => useAttendance('tue'));
      vi.advanceTimersByTime(120_000);
      expect(refresh).not.toHaveBeenCalled();
      expect(result.current.active).toBe(false);
      unmount();
    }
  });

  it('needs a user id as well as the signed-in status', () => {
    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
    useAuthStore.setState({ status: 'signedIn', userId: null });
    renderHook(() => useAttendance('tue'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes on mount, then every 60 seconds', () => {
    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
    signIn();
    const { result } = renderHook(() => useAttendance('tue'));
    expect(result.current.active).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenLastCalledWith('tue');
    vi.advanceTimersByTime(59_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('skips the timer while the page is hidden and refreshes when it shows again', () => {
    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
    signIn();
    renderHook(() => useAttendance('tue'));
    refresh.mockClear();
    visibility = 'hidden';
    vi.advanceTimersByTime(180_000);
    expect(refresh).not.toHaveBeenCalled();
    setVisible('hidden');
    expect(refresh).not.toHaveBeenCalled();
    setVisible('visible');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenLastCalledWith('tue');
  });

  it('refreshes at once when the preview is switched on or the organizer signs in', () => {
    renderHook(() => useAttendance('tue'));
    expect(refresh).not.toHaveBeenCalled();
    act(() => signIn());
    expect(refresh).not.toHaveBeenCalled();
    act(() => setBoolPref(ATTENDANCE_PREVIEW_KEY, true));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('follows the slot it is given', () => {
    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
    signIn();
    const { rerender } = renderHook(({ id }) => useAttendance(id), { initialProps: { id: 'tue' } });
    rerender({ id: 'thu' });
    expect(refresh).toHaveBeenLastCalledWith('thu');
    refresh.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('thu');
  });

  it('stops its timer and listener when it goes away', () => {
    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
    signIn();
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useAttendance('tue'));
    const added = add.mock.calls.filter(([type]) => type === 'visibilitychange');
    expect(added).toHaveLength(1);
    refresh.mockClear();
    unmount();
    expect(remove.mock.calls.filter(([type, fn]) => type === 'visibilitychange' && fn === added[0][1])).toHaveLength(1);
    vi.advanceTimersByTime(300_000);
    setVisible('visible');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('stops when the organizer signs out', () => {
    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
    signIn();
    renderHook(() => useAttendance('tue'));
    refresh.mockClear();
    act(() => useAuthStore.setState({ status: 'signedOut', userId: null }));
    vi.advanceTimersByTime(180_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/useAttendance.test.tsx`

Expected: it fails. Test Files `1 failed (1)`, Tests `no tests`.

- [ ] **Step 3: Write the code**

Create `src/ui/useAttendance.ts`:

```typescript
import { useEffect } from 'react';
import { useAttendanceStore } from '../sync/attendance/store';
import { useAuthStore } from '../sync/auth';
import { ATTENDANCE_PREVIEW_KEY, useBoolPref } from './prefs';

const REFRESH_MS = 60_000;

/**
 * Keeps one slot's attendance answers fresh: when the card appears, every minute while the page is visible, and
 * when the page comes back to the front. Only while the preview is on and the organizer is signed in.
 */
export function useAttendance(slotId: string): { active: boolean } {
  const [preview] = useBoolPref(ATTENDANCE_PREVIEW_KEY, false);
  const signedIn = useAuthStore((s) => s.status === 'signedIn' && s.userId !== null);
  const active = preview && signedIn;

  useEffect(() => {
    if (!active) return;
    const refresh = () => void useAttendanceStore.getState().refresh(slotId);
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, slotId]);

  return { active };
}
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/useAttendance.test.tsx`

Expected: it passes. Test Files `1 passed (1)`, Tests `9 passed (9)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 1681 tests across 128 files.

- [ ] **Step 5: Commit**

```bash
git add src/ui/useAttendance.test.tsx src/ui/useAttendance.ts
git commit -m "Add the hook that keeps the attendance answers fresh"
```

---

### Task 9: The card, with share, reset and cancel week

The card and its two sheets (Reset link, Cancel this week), and its styles. The styles sit just before the Board section of `app.css`, not at the end, because a Board test forbids the app's colour variables after `/* Board */`. States: preview off, signed out, signed in with no link, checking, failed with no copy, the link with counts, and a cancelled week with Undo.

**Files:**
- Modify: `src/styles/app.css`
- Create: `src/ui/AttendanceCard.tsx`
- Create: `src/ui/AttendanceSheets.tsx`
- Create: `src/ui/AttendanceCard.test.tsx`
- Create: `src/ui/attendanceCss.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/AttendanceCard.test.tsx`:

```tsx
import type { PGlite } from '@electric-sql/pglite';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHistoryStore } from '../store/historyStore';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { DEFAULT_SLOTS, useSlotsStore, type Slot } from '../store/slots';
import { fakeAttendanceRemote, type FakeFlags } from '../sync/attendance/fakeRemote';
import { resetAttendanceDeps, setAttendanceDeps, useAttendanceStore } from '../sync/attendance/store';
import type { ChangeNote, Summary } from '../sync/attendance/types';
import { useAuthStore } from '../sync/auth';
import { USER_A, createDb, run } from '../sync/db/harness';
import { useSyncStore } from '../sync/syncStore';
import { AttendanceCard } from './AttendanceCard';
import { ATTENDANCE_PREVIEW_KEY, setBoolPref } from './prefs';

// Monday 9 Nov 2026, 4:20 pm. Date is faked and timers stay real.
const NOW = new Date(2026, 10, 9, 16, 20).getTime();
const TUE: Slot = { id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Hall', courts: 3 };
const OFFLINE = 'No connection. Try again when you are online.';
const actions = (() => {
  const s = useAttendanceStore.getState();
  return { refresh: s.refresh, ensureLink: s.ensureLink, resetLink: s.resetLink, cancelWeek: s.cancelWeek, undoCancel: s.undoCancel };
})();

function resetEverything() {
  localStorage.clear();
  useAuthStore.setState({ status: 'unconfigured', email: null, userId: null, error: null, busy: false });
  useSyncStore.setState({ status: 'off', pending: 0, lastSyncedAt: null });
  useSlotsStore.setState({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {}, persistent: true });
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useHistoryStore.setState({ entries: [], loaded: true, persistent: true });
  useRosterStore.setState({ players: [], loaded: true });
  useAttendanceStore.getState().clear();
  useAttendanceStore.setState(actions);
}

const signIn = (status: 'signedIn' | 'unknown' = 'signedIn') =>
  useAuthStore.setState({ status, email: 'o@example.com', userId: status === 'signedIn' ? USER_A : null });

const summary = (over: Partial<Summary> = {}): Summary => ({
  slotId: 'tue',
  code: 'abc123',
  playDate: '2026-11-10',
  cancelled: null,
  counts: { in: 11, maybe: 3, out: 2, late: 0 },
  friends: 1,
  waiting: [],
  answers: {},
  names: {},
  fetchedAt: NOW,
  ...over,
});

/** A link with answers already on the device. */
function seed(over: Partial<Summary> = {}, extra: { change?: ChangeNote | null; error?: 'offline' | 'auth' | 'server' | null; busy?: boolean } = {}) {
  useAttendanceStore.setState({
    ownerId: USER_A,
    links: { tue: { code: 'abc123' } },
    summaries: { tue: summary(over) },
    lastChange: { tue: extra.change ?? null },
    lastError: { tue: extra.error ?? null },
    busy: { tue: extra.busy ?? false },
  });
}

function setup(slot: Slot = TUE) {
  const onSignIn = vi.fn();
  const user = userEvent.setup({ advanceTimers: () => {} });
  const view = render(<AttendanceCard slot={slot} onSignIn={onSignIn} />);
  return { user, onSignIn, ...view };
}

const stubShare = (share: unknown, writeText?: unknown) => {
  Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
  Object.defineProperty(navigator, 'clipboard', { value: writeText === undefined ? undefined : { writeText }, configurable: true, writable: true });
};

beforeEach(() => {
  resetEverything();
  setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  // The display tests have no server: a refresh on mount changes nothing.
  setAttendanceDeps({ server: () => null, now: () => Date.now(), timezone: () => 'Asia/Manila' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetAttendanceDeps();
  delete (navigator as unknown as Record<string, unknown>).share;
  delete (navigator as unknown as Record<string, unknown>).clipboard;
});

describe('which states show', () => {
  it('shows nothing while the preview is off, whatever else is true', () => {
    localStorage.clear();
    signIn();
    seed();
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it.each(['unconfigured', 'loading'] as const)('shows nothing while sign-in is %s', (status) => {
    useAuthStore.setState({ status });
    seed();
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it.each(['signedOut', 'linkSent'] as const)('asks to sign in when status is %s, and the button calls onSignIn', async (status) => {
    useAuthStore.setState({ status });
    seed();
    const { user, onSignIn } = setup();
    expect(screen.getByRole('heading', { name: 'Attendance link' })).toBeInTheDocument();
    expect(screen.getByText('Sign in to share an attendance link with your players.')).toBeInTheDocument();
    expect(screen.queryByText('11 in')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('shows the saved answers when sign-in cannot be checked, and never asks to sign in', () => {
    signIn('unknown');
    seed();
    setup();
    expect(screen.getByText('11 in')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('shows nothing when sign-in cannot be checked and there is nothing saved', () => {
    signIn('unknown');
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it('does not show another account\'s saved answers', () => {
    signIn();
    seed();
    useAttendanceStore.setState({ ownerId: 'someone-else' });
    setup();
    expect(screen.queryByText('11 in')).not.toBeInTheDocument();
    expect(screen.getByText('Checking answers')).toBeInTheDocument();
  });

  it('says it is checking until the first answer comes back', () => {
    signIn();
    setup();
    expect(screen.getByText('Checking answers')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create link' })).not.toBeInTheDocument();
  });

  it('says it is checking when there is a link but no answers yet', () => {
    signIn();
    useAttendanceStore.setState({ ownerId: USER_A, links: { tue: { code: 'abc123' } }, lastError: { tue: null } });
    setup();
    expect(screen.getByText('Checking answers')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
  });

  it('offers Create link once it is known there is none', () => {
    signIn();
    useAttendanceStore.setState({ lastError: { tue: null } });
    setup();
    expect(screen.getByRole('heading', { name: 'Attendance link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create link' })).toBeEnabled();
    expect(screen.queryByText('Checking answers')).not.toBeInTheDocument();
  });

  it.each(['offline', 'auth', 'server'] as const)('says it could not load, with Retry, when a %s failure left nothing saved', async (error) => {
    signIn();
    useAttendanceStore.setState({ lastError: { tue: error } });
    const { user } = setup();
    expect(screen.getByText('Could not load the answers. Try again.')).toBeInTheDocument();
    expect(screen.queryByText('Checking answers')).not.toBeInTheDocument();
    const refresh = vi.fn(async () => ({ ok: true as const }));
    useAttendanceStore.setState({ refresh });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalledWith('tue');
  });

  it('says it could not load when there is a link, no answers and a failure', () => {
    signIn();
    useAttendanceStore.setState({ ownerId: USER_A, links: { tue: { code: 'abc123' } }, lastError: { tue: 'server' } });
    setup();
    expect(screen.getByText('Could not load the answers. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('the link state', () => {
  beforeEach(() => signIn());

  it('shows the heading, the weekday, the pills, the link and the three buttons', () => {
    seed();
    setup();
    expect(screen.getByRole('heading', { name: 'Attendance link' })).toBeInTheDocument();
    expect(screen.getByText('Tuesday')).toBeInTheDocument();
    const pills = within(screen.getByRole('list', { name: 'Answers' })).getAllByRole('listitem');
    expect(pills.map((p) => p.textContent)).toEqual(['11 in', '3 maybe', '2 out', '1 friend']);
    expect(screen.getByText(`${window.location.origin}/j/abc123`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reset link' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel this week' })).toBeEnabled();
  });

  it('names the weekday of the slot it is given', () => {
    seed();
    setup({ id: 'tue', weekday: 4 });
    expect(screen.getByText('Thursday')).toBeInTheDocument();
  });

  it('shows zero counts for in, maybe and out, and no friend pill when there are none', () => {
    seed({ counts: { in: 0, maybe: 0, out: 0, late: 0 }, friends: 0 });
    setup();
    const pills = within(screen.getByRole('list', { name: 'Answers' })).getAllByRole('listitem');
    expect(pills.map((p) => p.textContent)).toEqual(['0 in', '0 maybe', '0 out']);
  });

  it('pluralises friends', () => {
    seed({ friends: 2 });
    setup();
    expect(screen.getByText('2 friends')).toBeInTheDocument();
  });

  it('shows no stale line while the answers are fresh', () => {
    seed({ fetchedAt: NOW - 119_000 });
    setup();
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();
  });

  it('keeps the stale line off at exactly 2 minutes and shows it past that', () => {
    seed({ fetchedAt: NOW - 120_000 });
    const first = setup();
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
    first.unmount();
    seed({ fetchedAt: new Date(2026, 10, 9, 16, 12).getTime() });
    setup();
    expect(screen.getByText('Updated 4:12 pm')).toBeInTheDocument();
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();
  });

  it('uses the 12-hour clock for the morning and for noon', () => {
    vi.setSystemTime(new Date(2026, 10, 9, 13, 0));
    seed({ fetchedAt: new Date(2026, 10, 9, 12, 5).getTime() });
    setup();
    expect(screen.getByText('Updated 12:05 pm')).toBeInTheDocument();
    cleanup();
    seed({ fetchedAt: new Date(2026, 10, 9, 9, 30).getTime() });
    vi.setSystemTime(new Date(2026, 10, 9, 10, 0));
    setup();
    expect(screen.getByText('Updated 9:30 am')).toBeInTheDocument();
  });

  it('shows the update time and the offline line when the last fetch failed offline', () => {
    seed({}, { error: 'offline' });
    setup();
    expect(screen.getByText('Updated 4:20 pm')).toBeInTheDocument();
    expect(screen.getByText('Offline, showing the last list')).toBeInTheDocument();
    expect(screen.getByText('11 in')).toBeInTheDocument();
  });

  it.each(['auth', 'server'] as const)('shows the update time but not the offline line after a %s failure', (error) => {
    seed({}, { error });
    setup();
    expect(screen.getByText('Updated 4:20 pm')).toBeInTheDocument();
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();
  });

  it('shows the last change line', () => {
    seed({}, { change: { player: 'Ben', from: 'in', to: 'out', at: new Date(2026, 10, 9, 16, 10).getTime() } });
    setup();
    expect(screen.getByText('Ben changed to Out at 4:10 pm.')).toBeInTheDocument();
  });

  it.each([
    ['in', 'In'],
    ['maybe', 'Maybe'],
    ['out', 'Out'],
  ] as const)('words a change to %s as %s', (to, label) => {
    seed({}, { change: { player: 'Ana', from: to === 'in' ? 'out' : 'in', to, at: NOW } });
    setup();
    expect(screen.getByText(`Ana changed to ${label} at 4:20 pm.`)).toBeInTheDocument();
  });

  it('shows no change line when nothing changed', () => {
    seed();
    setup();
    expect(screen.queryByText(/changed to/)).not.toBeInTheDocument();
  });

  it('counts the new names to review, with the right plural', () => {
    seed({ waiting: [{ id: 'g1', name: 'Mika', broughtBy: null }] });
    const one = setup();
    expect(screen.getByText('1 new name to review')).toBeInTheDocument();
    one.unmount();
    seed({
      waiting: [
        { id: 'g1', name: 'Mika', broughtBy: null },
        { id: 'g2', name: 'Rico', broughtBy: 'Ana' },
      ],
    });
    setup();
    expect(screen.getByText('2 new names to review')).toBeInTheDocument();
  });

  it('shows no review line when nobody is waiting', () => {
    seed();
    setup();
    expect(screen.queryByText(/to review/)).not.toBeInTheDocument();
  });

  it('puts the lines in order: pills, stale, change, review, link, buttons', () => {
    seed({ fetchedAt: new Date(2026, 10, 9, 16, 12).getTime(), waiting: [{ id: 'g1', name: 'Mika', broughtBy: null }] }, { change: { player: 'Ben', from: 'in', to: 'out', at: NOW } });
    const { container } = setup();
    const text = container.textContent!;
    const order = ['Attendance link', '11 in', 'Updated 4:12 pm', 'Ben changed to Out', '1 new name to review', '/j/abc123', 'Share'].map((t) => text.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('disables every button while a write is running', () => {
    seed({}, { busy: true });
    setup();
    for (const name of ['Share', 'Reset link', 'Cancel this week']) expect(screen.getByRole('button', { name })).toBeDisabled();
  });

  it('disables Create link while it runs', () => {
    useAttendanceStore.setState({ lastError: { tue: null }, busy: { tue: true } });
    setup();
    expect(screen.getByRole('button', { name: 'Create link' })).toBeDisabled();
  });
});

describe('a cancelled week', () => {
  beforeEach(() => signIn());

  it('shows the notice with the date and the reason, and hides the counts and buttons', () => {
    seed({ cancelled: { reason: 'Venue closed' }, waiting: [{ id: 'g1', name: 'Mika', broughtBy: null }] });
    setup();
    expect(screen.getByText('Cancelled for Tue 10 Nov. Venue closed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    expect(screen.queryByText('11 in')).not.toBeInTheDocument();
    expect(screen.queryByText(/to review/)).not.toBeInTheDocument();
    for (const name of ['Share', 'Reset link', 'Cancel this week']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });

  it('shows the notice without a reason', () => {
    seed({ cancelled: { reason: null } });
    setup();
    expect(screen.getByText('Cancelled for Tue 10 Nov.')).toBeInTheDocument();
  });

  it('builds the date from the play date as a local date', () => {
    seed({ cancelled: { reason: null }, playDate: '2027-01-01' });
    setup();
    expect(screen.getByText('Cancelled for Fri 1 Jan.')).toBeInTheDocument();
  });

  it('calls undoCancel for the slot', async () => {
    seed({ cancelled: { reason: null } });
    const undoCancel = vi.fn(async () => ({ ok: true as const }));
    useAttendanceStore.setState({ undoCancel });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undoCancel).toHaveBeenCalledWith('tue');
  });

  it('shows the message when undo fails', async () => {
    seed({ cancelled: { reason: null } });
    useAttendanceStore.setState({ undoCancel: vi.fn(async () => ({ ok: false as const, message: OFFLINE })) });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(OFFLINE);
  });

  it('disables Undo while a write is running', () => {
    seed({ cancelled: { reason: null } }, { busy: true });
    setup();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('keeps the stale line in the cancelled state', () => {
    seed({ cancelled: { reason: null } }, { error: 'offline' });
    setup();
    expect(screen.getByText('Offline, showing the last list')).toBeInTheDocument();
  });
});

describe('Create link', () => {
  beforeEach(() => signIn());

  it('calls ensureLink with the slot and clears an old message when it works', async () => {
    useAttendanceStore.setState({ lastError: { tue: null } });
    const ensureLink = vi.fn(async () => ({ ok: true as const }));
    useAttendanceStore.setState({ ensureLink });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(ensureLink).toHaveBeenCalledWith(TUE);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the store message when it fails', async () => {
    useAttendanceStore.setState({ lastError: { tue: null } });
    useAttendanceStore.setState({ ensureLink: vi.fn(async () => ({ ok: false as const, message: OFFLINE })) });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(OFFLINE);
  });
});

describe('Share', () => {
  beforeEach(() => {
    signIn();
    seed();
  });
  const URL = () => `${window.location.origin}/j/abc123`;

  it('uses the share sheet when the browser has one', async () => {
    const { user } = setup();
    const share = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    stubShare(share, writeText);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(share).toHaveBeenCalledWith({ title: 'Tuesday open play', url: URL() });
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Link copied')).not.toBeInTheDocument();
  });

  it('treats a cancelled share as no error and copies nothing', async () => {
    const { user } = setup();
    const writeText = vi.fn(async () => {});
    stubShare(vi.fn(async () => { throw new DOMException('cancelled', 'AbortError'); }), writeText);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Link copied')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Link')).not.toBeInTheDocument();
  });

  it('copies the link when sharing fails some other way', async () => {
    const { user } = setup();
    const writeText = vi.fn(async () => {});
    stubShare(vi.fn(async () => { throw new Error('nope'); }), writeText);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(writeText).toHaveBeenCalledWith(URL());
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });

  it('copies the link when there is no share sheet', async () => {
    const { user } = setup();
    const writeText = vi.fn(async () => {});
    stubShare(undefined, writeText);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(writeText).toHaveBeenCalledWith(URL());
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
    expect(screen.queryByLabelText('Link')).not.toBeInTheDocument();
  });

  it('shows the link selected in a read-only field when nothing else works', async () => {
    const { user } = setup();
    stubShare(undefined, undefined);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    const field = (await screen.findByLabelText('Link')) as HTMLInputElement;
    expect(field).toHaveValue(URL());
    expect(field).toHaveAttribute('readonly');
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(URL().length);
    expect(screen.queryByText('Link copied')).not.toBeInTheDocument();
  });

  it('shows the field when copying is refused', async () => {
    const { user } = setup();
    stubShare(undefined, vi.fn(async () => { throw new Error('denied'); }));
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByLabelText('Link')).toHaveValue(URL());
    expect(screen.queryByText('Link copied')).not.toBeInTheDocument();
  });

  it('forgets the last result when Share is pressed again', async () => {
    const { user } = setup();
    stubShare(undefined, vi.fn(async () => {}));
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
    stubShare(vi.fn(async () => {}), undefined);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.queryByText('Link copied')).not.toBeInTheDocument();
  });
});

describe('the Reset link sheet', () => {
  beforeEach(() => {
    signIn();
    seed();
  });
  const dialog = () => screen.getByRole('dialog');

  it('asks first, moves focus into the sheet and offers Reset link and Keep it', async () => {
    const { user } = setup();
    const resetLink = vi.fn(async () => ({ ok: true as const }));
    useAttendanceStore.setState({ resetLink });
    await user.click(screen.getByRole('button', { name: 'Reset link' }));
    expect(dialog()).toHaveFocus();
    expect(within(dialog()).getByText('Members who have the old link will need the new one. Answers are kept.')).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Reset link' })).toBeEnabled();
    expect(within(dialog()).getByRole('button', { name: 'Keep it' })).toBeEnabled();
    expect(resetLink).not.toHaveBeenCalled();
  });

  it('closes on Keep it without resetting', async () => {
    const { user } = setup();
    const resetLink = vi.fn(async () => ({ ok: true as const }));
    useAttendanceStore.setState({ resetLink });
    await user.click(screen.getByRole('button', { name: 'Reset link' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(resetLink).not.toHaveBeenCalled();
  });

  it('closes on Escape and gives focus back to the button', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Reset link' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset link' })).toHaveFocus();
  });

  it('resets the link for the slot and closes when it works', async () => {
    const { user } = setup();
    const resetLink = vi.fn(async () => ({ ok: true as const }));
    useAttendanceStore.setState({ resetLink });
    await user.click(screen.getByRole('button', { name: 'Reset link' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Reset link' }));
    expect(resetLink).toHaveBeenCalledWith('tue');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stays open and shows the message when it fails', async () => {
    const { user } = setup();
    useAttendanceStore.setState({ resetLink: vi.fn(async () => ({ ok: false as const, message: OFFLINE })) });
    await user.click(screen.getByRole('button', { name: 'Reset link' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Reset link' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(OFFLINE);
    expect(dialog()).toBeInTheDocument();
  });

  it('disables its buttons while a write is running', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Reset link' }));
    act(() => useAttendanceStore.setState({ busy: { tue: true } }));
    expect(within(dialog()).getByRole('button', { name: 'Reset link' })).toBeDisabled();
    expect(within(dialog()).getByRole('button', { name: 'Keep it' })).toBeDisabled();
  });
});

describe('the Cancel this week sheet', () => {
  beforeEach(() => {
    signIn();
    seed();
  });
  const dialog = () => screen.getByRole('dialog');
  const open = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Cancel this week' }));

  it('names the date, has an optional reason field and moves focus into the sheet', async () => {
    const { user } = setup();
    await open(user);
    expect(within(dialog()).getByRole('heading', { name: 'Cancel Tue 10 Nov?' })).toBeInTheDocument();
    expect(dialog()).toHaveFocus();
    const reason = within(dialog()).getByLabelText('Reason (optional)');
    expect(reason).toHaveAttribute('maxlength', '140');
    expect(reason).not.toBeRequired();
    expect(within(dialog()).getByRole('button', { name: 'Cancel this week' })).toBeEnabled();
    expect(within(dialog()).getByRole('button', { name: 'Keep it on' })).toBeEnabled();
  });

  it('cancels with the typed reason and closes when it works', async () => {
    const { user } = setup();
    const cancelWeek = vi.fn(async () => ({ ok: true as const }));
    useAttendanceStore.setState({ cancelWeek });
    await open(user);
    await user.type(within(dialog()).getByLabelText('Reason (optional)'), 'Venue closed');
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel this week' }));
    expect(cancelWeek).toHaveBeenCalledWith('tue', 'Venue closed');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cancels without a reason', async () => {
    const { user } = setup();
    const cancelWeek = vi.fn(async () => ({ ok: true as const }));
    useAttendanceStore.setState({ cancelWeek });
    await open(user);
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel this week' }));
    expect(cancelWeek).toHaveBeenCalledWith('tue', '');
  });

  it('closes on Keep it on and on Escape without cancelling', async () => {
    const { user } = setup();
    const cancelWeek = vi.fn(async () => ({ ok: true as const }));
    useAttendanceStore.setState({ cancelWeek });
    await open(user);
    await user.click(within(dialog()).getByRole('button', { name: 'Keep it on' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await open(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(cancelWeek).not.toHaveBeenCalled();
  });

  it('shows a character count only near the limit, and stops at 140', async () => {
    const { user } = setup();
    await open(user);
    const reason = within(dialog()).getByLabelText('Reason (optional)');
    await user.click(reason);
    await user.paste('a'.repeat(119));
    expect(within(dialog()).queryByText(/\/140/)).not.toBeInTheDocument();
    await user.paste('a');
    expect(within(dialog()).getByText('120/140')).toBeInTheDocument();
    await user.paste('b'.repeat(40));
    expect(within(dialog()).getByText('140/140')).toBeInTheDocument();
    expect((reason as HTMLInputElement).value).toHaveLength(140);
  });

  it('stays open and shows the message when it fails', async () => {
    const { user } = setup();
    useAttendanceStore.setState({ cancelWeek: vi.fn(async () => ({ ok: false as const, message: OFFLINE })) });
    await open(user);
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel this week' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(OFFLINE);
    expect(dialog()).toBeInTheDocument();
  });

  it('disables its buttons while a write is running', async () => {
    const { user } = setup();
    await open(user);
    act(() => useAttendanceStore.setState({ busy: { tue: true } }));
    expect(within(dialog()).getByRole('button', { name: 'Cancel this week' })).toBeDisabled();
    expect(within(dialog()).getByRole('button', { name: 'Keep it on' })).toBeDisabled();
  });
});

describe('against the real rules', () => {
  let db: PGlite;
  let flags: FakeFlags;
  beforeAll(async () => {
    db = await createDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.exec('truncate public.players, public.attendance_links cascade');
    await db.exec(`insert into public.players (owner_id, id, name) values ('${USER_A}', '11111111-1111-4111-8111-111111111111', 'Ana Reyes')`);
    flags = { offline: false, calls: [] };
    signIn();
    setAttendanceDeps({
      server: () => ({ remote: fakeAttendanceRemote(db, USER_A, flags), userId: USER_A }),
      now: () => Date.now(),
      timezone: () => 'Asia/Manila',
    });
  });
  const code = async () => (await db.query<{ code: string }>('select code from public.attendance_links')).rows[0]?.code;

  it('finds there is no link, creates one and shows the empty counts', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    expect(await screen.findByText('0 in')).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/j/${await code()}`)).toBeInTheDocument();
  });

  it('shows the answers a member gave, after a refresh', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    await screen.findByText('0 in');
    await run(db, 'anon', 'select public.attendance_answer($1, $2, $3, $4)', [await code(), '11111111-1111-4111-8111-111111111111', 'in', false]);
    await act(async () => {
      await useAttendanceStore.getState().refresh('tue');
    });
    expect(screen.getByText('1 in')).toBeInTheDocument();
  });

  it('resets the link through the sheet and shows the new code', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    await screen.findByText('0 in');
    const before = await code();
    await user.click(screen.getByRole('button', { name: 'Reset link' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset link' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const after = await code();
    expect(after).not.toBe(before);
    expect(await screen.findByText(`${window.location.origin}/j/${after}`)).toBeInTheDocument();
  });

  it('cancels the week with a reason, then undoes it', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    await screen.findByText('0 in');
    await user.click(screen.getByRole('button', { name: 'Cancel this week' }));
    await user.type(screen.getByLabelText('Reason (optional)'), 'Venue closed');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel this week' }));
    expect(await screen.findByText(/^Cancelled for \w{3} \d{1,2} \w{3}\. Venue closed$/)).toBeInTheDocument();
    expect(screen.queryByText('0 in')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('0 in')).toBeInTheDocument();
    expect(screen.queryByText(/Cancelled for/)).not.toBeInTheDocument();
  });

  it('shows the offline message and keeps the sheet open when a reset cannot be sent', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    await screen.findByText('0 in');
    const before = await code();
    flags.offline = true;
    await user.click(screen.getByRole('button', { name: 'Reset link' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset link' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(OFFLINE);
    flags.offline = false;
    expect(await code()).toBe(before);
  });

  it('shows the offline message when a link cannot be created', async () => {
    // The mount refresh would learn it is offline first, so it is held back here.
    useAttendanceStore.setState({ refresh: vi.fn(async () => ({ ok: true as const })), lastError: { tue: null } });
    flags.offline = true;
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(OFFLINE);
    expect(flags.calls.some((c) => c.startsWith('upsertLink'))).toBe(true);
  });
});
```

Create `src/ui/attendanceCss.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import css from '../styles/app.css?raw';

// The board section runs to the end of the file and bans the app variables, so this one sits just before it.
const START = css.indexOf('/* Attendance card */');
const END = css.indexOf('/* Board */');
const section = START >= 0 ? css.slice(START, END) : '';

/** The declarations of the first rule in the attendance section whose selector is exactly this one. */
function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(section);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

describe('Attendance card styles', () => {
  it('is its own section, after Home and before the board', () => {
    expect(START).toBeGreaterThan(0);
    expect(css.indexOf('/* Attendance card */', START + 1)).toBe(-1);
    expect(css.slice(0, START)).toContain('/* Home */');
    expect(END).toBeGreaterThan(START);
  });

  it('keeps its buttons at 44 px or more', () => {
    expect(rule('.attendance-btn')).toMatch(/min-height:\s*44px/);
  });

  it('keeps the card out of the way of the hero: it does not grow or shrink', () => {
    expect(rule('.attendance')).toMatch(/flex:\s*none/);
  });

  it('uses the normal surface, line and ink variables', () => {
    const card = rule('.attendance');
    expect(card).toMatch(/background:\s*var\(--surface\)/);
    expect(card).toMatch(/border:[^;]*var\(--line\)/);
    expect(card).toMatch(/color:\s*var\(--ink\)/);
  });

  it('draws the pills from the accent, ink and danger variables', () => {
    expect(rule(".attendance-pill[data-kind='in']")).toMatch(/background:\s*var\(--accent\)/);
    expect(rule(".attendance-pill[data-kind='in']")).toMatch(/color:\s*var\(--accent-ink\)/);
    expect(rule(".attendance-pill[data-kind='out']")).toMatch(/color:\s*var\(--danger\)/);
  });

  it('wraps long links and pills instead of scrolling sideways', () => {
    expect(rule('.attendance-link')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule('.attendance-pills')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.attendance-actions')).toMatch(/flex-wrap:\s*wrap/);
  });

  it('has no hard-coded colours and adds no variables', () => {
    expect(section).toContain('var(--');
    expect(section).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(section).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(section).not.toMatch(/--[a-z-]+\s*:/);
    for (const [, name] of section.matchAll(/var\((--[a-z-]+)/g)) {
      expect(['--surface', '--line', '--ink', '--muted', '--accent', '--accent-ink', '--danger']).toContain(name);
    }
  });

  it('has no em dashes', () => {
    expect(section.length).toBeGreaterThan(100);
    expect(section).not.toContain(String.fromCharCode(0x2014));
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/AttendanceCard.test.tsx src/ui/attendanceCss.test.ts`

Expected: it fails. Test Files `2 failed (2)`, Tests `8 failed (8)`.

- [ ] **Step 3: Write the code**

Apply this patch to `src/styles/app.css`:

```diff
diff --git a/src/styles/app.css b/src/styles/app.css
index 4027b75..8f46a81 100644
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -2536,6 +2536,97 @@ caption {
   from {
     transform: scaleX(0);
   }
+
+/* Attendance card */
+/* A slim card under the Home hero. It sits on the page, not on the lime, so it uses the normal ink and surface. */
+.attendance {
+  flex: none;
+  display: flex;
+  flex-direction: column;
+  gap: 10px;
+  padding: 12px 14px;
+  border: 1px solid var(--line);
+  border-radius: 14px;
+  background: var(--surface);
+  color: var(--ink);
+}
+
+.attendance-head {
+  display: flex;
+  align-items: baseline;
+  justify-content: space-between;
+  gap: 12px;
+}
+
+.attendance-pills {
+  display: flex;
+  flex-wrap: wrap;
+  gap: 6px;
+  margin: 0;
+  padding: 0;
+  list-style: none;
+}
+
+.attendance-pill {
+  padding: 4px 10px;
+  border-radius: 999px;
+  background: color-mix(in srgb, var(--ink) 8%, var(--surface));
+  color: var(--ink);
+  font-size: 14px;
+  font-weight: 700;
+}
+
+.attendance-pill[data-kind='in'] {
+  background: var(--accent);
+  color: var(--accent-ink);
+}
+
+.attendance-pill[data-kind='maybe'] {
+  background: color-mix(in srgb, var(--accent) 22%, var(--surface));
+  color: var(--ink);
+}
+
+.attendance-pill[data-kind='out'] {
+  background: color-mix(in srgb, var(--danger) 12%, var(--surface));
+  color: var(--danger);
+}
+
+.attendance-line {
+  font-size: 13px;
+  color: var(--muted);
+}
+
+.attendance-count {
+  margin-top: 4px;
+  font-size: 13px;
+  text-align: right;
+}
+
+.attendance-link {
+  font-size: 13px;
+  color: var(--muted);
+  overflow-wrap: anywhere;
+}
+
+.attendance-notice {
+  padding: 10px 12px;
+  border: 1px solid var(--line);
+  border-radius: 12px;
+  background: color-mix(in srgb, var(--accent) 18%, var(--surface));
+  color: var(--ink);
+  overflow-wrap: anywhere;
+}
+
+.attendance-actions {
+  display: flex;
+  flex-wrap: wrap;
+  gap: 8px;
+}
+
+.attendance-btn {
+  min-height: 44px;
+  padding: 0 14px;
+  font-size: 14px;
 }
 
 /* Board */
```

Create `src/ui/AttendanceCard.tsx`:

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { shortDate } from '../store/attendance';
import { formatClock, type Slot } from '../store/slots';
import { shareUrl, titleFor, weekdayName } from '../sync/attendance/links';
import { useAttendanceStore, type AttendanceResult } from '../sync/attendance/store';
import type { AttendanceStatus } from '../sync/attendance/types';
import { useAuthStore } from '../sync/auth';
import { CancelSheet, ResetSheet } from './AttendanceSheets';
import { ATTENDANCE_PREVIEW_KEY, useBoolPref } from './prefs';
import { useAttendance } from './useAttendance';

interface Props {
  slot: Slot;
  /** Opens the place where the organizer signs in. */
  onSignIn: () => void;
}

/** Answers older than this show when they were fetched. */
const STALE_MS = 2 * 60_000;
const STATUS_LABEL: Record<AttendanceStatus, string> = { in: 'In', maybe: 'Maybe', out: 'Out' };

/** The time of day of a moment, in the app's 12-hour style: "4:12 pm". */
const clock = (ms: number) => {
  const d = new Date(ms);
  return formatClock(d.getHours() * 60 + d.getMinutes());
};

/** "Tue 10 Nov" from a YYYY-MM-DD date, read as a local date. */
function dateLabel(playDate: string): string {
  const [y, m, d] = playDate.split('-').map(Number);
  return shortDate(new Date(y, m - 1, d).getTime());
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Shell({ weekday, children }: { weekday?: string; children: ReactNode }) {
  return (
    <section className="attendance" aria-labelledby="attendance-title">
      <div className="attendance-head">
        <h2 id="attendance-title" className="section-title">
          Attendance link
        </h2>
        {weekday && <span className="muted">{weekday}</span>}
      </div>
      {children}
    </section>
  );
}

/** The organizer's attendance link for one saved slot, under the hero on Home. */
export function AttendanceCard({ slot, onSignIn }: Props) {
  const [preview] = useBoolPref(ATTENDANCE_PREVIEW_KEY, false);
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.userId);
  useAttendance(slot.id);
  const ownerId = useAttendanceStore((s) => s.ownerId);
  const saved = useAttendanceStore((s) => s.links[slot.id]);
  const savedSummary = useAttendanceStore((s) => s.summaries[slot.id]);
  const savedChange = useAttendanceStore((s) => s.lastChange[slot.id]);
  const savedError = useAttendanceStore((s) => s.lastError[slot.id]);
  const busy = useAttendanceStore((s) => !!s.busy[slot.id]);
  const [sheet, setSheet] = useState<'reset' | 'cancel' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [shared, setShared] = useState<'copied' | 'field' | null>(null);
  const fieldRef = useRef<HTMLInputElement>(null);

  // A different account's copy is not shown while the new one loads.
  const mine = ownerId === null || userId === null || ownerId === userId;
  const link = mine ? saved : undefined;
  const summary = mine ? savedSummary : undefined;
  const change = mine ? savedChange : null;
  const error = mine ? savedError : undefined;

  useEffect(() => {
    if (shared === 'field') fieldRef.current?.select();
  }, [shared]);

  if (!preview || status === 'unconfigured' || status === 'loading') return null;

  if (status === 'signedOut' || status === 'linkSent') {
    return (
      <Shell>
        <p className="muted">Sign in to share an attendance link with your players.</p>
        <div className="attendance-actions">
          <button type="button" className="btn btn-live attendance-btn" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </Shell>
    );
  }

  // Sign-in that cannot be checked is not signed out: saved answers stay, and nothing asks to sign in.
  if (status === 'unknown' && !link) return null;

  // Read when pressed, so the newest actions run.
  const store = () => useAttendanceStore.getState();

  /** Runs a change. A failure keeps the message; a success clears it. */
  async function run(act: () => Promise<AttendanceResult>, onDone?: () => void) {
    setProblem(null);
    const result = await act();
    if (result.ok) onDone?.();
    else setProblem(result.message);
  }

  async function share(url: string) {
    setShared(null);
    setProblem(null);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: titleFor(slot), url });
        return;
      } catch (e) {
        // The person closed the share sheet: nothing went wrong.
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared('copied');
    } catch {
      setShared('field');
    }
  }

  function closeSheet() {
    setSheet(null);
    setProblem(null);
  }

  if (!link) {
    const failed = error !== undefined && error !== null;
    return (
      <Shell weekday={weekdayName(slot.weekday)}>
        {error === undefined && (
          <p className="muted" role="status">
            Checking answers
          </p>
        )}
        {failed && <LoadFailed onRetry={() => void store().refresh(slot.id)} />}
        {error === null && (
          <div className="attendance-actions">
            <button type="button" className="btn btn-live attendance-btn" disabled={busy} onClick={() => void run(() => store().ensureLink(slot))}>
              Create link
            </button>
          </div>
        )}
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
      </Shell>
    );
  }

  if (!summary) {
    return (
      <Shell weekday={weekdayName(slot.weekday)}>
        {error ? (
          <LoadFailed onRetry={() => void store().refresh(slot.id)} />
        ) : (
          <p className="muted" role="status">
            Checking answers
          </p>
        )}
      </Shell>
    );
  }

  const stale = Date.now() - summary.fetchedAt > STALE_MS || (error !== undefined && error !== null);
  const staleLines = stale && (
    <>
      <p className="attendance-line">Updated {clock(summary.fetchedAt)}</p>
      {error === 'offline' && <p className="attendance-line">Offline, showing the last list</p>}
    </>
  );
  // While a sheet is open it shows the message itself.
  const alert = problem && sheet === null && (
    <p className="error" role="alert">
      {problem}
    </p>
  );

  if (summary.cancelled) {
    const { reason } = summary.cancelled;
    return (
      <Shell weekday={weekdayName(slot.weekday)}>
        <p className="attendance-notice">
          Cancelled for {dateLabel(summary.playDate)}.{reason ? ` ${reason}` : ''}
        </p>
        {staleLines}
        <div className="attendance-actions">
          <button type="button" className="btn attendance-btn" disabled={busy} onClick={() => void run(() => store().undoCancel(slot.id))}>
            Undo
          </button>
        </div>
        {alert}
      </Shell>
    );
  }

  const url = shareUrl(window.location.origin, link.code);
  const { counts, waiting } = summary;
  return (
    <Shell weekday={weekdayName(slot.weekday)}>
      <ul className="attendance-pills" aria-label="Answers">
        <li className="attendance-pill" data-kind="in">{`${counts.in} in`}</li>
        <li className="attendance-pill" data-kind="maybe">{`${counts.maybe} maybe`}</li>
        <li className="attendance-pill" data-kind="out">{`${counts.out} out`}</li>
        {summary.friends > 0 && (
          <li className="attendance-pill" data-kind="friend">
            {plural(summary.friends, 'friend', 'friends')}
          </li>
        )}
      </ul>
      {staleLines}
      {change && <p className="attendance-line">{`${change.player} changed to ${STATUS_LABEL[change.to]} at ${clock(change.at)}.`}</p>}
      {waiting.length > 0 && <p className="attendance-line">{`${plural(waiting.length, 'new name', 'new names')} to review`}</p>}
      <p className="attendance-link">{url}</p>
      <div className="attendance-actions">
        <button type="button" className="btn btn-live attendance-btn" disabled={busy} onClick={() => void share(url)}>
          Share
        </button>
        <button type="button" className="btn attendance-btn" disabled={busy} onClick={() => setSheet('reset')}>
          Reset link
        </button>
        <button type="button" className="btn attendance-btn" disabled={busy} onClick={() => setSheet('cancel')}>
          Cancel this week
        </button>
      </div>
      {shared === 'copied' && (
        <p className="attendance-line" role="status">
          Link copied
        </p>
      )}
      {shared === 'field' && <input ref={fieldRef} className="field" readOnly aria-label="Link" value={url} />}
      {alert}
      {sheet === 'reset' && (
        <ResetSheet busy={busy} error={problem} onClose={closeSheet} onConfirm={() => void run(() => store().resetLink(slot.id), closeSheet)} />
      )}
      {sheet === 'cancel' && (
        <CancelSheet
          dateLabel={dateLabel(summary.playDate)}
          busy={busy}
          error={problem}
          onClose={closeSheet}
          onConfirm={(reason) => void run(() => store().cancelWeek(slot.id, reason), closeSheet)}
        />
      )}
    </Shell>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <>
      <p className="muted">Could not load the answers. Try again.</p>
      <div className="attendance-actions">
        <button type="button" className="btn attendance-btn" onClick={onRetry}>
          Retry
        </button>
      </div>
    </>
  );
}
```

Create `src/ui/AttendanceSheets.tsx`:

```tsx
import { useState } from 'react';
import { Sheet } from './Sheet';

const MAX_REASON = 140;
/** The count shows from here, so it does not nag while there is plenty of room. */
const COUNT_FROM = 120;

interface ResetProps {
  busy: boolean;
  /** Why the last try failed, if it did. */
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** Asks before a new link replaces the old one. */
export function ResetSheet({ busy, error, onConfirm, onClose }: ResetProps) {
  return (
    <Sheet title="Reset the link?" onClose={onClose}>
      <p>Members who have the old link will need the new one. Answers are kept.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}>
        Reset link
      </button>
      <button type="button" className="btn" disabled={busy} onClick={onClose}>
        Keep it
      </button>
    </Sheet>
  );
}

interface CancelProps {
  /** The date being cancelled, like "Tue 10 Nov". */
  dateLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/** Cancels one week, with a reason members can read. */
export function CancelSheet({ dateLabel, busy, error, onConfirm, onClose }: CancelProps) {
  const [reason, setReason] = useState('');
  return (
    <Sheet title={`Cancel ${dateLabel}?`} onClose={onClose}>
      <div>
        <label className="label" htmlFor="attendance-reason">
          Reason (optional)
        </label>
        <input
          id="attendance-reason"
          className="field"
          type="text"
          maxLength={MAX_REASON}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {reason.length >= COUNT_FROM && (
          <p className="muted attendance-count">
            {reason.length}/{MAX_REASON}
          </p>
        )}
      </div>
      <p className="muted">Members will see your reason. Answers are kept if you undo this.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn btn-danger" disabled={busy} onClick={() => onConfirm(reason)}>
        Cancel this week
      </button>
      <button type="button" className="btn" disabled={busy} onClick={onClose}>
        Keep it on
      </button>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/AttendanceCard.test.tsx src/ui/attendanceCss.test.ts`

Expected: it passes. Test Files `2 passed (2)`, Tests `78 passed (78)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 1759 tests across 130 files.

- [ ] **Step 5: Commit**

```bash
git add src/ui/AttendanceCard.test.tsx src/ui/attendanceCss.test.ts src/styles/app.css src/ui/AttendanceCard.tsx src/ui/AttendanceSheets.tsx
git commit -m "Add the attendance card with share, reset and cancel week"
```

---

### Task 10: Show the card on Home

`HomeScreen` shows the card between the hero and the last-session row, only for a saved slot (not a one-off), not while a session is live, and not on the done card. It gets the saved slot, not the one with this-time-only edits. `App` starts and stops `startAttendanceSync` and passes "open Settings" as the sign-in action.

**Files:**
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/HomeScreen.tsx`
- Create: `src/ui/attendanceApp.test.tsx`
- Create: `src/ui/attendanceHome.test.tsx`
- Create: `src/ui/attendanceHomeProps.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/attendanceApp.test.tsx`:

```tsx
import type { Session } from '@supabase/supabase-js';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../sync/client', () => ({ getSupabase: () => backend.client }));

const sync = vi.hoisted(() => ({ stop: vi.fn(), start: vi.fn() }));
vi.mock('../sync/attendance/start', () => ({
  startAttendanceSync: sync.start,
}));

const signedOutClient = () => ({
  auth: {
    getSession: vi.fn().mockResolvedValue({ data: { session: null as Session | null }, error: null }),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    signInWithOtp: vi.fn(),
    signOut: vi.fn(),
  },
});

async function startApp() {
  vi.resetModules();
  const { default: App } = await import('./App');
  return render(<App />);
}

beforeEach(() => {
  localStorage.clear();
  sync.stop.mockReset();
  sync.start.mockReset().mockReturnValue(sync.stop);
  backend.client = signedOutClient();
});
afterEach(() => cleanup());

describe('App and the attendance link', () => {
  it('starts the attendance sync once and stops it when the app goes away', async () => {
    const view = await startApp();
    expect(sync.start).toHaveBeenCalledTimes(1);
    expect(sync.stop).not.toHaveBeenCalled();
    view.unmount();
    expect(sync.stop).toHaveBeenCalledTimes(1);
  });

  it('sends the card\'s Sign in to Settings', async () => {
    localStorage.setItem('pikl.attendancePreview', 'true');
    const user = userEvent.setup();
    await startApp();
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('shows no card on Home while the preview is off', async () => {
    await startApp();
    await screen.findByRole('radiogroup', { name: 'Sessions' });
    expect(screen.queryByRole('heading', { name: 'Attendance link' })).not.toBeInTheDocument();
  });
});
```

Create `src/ui/attendanceHome.test.tsx`:

```tsx
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newTestSession } from '../engine/testing';
import type { HistoryEntry } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { DEFAULT_SLOTS, useSlotsStore } from '../store/slots';
import { resetAttendanceDeps, setAttendanceDeps, useAttendanceStore } from '../sync/attendance/store';
import type { Summary } from '../sync/attendance/types';
import { useAuthStore } from '../sync/auth';
import { useSyncStore } from '../sync/syncStore';
import { HomeScreen } from './HomeScreen';
import { ATTENDANCE_PREVIEW_KEY, setBoolPref } from './prefs';

// Saturday 7 Nov 2026, noon: the Saturday slot is selected.
const NOW = new Date(2026, 10, 7, 12).getTime();

const summary = (slotId: string): Summary => ({
  slotId,
  code: `code-${slotId}`,
  playDate: '2026-11-07',
  cancelled: null,
  counts: { in: 4, maybe: 1, out: 0, late: 0 },
  friends: 0,
  waiting: [],
  answers: {},
  names: {},
  fetchedAt: NOW,
});

function seedLinks() {
  useAttendanceStore.setState({
    ownerId: 'user-a',
    links: { sat: { code: 'code-sat' }, tue: { code: 'code-tue' } },
    summaries: { sat: summary('sat'), tue: summary('tue') },
    lastChange: {},
    lastError: { sat: null, tue: null },
    busy: {},
  });
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ status: 'signedIn', email: 'o@example.com', userId: 'user-a', error: null, busy: false });
  useSyncStore.setState({ status: 'off', pending: 0, lastSyncedAt: null });
  useSlotsStore.setState({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {}, persistent: true });
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useHistoryStore.setState({ entries: [], loaded: true, persistent: true });
  useRosterStore.setState({ players: [], loaded: true });
  useAttendanceStore.getState().clear();
  setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
  setAttendanceDeps({ server: () => null, now: () => Date.now(), timezone: () => 'Asia/Manila' });
  seedLinks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetAttendanceDeps();
});

function setup(onSignIn?: () => void) {
  const user = userEvent.setup({ advanceTimers: () => {} });
  render(<HomeScreen onStart={vi.fn()} onResume={vi.fn()} onHistory={vi.fn()} onViewSummary={vi.fn()} onSignIn={onSignIn} />);
  return user;
}

const card = () => screen.queryByRole('heading', { name: 'Attendance link' });
const inCard = () => within(document.querySelector<HTMLElement>('.attendance')!);

describe('the attendance card on Home', () => {
  it('shows for the selected slot, between the hero and the last-session row', () => {
    useHistoryStore.setState({
      entries: [{ id: 'e1', name: 'Open play', createdAt: NOW - 3 * 86_400_000, endedAt: NOW - 3 * 86_400_000 + 3_600_000, games: 3, session: newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }) } as HistoryEntry],
    });
    setup();
    expect(card()).toBeInTheDocument();
    expect(inCard().getByText('Saturday')).toBeInTheDocument();
    expect(screen.getByText('4 in')).toBeInTheDocument();
    const hero = document.querySelector('.home-hero')!;
    const section = document.querySelector('.attendance')!;
    const last = document.querySelector('.home-last')!;
    expect(hero.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('follows the chip that is picked', async () => {
    const user = setup();
    await user.click(screen.getByRole('radio', { name: 'Tue 10' }));
    expect(inCard().getByText('Tuesday')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Thu 12' }));
    // Thursday has no link and nothing saved: it is checking, and it still shows its own weekday.
    expect(inCard().getByText('Thursday')).toBeInTheDocument();
    expect(inCard().getByText('Checking answers')).toBeInTheDocument();
    expect(screen.queryByText('4 in')).not.toBeInTheDocument();
  });

  it('does not show for a one-off session', async () => {
    const user = setup();
    await user.click(screen.getByRole('radio', { name: 'One-off session' }));
    expect(card()).not.toBeInTheDocument();
  });

  it('does not show while a session is live', () => {
    useSessionStore.setState({ session: { ...newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }), createdAt: NOW - 1_800_000 } });
    setup();
    expect(screen.getByRole('button', { name: 'Back to session' })).toBeInTheDocument();
    expect(card()).not.toBeInTheDocument();
  });

  it('does not show on the done card', () => {
    const created = new Date(2026, 10, 7, 8).getTime();
    useHistoryStore.setState({
      entries: [{ id: 'd1', name: 'Open play', createdAt: created, endedAt: created + 3_600_000, games: 3, session: { ...newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }), createdAt: created, endedAt: created + 3_600_000 } }],
    });
    setup();
    expect(document.querySelector('.home-hero-done')).toBeInTheDocument();
    expect(card()).not.toBeInTheDocument();
  });

  it('does not show when the preview is off, so Home is as it was', () => {
    localStorage.clear();
    setup();
    expect(card()).not.toBeInTheDocument();
    expect(document.querySelector('.attendance')).toBeNull();
  });

  it('calls onSignIn from the sign-in prompt', async () => {
    useAuthStore.setState({ status: 'signedOut', userId: null });
    const onSignIn = vi.fn();
    const user = setup(onSignIn);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('does not fail when no onSignIn is given', async () => {
    useAuthStore.setState({ status: 'signedOut', userId: null });
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(card()).toBeInTheDocument();
  });
});
```

Create `src/ui/attendanceHomeProps.test.tsx`:

```tsx
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SLOTS, useSlotsStore, type Slot } from '../store/slots';
import { useHistoryStore } from '../store/historyStore';
import { useSessionStore } from '../store/sessionStore';
import { useRosterStore } from '../store/rosterStore';

const seen = vi.hoisted(() => ({ props: [] as { slot: Slot; onSignIn: () => void }[] }));
vi.mock('./AttendanceCard', () => ({
  AttendanceCard: (props: { slot: Slot; onSignIn: () => void }) => {
    seen.props.push(props);
    return null;
  },
}));

import { HomeScreen } from './HomeScreen';

beforeEach(() => {
  localStorage.clear();
  seen.props = [];
  useSlotsStore.setState({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {}, persistent: true });
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useHistoryStore.setState({ entries: [], loaded: true, persistent: true });
  useRosterStore.setState({ players: [], loaded: true });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 7, 12));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('what Home hands the attendance card', () => {
  it('gives it the saved slot, not the one with this-time-only edits', () => {
    useSlotsStore.getState().setTonight('sat', { venue: 'Elsewhere', courts: 6 });
    const onSignIn = vi.fn();
    render(<HomeScreen onStart={vi.fn()} onResume={vi.fn()} onHistory={vi.fn()} onViewSummary={vi.fn()} onSignIn={onSignIn} />);
    const last = seen.props[seen.props.length - 1];
    expect(last.slot).toBe(useSlotsStore.getState().slots.find((s) => s.id === 'sat'));
    expect(last.slot.venue).toBeUndefined();
    expect(last.slot.courts).toBeUndefined();
    last.onSignIn();
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/attendanceApp.test.tsx src/ui/attendanceHome.test.tsx src/ui/attendanceHomeProps.test.tsx`

Expected: it fails. Test Files `3 failed (3)`, Tests `7 failed | 5 passed (12)`.

- [ ] **Step 3: Write the code**

Apply this patch to `src/ui/App.tsx`:

```diff
diff --git a/src/ui/App.tsx b/src/ui/App.tsx
index 0f5b895..4514971 100644
--- a/src/ui/App.tsx
+++ b/src/ui/App.tsx
@@ -1,6 +1,7 @@
 import { useEffect, useRef, useState } from 'react';
 import { useRosterStore } from '../store/rosterStore';
 import { useAuthStore } from '../sync/auth';
+import { startAttendanceSync } from '../sync/attendance/start';
 import { startSyncCoordinator } from '../sync/coordinator';
 import { useUpdateStore } from '../pwa';
 import { useHistoryStore } from '../store/historyStore';
@@ -188,6 +189,9 @@ export default function App() {
   // Keeps saved players backed up while signed in. It does nothing without a backend or a signed-in organizer.
   useEffect(() => startSyncCoordinator(), []);
 
+  // Keeps each attendance link in step with its slot, and drops the saved answers when the account changes.
+  useEffect(() => startAttendanceSync(), []);
+
   const overlay =
     view === 'saved' ? (
       <SavedPlayersScreen onBack={() => screens.back(savedFrom)} />
@@ -218,6 +222,7 @@ export default function App() {
           onResume={() => screens.back('live')}
           onHistory={() => openHistory('home')}
           onViewSummary={(id) => openHistory('home', id)}
+          onSignIn={openSettings}
         />
       </>
     );
@@ -237,7 +242,7 @@ export default function App() {
         {view === 'home' && (
           <>
             <SignInBanner onSignIn={openSettings} />
-            <HomeScreen onStart={openSetup} onResume={() => {}} onHistory={() => openHistory('home')} onViewSummary={(id) => openHistory('home', id)} />
+            <HomeScreen onStart={openSetup} onResume={() => {}} onHistory={() => openHistory('home')} onViewSummary={(id) => openHistory('home', id)} onSignIn={openSettings} />
           </>
         )}
         {overlay}
```

Apply this patch to `src/ui/HomeScreen.tsx`:

```diff
diff --git a/src/ui/HomeScreen.tsx b/src/ui/HomeScreen.tsx
index 9d29345..11511fd 100644
--- a/src/ui/HomeScreen.tsx
+++ b/src/ui/HomeScreen.tsx
@@ -4,6 +4,7 @@ import { chipLabel, ctaGrade, doneEntry, sessionWeekday, sortedSlots, weeksPlaye
 import { useHistoryStore } from '../store/historyStore';
 import { useSessionStore } from '../store/sessionStore';
 import { effectiveSlot, nextSlot, timestampAt, useSlotsStore, type Slot } from '../store/slots';
+import { AttendanceCard } from './AttendanceCard';
 import { EditSlotSheet, type SlotPatch, type SlotScope } from './EditSlotSheet';
 import { DoneCard, ViewSummaryRow, useSharePicture } from './HomeDone';
 import { OneOffHero, SlotHero } from './HomeHero';
@@ -26,9 +27,12 @@ interface Props {
   onHistory: () => void;
   /** Opens the summary of a finished session by its history id. */
   onViewSummary: (entryId: string) => void;
+  /** Opens the place where the organizer signs in, for the attendance card. */
+  onSignIn?: () => void;
 }
 
 const ONE_OFF = 'one-off';
+const noop = () => {};
 
 /** The slim row under the hero: the last session and how often the group played. */
 function LastRow({ onHistory }: { onHistory: () => void }) {
@@ -59,7 +63,7 @@ function LastRow({ onHistory }: { onHistory: () => void }) {
   );
 }
 
-export function HomeScreen({ onStart, onResume, onHistory, onViewSummary }: Props) {
+export function HomeScreen({ onStart, onResume, onHistory, onViewSummary, onSignIn }: Props) {
   const slots = useSlotsStore((s) => s.slots);
   const venues = useSlotsStore((s) => s.venues);
   const tonight = useSlotsStore((s) => s.tonight);
@@ -170,6 +174,9 @@ export function HomeScreen({ onStart, onResume, onHistory, onViewSummary }: Prop
 
       {hero}
 
+      {/* The saved slot, not the one with this-time-only edits: the link is about the weekly slot. */}
+      {selected && !live && !showDone && <AttendanceCard slot={selected} onSignIn={onSignIn ?? noop} />}
+
       {showDone ? <ViewSummaryRow onClick={() => onViewSummary(done.id)} /> : <LastRow onHistory={onHistory} />}
 
       {showDone && sharing.message && (
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/attendanceApp.test.tsx src/ui/attendanceHome.test.tsx src/ui/attendanceHomeProps.test.tsx`

Expected: it passes. Test Files `3 passed (3)`, Tests `12 passed (12)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 1771 tests across 133 files.

- [ ] **Step 5: Commit**

```bash
git add src/ui/attendanceApp.test.tsx src/ui/attendanceHome.test.tsx src/ui/attendanceHomeProps.test.tsx src/ui/App.tsx src/ui/HomeScreen.tsx
git commit -m "Show the attendance card on Home"
```

---

### Task 11: Tighten the card on small phones

Found in the browser check: on a 360 by 640 phone the first version took 277 px and crushed the slot card. The small lines are grouped, the gaps tightened, and the three buttons share one row. Tests cover the grouping and the rule.

**Files:**
- Modify: `src/styles/app.css`
- Modify: `src/ui/AttendanceCard.tsx`
- Modify: `src/ui/AttendanceCard.test.tsx`
- Modify: `src/ui/attendanceCss.test.ts`

- [ ] **Step 1: Write the failing tests**

Apply this patch to `src/ui/AttendanceCard.test.tsx`:

```diff
diff --git a/src/ui/AttendanceCard.test.tsx b/src/ui/AttendanceCard.test.tsx
index a734098..9e8a4cd 100644
--- a/src/ui/AttendanceCard.test.tsx
+++ b/src/ui/AttendanceCard.test.tsx
@@ -321,6 +321,24 @@ describe('the link state', () => {
     expect([...order].sort((a, b) => a - b)).toEqual(order);
   });
 
+  it('keeps the small lines together in one block, and has no block when there are none', () => {
+    seed({ fetchedAt: new Date(2026, 10, 9, 16, 12).getTime(), waiting: [{ id: 'g1', name: 'Mika', broughtBy: null }] }, { change: { player: 'Ben', from: 'in', to: 'out', at: NOW } });
+    const first = setup();
+    const meta = document.querySelectorAll('.attendance-meta');
+    expect(meta).toHaveLength(1);
+    expect(meta[0].textContent).toBe('Updated 4:12 pmBen changed to Out at 4:20 pm.1 new name to review');
+    first.unmount();
+    seed();
+    setup();
+    expect(document.querySelector('.attendance-meta')).toBeNull();
+  });
+
+  it('puts only the stale lines in the block of a cancelled week', () => {
+    seed({ cancelled: { reason: null }, fetchedAt: new Date(2026, 10, 9, 16, 12).getTime() });
+    setup();
+    expect(document.querySelector('.attendance-meta')!.textContent).toBe('Updated 4:12 pm');
+  });
+
   it('disables every button while a write is running', () => {
     seed({}, { busy: true });
     setup();
```

Apply this patch to `src/ui/attendanceCss.test.ts`:

```diff
diff --git a/src/ui/attendanceCss.test.ts b/src/ui/attendanceCss.test.ts
index 61af5c4..e3be27a 100644
--- a/src/ui/attendanceCss.test.ts
+++ b/src/ui/attendanceCss.test.ts
@@ -30,6 +30,11 @@ describe('Attendance card styles', () => {
     expect(rule('.attendance')).toMatch(/flex:\s*none/);
   });
 
+  it('keeps the small lines close together so the card stays short', () => {
+    expect(rule('.attendance-meta')).toMatch(/display:\s*flex/);
+    expect(rule('.attendance-meta')).toMatch(/gap:\s*[0-4]px/);
+  });
+
   it('uses the normal surface, line and ink variables', () => {
     const card = rule('.attendance');
     expect(card).toMatch(/background:\s*var\(--surface\)/);
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/AttendanceCard.test.tsx src/ui/attendanceCss.test.ts`

Expected: it fails. Test Files `2 failed (2)`, Tests `3 failed | 78 passed (81)`.

- [ ] **Step 3: Write the code**

Apply this patch to `src/styles/app.css`:

```diff
diff --git a/src/styles/app.css b/src/styles/app.css
index 8f46a81..deea19f 100644
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -2543,7 +2543,7 @@ caption {
   flex: none;
   display: flex;
   flex-direction: column;
-  gap: 10px;
+  gap: 8px;
   padding: 12px 14px;
   border: 1px solid var(--line);
   border-radius: 14px;
@@ -2591,6 +2591,12 @@ caption {
   color: var(--danger);
 }
 
+.attendance-meta {
+  display: flex;
+  flex-direction: column;
+  gap: 2px;
+}
+
 .attendance-line {
   font-size: 13px;
   color: var(--muted);
@@ -2620,12 +2626,12 @@ caption {
 .attendance-actions {
   display: flex;
   flex-wrap: wrap;
-  gap: 8px;
+  gap: 6px;
 }
 
 .attendance-btn {
   min-height: 44px;
-  padding: 0 14px;
+  padding: 0 10px;
   font-size: 14px;
 }
 
```

Apply this patch to `src/ui/AttendanceCard.tsx`:

```diff
diff --git a/src/ui/AttendanceCard.tsx b/src/ui/AttendanceCard.tsx
index afa7e49..5e94b08 100644
--- a/src/ui/AttendanceCard.tsx
+++ b/src/ui/AttendanceCard.tsx
@@ -176,6 +176,14 @@ export function AttendanceCard({ slot, onSignIn }: Props) {
       {error === 'offline' && <p className="attendance-line">Offline, showing the last list</p>}
     </>
   );
+  // The small lines sit close together, so the card stays short on a small phone.
+  const meta = (show: boolean, extra?: ReactNode) =>
+    show && (
+      <div className="attendance-meta">
+        {staleLines}
+        {extra}
+      </div>
+    );
   // While a sheet is open it shows the message itself.
   const alert = problem && sheet === null && (
     <p className="error" role="alert">
@@ -190,7 +198,7 @@ export function AttendanceCard({ slot, onSignIn }: Props) {
         <p className="attendance-notice">
           Cancelled for {dateLabel(summary.playDate)}.{reason ? ` ${reason}` : ''}
         </p>
-        {staleLines}
+        {meta(stale)}
         <div className="attendance-actions">
           <button type="button" className="btn attendance-btn" disabled={busy} onClick={() => void run(() => store().undoCancel(slot.id))}>
             Undo
@@ -215,9 +223,13 @@ export function AttendanceCard({ slot, onSignIn }: Props) {
           </li>
         )}
       </ul>
-      {staleLines}
-      {change && <p className="attendance-line">{`${change.player} changed to ${STATUS_LABEL[change.to]} at ${clock(change.at)}.`}</p>}
-      {waiting.length > 0 && <p className="attendance-line">{`${plural(waiting.length, 'new name', 'new names')} to review`}</p>}
+      {meta(
+        stale || !!change || waiting.length > 0,
+        <>
+          {change && <p className="attendance-line">{`${change.player} changed to ${STATUS_LABEL[change.to]} at ${clock(change.at)}.`}</p>}
+          {waiting.length > 0 && <p className="attendance-line">{`${plural(waiting.length, 'new name', 'new names')} to review`}</p>}
+        </>,
+      )}
       <p className="attendance-link">{url}</p>
       <div className="attendance-actions">
         <button type="button" className="btn btn-live attendance-btn" disabled={busy} onClick={() => void share(url)}>
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/AttendanceCard.test.tsx src/ui/attendanceCss.test.ts`

Expected: it passes. Test Files `2 passed (2)`, Tests `81 passed (81)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 1774 tests across 133 files.

- [ ] **Step 5: Commit**

```bash
git add src/ui/AttendanceCard.test.tsx src/ui/attendanceCss.test.ts src/styles/app.css src/ui/AttendanceCard.tsx
git commit -m "Tighten the attendance card on small phones"
```

---

### Task 12: Cover the gaps the second break-it-on-purpose run found (screens)

Tests only. They were added after deliberate breaks to Tasks 7 to 11 got through. They pass on the code from Tasks 7 to 11.

**Files:**
- Modify: `src/ui/AttendanceCard.test.tsx`

- [ ] **Step 1: Add the tests**

Apply this patch to `src/ui/AttendanceCard.test.tsx`:

```diff
diff --git a/src/ui/AttendanceCard.test.tsx b/src/ui/AttendanceCard.test.tsx
index 9e8a4cd..50c60c9 100644
--- a/src/ui/AttendanceCard.test.tsx
+++ b/src/ui/AttendanceCard.test.tsx
@@ -174,6 +174,7 @@ describe('which states show', () => {
     const { user } = setup();
     expect(screen.getByText('Could not load the answers. Try again.')).toBeInTheDocument();
     expect(screen.queryByText('Checking answers')).not.toBeInTheDocument();
+    expect(screen.queryByRole('button', { name: 'Create link' })).not.toBeInTheDocument();
     const refresh = vi.fn(async () => ({ ok: true as const }));
     useAttendanceStore.setState({ refresh });
     await user.click(screen.getByRole('button', { name: 'Retry' }));
@@ -242,6 +243,12 @@ describe('the link state', () => {
     expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();
   });
 
+  it('shows the stale line for answers a few minutes old', () => {
+    seed({ fetchedAt: NOW - 181_000 });
+    setup();
+    expect(screen.getByText('Updated 4:16 pm')).toBeInTheDocument();
+  });
+
   it('uses the 12-hour clock for the morning and for noon', () => {
     vi.setSystemTime(new Date(2026, 10, 9, 13, 0));
     seed({ fetchedAt: new Date(2026, 10, 9, 12, 5).getTime() });
@@ -429,6 +436,25 @@ describe('Create link', () => {
   });
 });
 
+describe('a message from an earlier try', () => {
+  it('goes away when the next try starts', async () => {
+    signIn();
+    useAttendanceStore.setState({ lastError: { tue: null } });
+    let release: () => void = () => {};
+    const ensureLink = vi
+      .fn()
+      .mockResolvedValueOnce({ ok: false, message: OFFLINE })
+      .mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ ok: true }))));
+    useAttendanceStore.setState({ ensureLink });
+    const { user } = setup();
+    await user.click(screen.getByRole('button', { name: 'Create link' }));
+    expect(await screen.findByRole('alert')).toHaveTextContent(OFFLINE);
+    await user.click(screen.getByRole('button', { name: 'Create link' }));
+    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
+    await act(async () => release());
+  });
+});
+
 describe('Share', () => {
   beforeEach(() => {
     signIn();
@@ -562,6 +588,7 @@ describe('the Reset link sheet', () => {
     await user.click(screen.getByRole('button', { name: 'Reset link' }));
     await user.click(within(dialog()).getByRole('button', { name: 'Reset link' }));
     expect(await within(dialog()).findByRole('alert')).toHaveTextContent(OFFLINE);
+    expect(screen.getAllByRole('alert')).toHaveLength(1);
     expect(dialog()).toBeInTheDocument();
   });
 
```

- [ ] **Step 2: Run them, then the whole project**

Run: `npx vitest run src/ui/AttendanceCard.test.tsx`

Expected: it passes. Test Files `1 passed (1)`, Tests `74 passed (74)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 1776 tests across 133 files.

- [ ] **Step 3: Commit**

```bash
git add src/ui/AttendanceCard.test.tsx
git commit -m "Cover a gap found by the mutation check"
```

---

### Task 13: Break it on purpose, then check it for real

The tests are only worth trusting if they fail when the code is wrong. This script makes 150 deliberate breaks (82 to the data layer, 68 to the screens), one at a time, runs the test files that should catch each, and puts the file back. Every break must make a test fail.

**Files:** none changed (the script restores every file).

- [ ] **Step 1: Save the script**

Save this outside the project, so a break can never be committed by accident.

Create `/tmp/mutate-attendance-org.py`:

```python
#!/usr/bin/env python3
"""Breaks the attendance organizer code on purpose, one change at a time. Every break must make a listed test fail."""
import subprocess, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
# (part, file, old text, new text, test files that must fail)
BREAKS = [
 ('A', 'src/sync/attendance/links.ts', 'TIMEZONE.test(raw) ? raw : DEFAULT_TIMEZONE', "TIMEZONE.test(raw) ? raw : 'UTC'", ['src/sync/attendance/links.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/links.ts', '/^[A-Za-z_]+(\\/[A-Za-z0-9_+-]+)*$/', '/^[A-Za-z_]+(\\/[A-Za-z0-9_+-]+)*/', ['src/sync/attendance/links.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/links.ts', "['Sunday', 'Monday'", "['Monday', 'Sunday'", ['src/sync/attendance/links.test.ts']),
 ('A', 'src/sync/attendance/links.ts', '`${weekdayName(slot.weekday)} open play`', '`${weekdayName(slot.weekday)} open-play`', ['src/sync/attendance/links.test.ts', 'src/sync/attendance/remote.test.ts', 'src/sync/attendance/start.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/links.ts', 'venue: slot.venue?.trim() || null', 'venue: slot.venue ?? null', ['src/sync/attendance/links.test.ts']),
 ('A', 'src/sync/attendance/links.ts', 'start_min: slot.startMin ?? null', 'start_min: slot.startMin ?? 0', ['src/sync/attendance/links.test.ts']),
 ('A', 'src/sync/attendance/links.ts', 'timezone: safeTimezone(timezone)', 'timezone', ['src/sync/attendance/links.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/links.ts', '(taken.get(p.first_name.toLowerCase()) ?? 0) > 1', '(taken.get(p.first_name.toLowerCase()) ?? 0) >= 1', ['src/sync/attendance/links.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/links.ts', 'const key = p.first_name.toLowerCase();', 'const key = p.first_name;', ['src/sync/attendance/links.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/links.ts', '`${p.first_name} ${p.last_initial}.`', '`${p.first_name} ${p.last_initial}`', ['src/sync/attendance/links.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/links.ts', 'if (!(a.player_id in names)) continue;', '', ['src/sync/attendance/links.test.ts']),
 ('A', 'src/sync/attendance/links.ts', "if (a.status === 'in' && a.late) counts.late += 1;", "if (a.status === 'in') counts.late += 1;", ['src/sync/attendance/links.test.ts']),
 ('A', 'src/sync/attendance/links.ts', 'counts[a.status] += 1;', 'counts.in += 1;', ['src/sync/attendance/links.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/links.ts', 'if (from === undefined || from === to || names[id] === undefined) continue;', 'if (from === to || names[id] === undefined) continue;', ['src/sync/attendance/links.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/links.ts', 'if (from === undefined || from === to || names[id] === undefined) continue;', 'if (from === undefined || from === to) continue;', ['src/sync/attendance/links.test.ts']),
 ('A', 'src/sync/attendance/links.ts', 'found = { player: names[id], from, to, at: now };', 'found = { player: names[id], from, to, at: 0 };', ['src/sync/attendance/links.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/links.ts', "month: '2-digit'", "month: 'numeric'", ['src/sync/attendance/links.test.ts']),
 ('A', 'src/sync/attendance/links.ts', '{ timeZone: timezone,', "{ timeZone: 'UTC',", ['src/sync/attendance/links.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/links.ts', "origin.replace(/\\/+$/, '')", 'origin', ['src/sync/attendance/links.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', "{ onConflict: 'owner_id,slot_id' }", "{ onConflict: 'slot_id' }", ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', 'upsert({ owner_id: ownerId, ...row }', 'upsert({ ...row }', ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', ".eq('state', 'pending')", ".neq('state', 'dismissed')", ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', 'closed_through.lt.${date}', 'closed_through.lte.${date}', ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', 'closed_through.is.null,closed_through.lt.', 'closed_through.is.null,closed_through.gt.', ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', 'reason: reason?.trim() || null', 'reason', ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', '{ p_slot_id: slotId }', '{ slot: slotId }', ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', '{ p_code: code }', '{ code }', ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', "select('code,closed_through')", "select('code')", ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', '{ ascending: true }', '{ ascending: false }', ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', 'broughtBy: (g.brought_by as string | null) ?? null', 'broughtBy: null', ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', '.update({ closed_through: date })', '.update({ closed_through: null })', ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', "const { error, status } = await client.from('attendance_links').upsert({ owner_id: ownerId, ...row }, { onConflict: 'owner_id,slot_id' });\n      if (error) fail(error, status);", "const { error, status } = await client.from('attendance_links').upsert({ owner_id: ownerId, ...row }, { onConflict: 'owner_id,slot_id' });", ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', "const removed = await client.from('attendance_cancellations').delete().eq('slot_id', slotId).eq('play_date', playDate);\n      if (removed.error) fail(removed.error, removed.status);", '', ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', ".delete().eq('slot_id', slotId).eq('play_date', playDate);\n      if (error) fail(error, status);", ".delete().eq('slot_id', slotId);\n      if (error) fail(error, status);", ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/fakeRemote.ts', '(closed_through is null or closed_through < $2::date)', '(closed_through is null or closed_through > $2::date)', ['src/sync/attendance/remote.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/fakeRemote.ts', "and state = 'pending' order by", "and state <> 'dismissed' order by", ['src/sync/attendance/remote.test.ts']),
 ('A', 'src/sync/attendance/fakeRemote.ts', '[user, slotId, playDate, reason?.trim() || null]', '[user, slotId, playDate, reason]', ['src/sync/attendance/remote.test.ts']),
 ('A', 'src/sync/attendance/fakeRemote.ts', 'venue = excluded.venue', 'venue = public.attendance_links.venue', ['src/sync/attendance/remote.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/fakeRemote.ts', "if (flags.offline) throw new RemoteError('offline');", '', ['src/sync/attendance/remote.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/fakeRemote.ts', "} catch {\n      throw new RemoteError('server');", '} catch (error) {\n      throw error;', ['src/sync/attendance/remote.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'const clean = reason.trim().slice(0, MAX_REASON).trim();', 'const clean = reason.trim();', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'if (existing && existing.date >= date) return;', 'if (existing && existing.date <= date) return;', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'p.date <= date))', 'p.date >= date))', ['src/sync/attendance/links.test.ts', 'src/sync/attendance/remote.test.ts', 'src/sync/attendance/remote.wire.test.ts', 'src/sync/attendance/start.test.ts', 'src/sync/attendance/store.test.ts', 'src/sync/dataActions.test.ts', 'src/engine/session.test.ts', 'src/store/persistence.test.ts', 'src/ui/homeWiring.test.tsx', 'src/ui/liveScreen.test.tsx']),
 ('A', 'src/sync/attendance/store.ts', 'before.playDate !== summary.playDate', 'before.playDate === summary.playDate', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'diffChange(before.answers, summary.answers, summary.names, now) ?? change', 'diffChange(before.answers, summary.answers, summary.names, now)', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'if (ownerId !== null) get().clear();', '', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'epoch += 1;\n', '', ['src/sync/attendance/links.test.ts', 'src/sync/attendance/remote.test.ts', 'src/sync/attendance/remote.wire.test.ts', 'src/sync/attendance/start.test.ts', 'src/sync/attendance/store.test.ts', 'src/sync/dataActions.test.ts', 'src/engine/session.test.ts', 'src/store/persistence.test.ts', 'src/ui/homeWiring.test.tsx', 'src/ui/liveScreen.test.tsx']),
 ('A', 'src/sync/attendance/store.ts', 'if (!current()) return { ok: true };', '', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'localDate(session.createdAt, deps.timezone())', 'localDate(deps.now(), deps.timezone())', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'if (!slotId) return { ok: true };', '', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'if (get().ownerId !== null) enqueue(slotId, date);', 'enqueue(slotId, date);', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'if (!get().links[slot.id]) return { ok: true };', '', ['src/sync/attendance/start.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'set({ busy: { ...get().busy, [slotId]: false } });', 'set({ busy: { ...get().busy, [slotId]: true } });', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'data.version !== VERSION', 'data.version !== 2', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'if (slotId in links && isSummary(slotId, s)) summaries[slotId] = s;', 'if (isSummary(slotId, s)) summaries[slotId] = s;', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'x.slotId === key &&', 'true &&', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'if (data.ownerId === null) {', 'if (false) {', ['src/sync/attendance/start.test.ts', 'src/sync/attendance/store.test.ts', 'src/sync/dataActions.test.ts']),
 ('A', 'src/sync/attendance/store.ts', "offline: 'No connection. Try again when you are online.'", "offline: 'No connection.'", ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'if (running) return running;', '', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', '        lastError: { ...get().lastError, [slotId]: null },\n      });\n      return { ok: true };', '      });\n      return { ok: true };', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'if (slotId in links && isChange(note)) lastChange[slotId] = note;', 'if (isChange(note)) lastChange[slotId] = note;', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'await flushQueue(remote, mine);', '', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', "if (!date) return { ok: false, message: 'Could not find the date. Try again.' };\n      const clean", 'const date2 = date;\n      const clean', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/start.ts', 'const SLOT_DELAY_MS = 800;', 'const SLOT_DELAY_MS = 500;', ['src/sync/attendance/start.test.ts']),
 ('A', 'src/sync/attendance/start.ts', 'if (old && shown(old) === shown(slot)) continue;', '', ['src/sync/attendance/start.test.ts']),
 ('A', 'src/sync/attendance/start.ts', 'clearTimeout(timers.get(slot.id));\n      timers.set', ';\n      timers.set', ['src/sync/attendance/start.test.ts']),
 ('A', 'src/sync/attendance/start.ts', '[s.weekday, s.startMin, s.endMin, s.venue, s.courts]', '[s.weekday, s.startMin, s.endMin, s.venue]', ['src/sync/attendance/start.test.ts']),
 ('A', 'src/sync/attendance/start.ts', '[s.weekday, s.startMin, s.endMin, s.venue, s.courts]', '[s.startMin, s.endMin, s.venue, s.courts]', ['src/sync/attendance/start.test.ts']),
 ('A', 'src/sync/attendance/start.ts', "status === 'signedOut' || (", '(', ['src/sync/attendance/start.test.ts']),
 ('A', 'src/sync/attendance/start.ts', 'ownerId !== userId', 'ownerId === userId', ['src/sync/attendance/start.test.ts']),
 ('A', 'src/sync/attendance/start.ts', '    unwatchAuth();\n', '', ['src/sync/attendance/start.test.ts']),
 ('A', 'src/sync/attendance/start.ts', 'for (const timer of timers.values()) clearTimeout(timer);', '', ['src/sync/attendance/start.test.ts']),
 ('A', 'src/engine/session.ts', '...(input.slotId ? { slotId: input.slotId } : {}),', 'slotId: input.slotId,', ['src/engine/session.test.ts', 'src/ui/homeWiring.test.tsx']),
 ('A', 'src/store/persistence.ts', "(x.slotId === undefined || typeof x.slotId === 'string') &&", 'true &&', ['src/store/persistence.test.ts']),
 ('A', 'src/store/persistence.ts', "(x.slotId === undefined || typeof x.slotId === 'string') &&", "(typeof x.slotId === 'string') &&", ['src/store/persistence.test.ts']),
 ('A', 'src/ui/SetupScreen.tsx', '      slotId: plan?.slotId,\n', '', ['src/ui/homeWiring.test.tsx']),
 ('A', 'src/sync/dataActions.ts', 'useAttendanceStore.getState().clear();\n    void useHistoryStore', 'void useHistoryStore', ['src/sync/dataActions.test.ts']),
 ('A', 'src/sync/dataActions.ts', 'useAttendanceStore.getState().clear();\n    useSyncStore', 'useSyncStore', ['src/sync/dataActions.test.ts']),
 ('A', 'src/ui/LiveScreen.tsx', 'if (ended) useAttendanceStore.getState().closeForSession(session).catch(() => {});', 'useAttendanceStore.getState().closeForSession(session).catch(() => {});', ['src/ui/liveScreen.test.tsx']),
 ('A', 'src/ui/LiveScreen.tsx', 'if (ended) useAttendanceStore.getState().closeForSession(session).catch(() => {});', '', ['src/ui/liveScreen.test.tsx']),
 ('A', 'src/ui/LiveScreen.tsx', 'closeForSession(session).catch(() => {});', 'closeForSession(session);', ['src/sync/attendance/links.test.ts', 'src/sync/attendance/remote.test.ts', 'src/sync/attendance/remote.wire.test.ts', 'src/sync/attendance/start.test.ts', 'src/sync/attendance/store.test.ts', 'src/sync/dataActions.test.ts', 'src/engine/session.test.ts', 'src/store/persistence.test.ts', 'src/ui/homeWiring.test.tsx', 'src/ui/liveScreen.test.tsx']),
 ('A', 'src/ui/LiveScreen.tsx', 'closeForSession(session).catch', 'closeForSession({ ...session, slotId: undefined }).catch', ['src/ui/liveScreen.test.tsx']),
 ('B', 'src/ui/prefs.ts', "'pikl.attendancePreview'", "'pikl.attendancePreviews'", ['src/ui/attendancePreview.test.tsx', 'src/ui/attendanceApp.test.tsx']),
 ('B', 'src/ui/SettingsScreen.tsx', 'useBoolPref(ATTENDANCE_PREVIEW_KEY, false)', 'useBoolPref(ATTENDANCE_PREVIEW_KEY, true)', ['src/ui/attendancePreview.test.tsx']),
 ('B', 'src/ui/SettingsScreen.tsx', 'setAttendancePreview(e.target.checked)', 'setAttendancePreview(!e.target.checked)', ['src/ui/attendancePreview.test.tsx']),
 ('B', 'src/ui/SettingsScreen.tsx', 'Members cannot open the link yet.', 'Members can open the link.', ['src/ui/attendancePreview.test.tsx']),
 ('B', 'src/ui/SettingsScreen.tsx', '<span>Attendance link (preview)</span>', '<span>Attendance link</span>', ['src/ui/attendancePreview.test.tsx']),
 ('B', 'src/ui/useAttendance.ts', 'const REFRESH_MS = 60_000;', 'const REFRESH_MS = 30_000;', ['src/ui/useAttendance.test.tsx']),
 ('B', 'src/ui/useAttendance.ts', "s.status === 'signedIn' && s.userId !== null", "s.status === 'signedIn'", ['src/ui/useAttendance.test.tsx']),
 ('B', 'src/ui/useAttendance.ts', 'const active = preview && signedIn;', 'const active = preview || signedIn;', ['src/ui/useAttendance.test.tsx']),
 ('B', 'src/ui/useAttendance.ts', "if (document.visibilityState === 'visible') refresh();\n    }, REFRESH_MS);", 'refresh();\n    }, REFRESH_MS);', ['src/ui/useAttendance.test.tsx']),
 ('B', 'src/ui/useAttendance.ts', "document.removeEventListener('visibilitychange', onVisible);", '/* removed */', ['src/ui/useAttendance.test.tsx']),
 ('B', 'src/ui/useAttendance.ts', 'clearInterval(timer);', '/* removed */', ['src/ui/useAttendance.test.tsx']),
 ('B', 'src/ui/useAttendance.ts', '    refresh();\n    const timer = setInterval', '    const timer = setInterval', ['src/ui/useAttendance.test.tsx', 'src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/useAttendance.ts', '}, [active, slotId]);', '}, [active]);', ['src/ui/useAttendance.test.tsx']),
 ('B', 'src/ui/useAttendance.ts', "const onVisible = () => {\n      if (document.visibilityState === 'visible') refresh();\n    };", 'const onVisible = () => {\n      refresh();\n    };', ['src/ui/useAttendance.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', "if (!preview || status === 'unconfigured' || status === 'loading') return null;", "if (status === 'unconfigured' || status === 'loading') return null;", ['src/ui/AttendanceCard.test.tsx', 'src/ui/attendanceApp.test.tsx', 'src/ui/attendanceHome.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', "if (!preview || status === 'unconfigured' || status === 'loading') return null;", "if (!preview || status === 'unconfigured') return null;", ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', "if (status === 'signedOut' || status === 'linkSent') {", "if (status === 'signedOut') {", ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', "if (status === 'unknown' && !link) return null;", '/* removed */', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'const mine = ownerId === null || userId === null || ownerId === userId;', 'const mine = true;', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', '{error === null && (', '{error !== undefined && (', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', '{error === undefined && (', '{error !== undefined && (', ['src/ui/AttendanceCard.test.tsx', 'src/ui/attendanceHome.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'const STALE_MS = 2 * 60_000;', 'const STALE_MS = 5 * 60_000;', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'Date.now() - summary.fetchedAt > STALE_MS', 'Date.now() - summary.fetchedAt >= STALE_MS', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', '|| (error !== undefined && error !== null);', ';', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', '{error === \'offline\' && <p className="attendance-line">Offline, showing the last list</p>}', '{error !== null && <p className="attendance-line">Offline, showing the last list</p>}', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', '${change.player} changed to ${STATUS_LABEL[change.to]}', '${change.player} changed to ${STATUS_LABEL[change.from]}', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', "plural(waiting.length, 'new name', 'new names')", "plural(waiting.length, 'new name', 'new name')", ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'summary.friends > 0 &&', 'summary.friends >= 0 &&', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', "plural(summary.friends, 'friend', 'friends')", "plural(summary.friends, 'friend', 'friend')", ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', "typeof navigator.share === 'function'", 'false', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', "if (e instanceof DOMException && e.name === 'AbortError') return;", 'if (false) return;', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'await navigator.share({ title: titleFor(slot), url });', 'await navigator.share({ url });', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', "setShared('copied');", "setShared('field');", ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', "if (shared === 'field') fieldRef.current?.select();", "if (shared === 'field') fieldRef.current?.focus();", ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'const url = shareUrl(window.location.origin, link.code);', "const url = shareUrl(window.location.origin, 'x');", ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'new Date(y, m - 1, d)', 'new Date(y, m, d)', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'disabled={busy} onClick={() => void share(url)}', 'onClick={() => void share(url)}', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', "disabled={busy} onClick={() => setSheet('reset')}", "onClick={() => setSheet('reset')}", ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'void run(() => store().resetLink(slot.id), closeSheet)', 'void run(() => store().resetLink(slot.id))', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'if (result.ok) onDone?.();', 'onDone?.();', ['src/ui/AttendanceCard.test.tsx', 'src/ui/attendanceApp.test.tsx', 'src/ui/attendanceHome.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'const alert = problem && sheet === null && (', 'const alert = problem && (', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', '    setProblem(null);\n    const result = await act();', '    const result = await act();', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'd.getHours() * 60 + d.getMinutes()', 'd.getHours() * 60', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'Cancelled for {dateLabel(summary.playDate)}.{reason', 'Cancelled for {dateLabel(summary.playDate)}{reason', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'if (summary.cancelled) {', 'if (false as boolean) {', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', '  useAttendance(slot.id);\n', '  void useAttendance;\n', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'const busy = useAttendanceStore((s) => !!s.busy[slot.id]);', 'const busy = false;', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', 'maxLength={MAX_REASON}', 'maxLength={MAX_REASON + 1}', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', 'const COUNT_FROM = 120;', 'const COUNT_FROM = 100;', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', 'Members who have the old link will need the new one. Answers are kept.', 'Members who have the old link will need the new one.', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', '<button type="button" className="btn" disabled={busy} onClick={onClose}>\n        Keep it\n', '<button type="button" className="btn" onClick={onClose}>\n        Keep it\n', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', 'onClick={() => onConfirm(reason)}', "onClick={() => onConfirm('')}", ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', 'title={`Cancel ${dateLabel}?`}', 'title={`Cancel the week?`}', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', '<Sheet title="Reset the link?" onClose={onClose}>', '<Sheet title="Reset the link?" onClose={() => {}}>', ['src/ui/AttendanceCard.test.tsx']),
 ('B', 'src/ui/HomeScreen.tsx', '{selected && !live && !showDone && <AttendanceCard', '{selected && !showDone && <AttendanceCard', ['src/ui/attendanceHome.test.tsx']),
 ('B', 'src/ui/HomeScreen.tsx', '{selected && !live && !showDone && <AttendanceCard', '{selected && !live && <AttendanceCard', ['src/ui/attendanceHome.test.tsx']),
 ('B', 'src/ui/HomeScreen.tsx', '<AttendanceCard slot={selected}', '<AttendanceCard slot={eff ?? selected}', ['src/ui/attendanceHomeProps.test.tsx']),
 ('B', 'src/ui/HomeScreen.tsx', 'onSignIn={onSignIn ?? noop}', 'onSignIn={noop}', ['src/ui/attendanceApp.test.tsx', 'src/ui/attendanceHome.test.tsx', 'src/ui/attendanceHomeProps.test.tsx']),
 ('B', 'src/ui/App.tsx', 'useEffect(() => startAttendanceSync(), []);', 'useEffect(() => {\n    startAttendanceSync();\n  }, []);', ['src/ui/attendanceApp.test.tsx']),
 ('B', 'src/ui/App.tsx', 'useEffect(() => startAttendanceSync(), []);', 'useEffect(() => {}, []);', ['src/ui/attendanceApp.test.tsx']),
 ('B', 'src/ui/App.tsx', "onViewSummary={(id) => openHistory('home', id)} onSignIn={openSettings} />", "onViewSummary={(id) => openHistory('home', id)} />", ['src/ui/attendanceApp.test.tsx']),
 ('B', 'src/styles/app.css', '.attendance-btn {\n  min-height: 44px;', '.attendance-btn {\n  min-height: 40px;', ['src/ui/attendanceCss.test.ts']),
 ('B', 'src/styles/app.css', '.attendance {\n  flex: none;', '.attendance {\n  flex: 1;', ['src/ui/attendanceCss.test.ts']),
 ('B', 'src/styles/app.css', ".attendance-pill[data-kind='in'] {\n  background: var(--accent);", ".attendance-pill[data-kind='in'] {\n  background: #c8f03c;", ['src/ui/attendanceCss.test.ts']),
 ('B', 'src/styles/app.css', '  color: var(--muted);\n  overflow-wrap: anywhere;\n}\n\n.attendance-notice', '  color: var(--muted);\n  overflow-wrap: normal;\n}\n\n.attendance-notice', ['src/ui/attendanceCss.test.ts']),
 ('B', 'src/styles/app.css', '.attendance-meta {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;', '.attendance-meta {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;', ['src/ui/attendanceCss.test.ts']),
 ('B', 'src/styles/app.css', 'var(--danger) 12%, var(--surface));\n  color: var(--danger);', 'var(--danger) 12%, var(--surface));\n  color: var(--ink);', ['src/ui/attendanceCss.test.ts']),
 ('B', 'src/styles/app.css', '/* Attendance card */\n', '/* Attendance card (moved) */\n', ['src/ui/attendanceCss.test.ts']),
]

import os
originals = {}
survived, broken, killed = [], [], 0
try:
    for n, (part, path, old, new, tests) in enumerate(BREAKS, 1):
        full = os.path.join(ROOT, path)
        if path not in originals:
            originals[path] = open(full).read()
        text = originals[path]
        if text.count(old) != 1:
            broken.append((n, path, text.count(old)))
            continue
        open(full, 'w').write(text.replace(old, new))
        try:
            r = subprocess.run(['npx', 'vitest', 'run'] + tests, cwd=ROOT, capture_output=True, text=True)
        finally:
            open(full, 'w').write(text)
        if r.returncode != 0:
            killed += 1
        else:
            survived.append((n, path, old[:50]))
        print(n, 'killed' if r.returncode != 0 else 'SURVIVED', path, flush=True)
finally:
    for path, text in originals.items():
        open(os.path.join(ROOT, path), 'w').write(text)

print(f'\n{killed} of {len(BREAKS)} killed; survived: {survived}; entries that did not match exactly once: {broken}')
sys.exit(1 if survived or broken else 0)
```

- [ ] **Step 2: Run it**

Run: `python3 /tmp/mutate-attendance-org.py .`

Expected, last line: `150 of 150 killed; survived: []; entries that did not match exactly once: []`

If a break survives, a test is missing: add the test, do not change the break. Afterwards run `git status --short` and expect nothing, because the script restores every file.

- [ ] **Step 3: Look at it in a browser**

The dev server has no Supabase, so a signed-in card cannot be seen there without seeding the page. The check that matters is on the live site after shipping, on the organizer's phone:

1. Settings, turn on "Attendance link (preview)". Home shows an "Attendance link" card under the slot card. Signed out, it asks to sign in.
2. Sign in. Tap "Create link". The card shows 0 in, 0 maybe, 0 out and a link ending in a random code.
3. Do not send the link to anyone yet. It opens nothing until Plan 3.
4. Tap Reset link, then Reset link in the sheet: the code changes. Tap Cancel this week, add a reason, confirm: the card shows "Cancelled for ..." with Undo. Tap Undo.
5. Turn on airplane mode, pull Home down or wait a minute: the card keeps the last list and shows "Updated" and "Offline, showing the last list".
6. Check light and dark, and a short phone (360 by 640). Nothing may scroll sideways or be clipped.

Seen in the dev check (390 by 844 and 360 by 640, light and dark, with a seeded fake): no sideways scroll, no target under 44 px, the card and both sheets readable in both themes. On a 360 by 640 phone the slot card's "Add a venue" and "Add courts" chips are still partly covered by the card. That is the cost of a card on a short phone. A later change can drop the chips or shrink the hero.

- [ ] **Step 4: Nothing is pushed by this plan**

Shipping is a fast-forward of production after the owner says so. The plan changes no database, so there is no migration to apply.

---

## Self-review

- **Spec coverage.** Audit findings O1 (offline copy and the "Updated" line), O2 (a link row with the slot's details, kept in step), O5 (Cancel this week and Undo, organizer side), O6 (the closed date on session end), O7 (the latest change line), and the organizer part of O4 (the "new names to review" count) are built. Not in this plan: the member page (Plan 3), pre-fill, late players on a break, the review screen, Copy list and the maybe nudge (Plan 4), and marking the organizer In (O10, needs the organizer's own player).
- **Placeholders.** None. Every file is complete and every step has its command and expected result.
- **Names.** Types, store actions and component props match across tasks because every task is a proven commit.
- **Known limits.** A slot edit that cannot reach the link (offline) is not retried until the slot is saved again. A refresh while fully offline can take several seconds to fall back to the copy, because the Supabase client retries. Nothing has run against the real Supabase from the app; the request shapes are checked through a stub, and the rules on the in-memory Postgres with the real migration. Share was tested against stubs, not a real phone share sheet. The "Updated" line after two minutes without a refresh was seen only through a forced failure. On a 360 by 640 phone the slot card's bottom chips are partly covered.
