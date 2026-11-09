# Attendance link, Plan 3 of 4: the member page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A club member opens the attendance link from the group chat, taps their own name, and answers In, Maybe or Out, with no account. They can say they will arrive late, bring a friend, ask to join, add the session to their calendar, and see who is in. The organizer sees it on the Home card from Plan 2.

**Architecture:** The link is a hash address (`/#/j/<code>`), so no server routing is needed and the secret code never reaches server logs. `main.tsx` reads the hash once and renders a separate member root that never starts sync, sign-in or the organizer's stores. The page talks to the database through its own anonymous Supabase client and the three public functions from Plan 1, and keeps the database's reasons (cancelled, dead link, full list) so it can say the right thing. One hook holds all the behaviour; the screens only show it.

**Tech Stack:** React, TypeScript, Vite, Supabase client, Vitest, PGlite (in-memory Postgres for the tests). No new dependencies.

Design, audit and the four plans: `docs/superpowers/specs/2026-11-09-attendance-link.md`. Pictures: `docs/superpowers/sketches/attendance-v2.png` (screens 1, 2 and 6). The database: Plan 1, `docs/superpowers/plans/2026-11-09-attendance-link-database.md`. The organizer side: Plan 2, `docs/superpowers/plans/2026-11-09-attendance-link-organizer.md`.

**Where this fits.** Plan 3 of 4. After this plan the whole loop works: the organizer creates and shares a link, a member answers on it, the organizer sees the counts. The Settings preview switch from Plan 2 **stays** until the page has been checked end to end on the real project; removing it, and fixing the short-phone clipping of the slot card, is a small step after that.

**Before you start.** Work from a clean checkout of production (`origin/claude/pickleball-matchmaking-app-i4baca`, commit `0341e1e` or later). Baseline: 1782 tests across 134 files, `npx tsc --noEmit` clean. After this plan: 2210 tests across 155 files. Node modules are already installed. Stage files by name, never `git add -A`. Do not touch `src/ui/EditSlotSheet*`, `src/ui/PlayerSheet*`, `src/styles/editSlot.css` or `src/styles/playerSheet.css`.

**Decisions this plan carries out (do not revisit).**
- The link is `${origin}/#/j/${code}`. A path link would 404 (no rewrites in `vercel.json`) and break the relative asset paths (`base: './'`).
- A separate member root. It imports none of: `ui/App`, `ui/HomeScreen`, `ui/AttendanceCard`, `ui/useAttendance`, `sync/attendance/start`, `sync/attendance/store`, `sync/coordinator`, `sync/auth`, `store/rosterStore`, `store/sessionStore`, `store/slots`, `ui/ErrorBoundary`. A test scans the member folder for these.
- Its own anonymous Supabase client, so an organizer's saved sign-in on the same phone never affects a member.
- The database's reasons are kept. The page never shows raw database text.
- A member sees first names (a last initial only when two share a first name), initials on a coloured circle (no photos: the photo bucket is private), who is In, Maybe as a count, friends as a count, the date, time and venue, and a cancelled notice. Never Out, never full names, never the code.
- The picked player is remembered per link on the phone. "Not Ana?" forgets it.
- Offline: the last good list is kept per link and shown with "Updated 4:12 pm", and "Offline, showing the last list" when the failure was offline. Answering offline changes nothing.
- Refresh on open, every 30 seconds while the page is visible, when it becomes visible, and right after an answer.
- "Add to calendar" is an `.ics` file in floating local time (the view has no time zone), with no code in it.
- Cancelled week: the reason and "Next session" one week on. No answer buttons.
- A busy line only when more people are In (plus friends) than 4 times the courts. No cap and no waitlist.

## File structure

| File | Job |
|---|---|
| `src/sync/attendance/links.ts` | The link shape (`/#/j/<code>`) |
| `src/member/route.ts`, `src/chooseRoot.ts`, `src/main.tsx` | Read the hash, choose the root, reload when the code changes |
| `src/member/client.ts`, `remote.ts`, `fakeRemote.ts` | The anonymous client, the remote with its reasons, the in-memory version for tests |
| `src/member/identity.ts`, `cache.ts`, `format.ts`, `ics.ts`, `download.ts` | Remembered pick, offline copy, wording and dates, the calendar file and its download |
| `src/member/useMemberPage.ts` | All the behaviour |
| `src/member/MemberPage.tsx`, `MemberRoot.tsx`, `MemberPicker.tsx`, `MemberAnswer.tsx`, `MemberCancelled.tsx`, `MemberSheets.tsx`, `MemberTile.tsx`, `fixtures.ts` | The screens, the root with its own error boundary, and sample data for tests |
| `src/styles/app.css` | A `/* Member page */` section just before `/* Board */` |
| `src/ui/memberCss.test.ts`, `cssBalance.test.ts`, `attendanceCss.test.ts` | CSS checks, including the new section |

---

### Task 1: The link is a hash link

The link the organizer shares changes from `/j/<code>` to `/#/j/<code>`. A path link would need a server rewrite (the deploy has none) and would load its scripts from the wrong place (the app uses relative asset paths). The part after `#` is also never sent to the server, so the secret code stays out of server logs. Plan 2 only built the link behind a preview switch, so no real link has been shared.

**Files:**
- Modify: `src/sync/attendance/links.ts`
- Modify: `src/sync/attendance/links.test.ts`
- Modify: `src/ui/AttendanceCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Apply this patch to `src/sync/attendance/links.test.ts`:

```diff
diff --git a/src/sync/attendance/links.test.ts b/src/sync/attendance/links.test.ts
index 40b7ac6..fa83ecc 100644
--- a/src/sync/attendance/links.test.ts
+++ b/src/sync/attendance/links.test.ts
@@ -196,11 +196,11 @@ describe('localDate', () => {
 });
 
 describe('shareUrl', () => {
-  it('joins the origin, /j/ and the code', () => {
-    expect(shareUrl('https://pikl.example', 'abc123')).toBe('https://pikl.example/j/abc123');
+  it('joins the origin, /#/j/ and the code', () => {
+    expect(shareUrl('https://pikl.example', 'abc123')).toBe('https://pikl.example/#/j/abc123');
   });
 
   it('does not double a trailing slash', () => {
-    expect(shareUrl('https://pikl.example/', 'abc')).toBe('https://pikl.example/j/abc');
+    expect(shareUrl('https://pikl.example/', 'abc')).toBe('https://pikl.example/#/j/abc');
   });
 });
```

Apply this patch to `src/ui/AttendanceCard.test.tsx`:

```diff
diff --git a/src/ui/AttendanceCard.test.tsx b/src/ui/AttendanceCard.test.tsx
index cf822a2..331c2e4 100644
--- a/src/ui/AttendanceCard.test.tsx
+++ b/src/ui/AttendanceCard.test.tsx
@@ -221,7 +221,7 @@ describe('the link state', () => {
     expect(screen.getByText('Tuesday')).toBeInTheDocument();
     const pills = within(screen.getByRole('list', { name: 'Answers' })).getAllByRole('listitem');
     expect(pills.map((p) => p.textContent)).toEqual(['11 in', '3 maybe', '2 out', '1 friend']);
-    expect(screen.getByText(`${window.location.origin}/j/abc123`)).toBeInTheDocument();
+    expect(screen.getByText(`${window.location.origin}/#/j/abc123`)).toBeInTheDocument();
     expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled();
     expect(screen.getByRole('button', { name: 'Reset link' })).toBeEnabled();
     expect(screen.getByRole('button', { name: 'Cancel this week' })).toBeEnabled();
@@ -344,7 +344,7 @@ describe('the link state', () => {
     seed({ fetchedAt: new Date(2026, 10, 9, 16, 12).getTime(), waiting: [{ id: 'g1', name: 'Mika', broughtBy: null }] }, { change: { player: 'Ben', from: 'in', to: 'out', at: NOW } });
     const { container } = setup();
     const text = container.textContent!;
-    const order = ['Attendance link', '11 in', 'Updated 4:12 pm', 'Ben changed to Out', '1 new name to review', '/j/abc123', 'Share'].map((t) => text.indexOf(t));
+    const order = ['Attendance link', '11 in', 'Updated 4:12 pm', 'Ben changed to Out', '1 new name to review', '/#/j/abc123', 'Share'].map((t) => text.indexOf(t));
     expect(order.every((i) => i >= 0)).toBe(true);
     expect([...order].sort((a, b) => a - b)).toEqual(order);
   });
@@ -481,7 +481,7 @@ describe('Share', () => {
     signIn();
     seed();
   });
-  const URL = () => `${window.location.origin}/j/abc123`;
+  const URL = () => `${window.location.origin}/#/j/abc123`;
 
   it('uses the share sheet when the browser has one', async () => {
     const { user } = setup();
@@ -733,7 +733,7 @@ describe('against the real rules', () => {
     const { user } = setup();
     await user.click(await screen.findByRole('button', { name: 'Create link' }));
     expect(await screen.findByText('0 in')).toBeInTheDocument();
-    expect(screen.getByText(`${window.location.origin}/j/${await code()}`)).toBeInTheDocument();
+    expect(screen.getByText(`${window.location.origin}/#/j/${await code()}`)).toBeInTheDocument();
   });
 
   it('shows the answers a member gave, after a refresh', async () => {
@@ -757,7 +757,7 @@ describe('against the real rules', () => {
     await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
     const after = await code();
     expect(after).not.toBe(before);
-    expect(await screen.findByText(`${window.location.origin}/j/${after}`)).toBeInTheDocument();
+    expect(await screen.findByText(`${window.location.origin}/#/j/${after}`)).toBeInTheDocument();
   });
 
   it('cancels the week with a reason, then undoes it', async () => {
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/sync/attendance/links.test.ts src/ui/AttendanceCard.test.tsx`

Expected: it fails. Test Files `2 failed (2)`, Tests `11 failed | 90 passed (101)`.

- [ ] **Step 3: Write the code**

Apply this patch to `src/sync/attendance/links.ts`:

```diff
diff --git a/src/sync/attendance/links.ts b/src/sync/attendance/links.ts
index 8018420..6374a05 100644
--- a/src/sync/attendance/links.ts
+++ b/src/sync/attendance/links.ts
@@ -108,4 +108,4 @@ export function localDate(ms: number, timezone: string): string {
   return `${get('year')}-${get('month')}-${get('day')}`;
 }
 
-export const shareUrl = (origin: string, code: string): string => `${origin.replace(/\/+$/, '')}/j/${code}`;
+export const shareUrl = (origin: string, code: string): string => `${origin.replace(/\/+$/, '')}/#/j/${code}`;
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/sync/attendance/links.test.ts src/ui/AttendanceCard.test.tsx`

Expected: it passes. Test Files `2 passed (2)`, Tests `101 passed (101)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 1782 tests across 134 files.

- [ ] **Step 5: Commit**

```bash
git add src/sync/attendance/links.test.ts src/ui/AttendanceCard.test.tsx src/sync/attendance/links.ts
git commit -m "Use a hash link so the member page needs no server routing"
```

---

### Task 2: The member remote: an anonymous client, reasons kept, an in-memory version, and the exact requests

How the member page talks to the database. Its own anonymous Supabase client (so an organizer signed in on the same phone cannot turn a member's request into a wrong "signed out"), a remote for the three public functions (view, answer, add a guest) that keeps the database's reason (`cancelled`, `unknown_link`, `unknown_player`, `bad_status`, `bad_name`, `too_many`) instead of throwing it away, a version that runs the three real functions as the anonymous role on the in-memory Postgres, and tests of the exact requests the real client sends. Also the hash route parser.

**Files:**
- Create: `src/member/client.ts`
- Create: `src/member/fakeRemote.ts`
- Create: `src/member/remote.ts`
- Create: `src/member/route.ts`
- Create: `src/member/client.test.ts`
- Create: `src/member/remote.test.ts`
- Create: `src/member/remote.wire.test.ts`
- Create: `src/member/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/member/client.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';

const KEY = 'sb_publishable_abc';

async function load(env: Record<string, string>) {
  const createClient = vi.fn(() => ({ marker: 'client' }));
  vi.resetModules();
  vi.doMock('@supabase/supabase-js', () => ({ createClient }));
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const mod = await import('./client');
  return { ...mod, createClient };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.doUnmock('@supabase/supabase-js');
});

describe('getMemberClient', () => {
  it('is null with no URL and no key', async () => {
    const { getMemberClient, createClient } = await load({ VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' });
    expect(getMemberClient()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('is null when only the URL is set', async () => {
    const { getMemberClient } = await load({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: '' });
    expect(getMemberClient()).toBeNull();
  });

  it('is null when only the key is set', async () => {
    const { getMemberClient } = await load({ VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: KEY });
    expect(getMemberClient()).toBeNull();
  });

  it('is null for a secret key, and does not build a client', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { getMemberClient, createClient } = await load({
      VITE_SUPABASE_URL: 'https://abc.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_oops',
    });
    expect(getMemberClient()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('builds an anonymous client that keeps no session and reads no sign-in from the address', async () => {
    const { getMemberClient, createClient } = await load({ VITE_SUPABASE_URL: ' https://abc.supabase.co ', VITE_SUPABASE_PUBLISHABLE_KEY: ` ${KEY} ` });
    expect(getMemberClient()).toEqual({ marker: 'client' });
    expect(createClient).toHaveBeenCalledWith('https://abc.supabase.co', KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });

  it('builds the client once', async () => {
    const { getMemberClient, createClient } = await load({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: KEY });
    getMemberClient();
    getMemberClient();
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('is null, without throwing, when the client cannot be made', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.resetModules();
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => {
        throw new Error('Invalid URL');
      },
    }));
    vi.stubEnv('VITE_SUPABASE_URL', 'not a url');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', KEY);
    const { getMemberClient } = await import('./client');
    expect(getMemberClient()).toBeNull();
  });
});
```

Create `src/member/remote.test.ts`:

```typescript
// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { USER_A, createDb } from '../sync/db/harness';
import { fakeMemberRemote, type MemberFlags } from './fakeRemote';
import { isMemberError, type MemberRemote } from './remote';

const ANA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const BEN2 = '33333333-3333-4333-8333-333333333333';
const GONE = '44444444-4444-4444-8444-444444444444';
const CODE = 'abcdef0123456789abcdef01';

let db: PGlite;
let flags: MemberFlags;
let remote: MemberRemote;

beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec('truncate public.players, public.attendance_links cascade');
  await db.exec(`
    insert into public.players (owner_id, id, name) values
      ('${USER_A}', '${ANA}', 'Ana Reyes'),
      ('${USER_A}', '${BEN}', 'Ben Cruz'),
      ('${USER_A}', '${BEN2}', 'Ben Dela Rosa');
    insert into public.players (owner_id, id, name, deleted_at) values ('${USER_A}', '${GONE}', 'Gone Person', now());
    insert into public.attendance_links (owner_id, slot_id, code, title, weekday, start_min, end_min, venue, courts, timezone)
      values ('${USER_A}', 'tue', '${CODE}', 'Tuesday open play', extract(dow from (now() at time zone 'UTC'))::int, 1140, null, 'Sample Hall', 3, 'UTC');
  `);
  flags = { offline: false, calls: [] };
  remote = fakeMemberRemote(db, flags);
});

const reasonOf = async (p: Promise<unknown>) => {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  return isMemberError(error) ? error.reason : `not a MemberError: ${String(error)}`;
};
const answers = async () =>
  (await db.query<{ player_id: string; status: string; late: boolean }>(
    'select player_id, status, late from public.attendance_answers order by player_id',
  )).rows;
const guests = async () =>
  (await db.query<{ name: string; brought_by: string | null }>('select name, brought_by from public.attendance_guests order by created_at, name')).rows;
const cancelToday = async (reason: string | null) => {
  const date = (await remote.view(CODE))!.play_date;
  await db.query('insert into public.attendance_cancellations (owner_id, slot_id, play_date, reason) values ($1, $2, $3::date, $4)', [
    USER_A,
    'tue',
    date,
    reason,
  ]);
};

describe('view', () => {
  it('shows the link, the roster with first names and last initials, and no answers yet', async () => {
    const v = await remote.view(CODE);
    expect(v).toMatchObject({
      title: 'Tuesday open play',
      venue: 'Sample Hall',
      start_min: 1140,
      end_min: null,
      courts: 3,
      cancelled: null,
      answers: [],
      friends: 0,
    });
    expect(v!.play_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(v!.players.map((p) => [p.first_name, p.last_initial])).toEqual([
      ['Ana', 'R'],
      ['Ben', 'C'],
      ['Ben', 'D'],
    ]);
  });

  it('leaves out a removed player', async () => {
    const v = await remote.view(CODE);
    expect(v!.players.map((p) => p.id)).not.toContain(GONE);
  });

  it('is null for an unknown code', async () => {
    expect(await remote.view('0'.repeat(24))).toBeNull();
  });

  it('never carries a full name, an owner id or an email', async () => {
    await remote.answer(CODE, ANA, 'in', false);
    const text = JSON.stringify(await remote.view(CODE));
    expect(text).not.toContain('Reyes');
    expect(text).not.toContain('Cruz');
    expect(text).not.toContain('Dela Rosa');
    expect(text).not.toContain(USER_A);
    expect(text).not.toMatch(/owner|email|@/i);
    const [player] = (await remote.view(CODE))!.players;
    expect(Object.keys(player).sort()).toEqual(['first_name', 'has_photo', 'id', 'last_initial', 'photo_seq']);
  });

  it('carries each answer as a player id and a status, so a member can find their own', async () => {
    await remote.answer(CODE, BEN, 'out', false);
    const v = await remote.view(CODE);
    expect(v!.answers).toEqual([{ player_id: BEN, status: 'out', late: false }]);
    expect(Object.keys(v!.answers[0]).sort()).toEqual(['late', 'player_id', 'status']);
  });

  it('shows the cancellation with its reason', async () => {
    await cancelToday('Rain');
    expect((await remote.view(CODE))!.cancelled).toEqual({ reason: 'Rain' });
  });
});

describe('answer', () => {
  it.each(['in', 'maybe', 'out'] as const)('records %s', async (status) => {
    await remote.answer(CODE, ANA, status, false);
    expect(await answers()).toEqual([{ player_id: ANA, status, late: false }]);
    expect((await remote.view(CODE))!.answers).toEqual([{ player_id: ANA, status, late: false }]);
  });

  it('keeps late with In', async () => {
    await remote.answer(CODE, ANA, 'in', true);
    expect(await answers()).toEqual([{ player_id: ANA, status: 'in', late: true }]);
  });

  it('drops late for Maybe and Out', async () => {
    await remote.answer(CODE, ANA, 'maybe', true);
    expect((await answers())[0].late).toBe(false);
    await remote.answer(CODE, ANA, 'out', true);
    expect((await answers())[0].late).toBe(false);
  });

  it('replaces the earlier answer when a member changes their mind', async () => {
    await remote.answer(CODE, ANA, 'in', true);
    await remote.answer(CODE, ANA, 'maybe', false);
    await remote.answer(CODE, ANA, 'out', false);
    expect(await answers()).toEqual([{ player_id: ANA, status: 'out', late: false }]);
  });

  it('keeps one answer for each member', async () => {
    await remote.answer(CODE, ANA, 'in', false);
    await remote.answer(CODE, BEN, 'maybe', false);
    expect(await answers()).toHaveLength(2);
  });

  it('refuses a status it does not know as bad_status', async () => {
    expect(await reasonOf(remote.answer(CODE, ANA, 'yes' as never, false))).toBe('bad_status');
    expect(await answers()).toEqual([]);
  });

  it('refuses an unknown code as unknown_link', async () => {
    expect(await reasonOf(remote.answer('0'.repeat(24), ANA, 'in', false))).toBe('unknown_link');
  });

  it('refuses a cancelled date as cancelled', async () => {
    await cancelToday(null);
    expect(await reasonOf(remote.answer(CODE, ANA, 'in', false))).toBe('cancelled');
    expect(await answers()).toEqual([]);
  });

  it('refuses a removed player and a stranger as unknown_player', async () => {
    expect(await reasonOf(remote.answer(CODE, GONE, 'in', false))).toBe('unknown_player');
    expect(await reasonOf(remote.answer(CODE, '99999999-9999-4999-8999-999999999999', 'in', false))).toBe('unknown_player');
    expect(await answers()).toEqual([]);
  });

  it('refuses a player id that is not an id as a server error', async () => {
    expect(await reasonOf(remote.answer(CODE, 'not-a-uuid', 'in', false))).toBe('server');
  });
});

describe('addGuest', () => {
  it('adds a friend for the member who brought them, and counts it in the view', async () => {
    await remote.addGuest(CODE, '  Zed Zane ', ANA);
    expect(await guests()).toEqual([{ name: 'Zed Zane', brought_by: ANA }]);
    expect((await remote.view(CODE))!.friends).toBe(1);
  });

  it('adds a new member asking to join with no one bringing them, and does not count it as a friend', async () => {
    await remote.addGuest(CODE, 'Newbie', null);
    expect(await guests()).toEqual([{ name: 'Newbie', brought_by: null }]);
    expect((await remote.view(CODE))!.friends).toBe(0);
  });

  it('accepts 40 characters', async () => {
    await remote.addGuest(CODE, 'x'.repeat(40), null);
    expect(await guests()).toHaveLength(1);
  });

  it('refuses an empty name, a blank name and 41 characters as bad_name', async () => {
    expect(await reasonOf(remote.addGuest(CODE, '', null))).toBe('bad_name');
    expect(await reasonOf(remote.addGuest(CODE, '   ', null))).toBe('bad_name');
    expect(await reasonOf(remote.addGuest(CODE, 'x'.repeat(41), null))).toBe('bad_name');
    expect(await guests()).toEqual([]);
  });

  it('refuses an unknown code as unknown_link', async () => {
    expect(await reasonOf(remote.addGuest('0'.repeat(24), 'Zed', null))).toBe('unknown_link');
  });

  it('refuses a cancelled date as cancelled', async () => {
    await cancelToday('Rain');
    expect(await reasonOf(remote.addGuest(CODE, 'Zed', null))).toBe('cancelled');
  });

  it('refuses a removed or foreign member as the one who brought them, as unknown_player', async () => {
    expect(await reasonOf(remote.addGuest(CODE, 'Zed', GONE))).toBe('unknown_player');
    expect(await reasonOf(remote.addGuest(CODE, 'Zed', '99999999-9999-4999-8999-999999999999'))).toBe('unknown_player');
  });

  it('keeps at most 20 waiting names for the date, then says too_many', async () => {
    for (let i = 0; i < 20; i += 1) await remote.addGuest(CODE, `Guest ${i}`, null);
    expect(await reasonOf(remote.addGuest(CODE, 'One more', ANA))).toBe('too_many');
    expect(await guests()).toHaveLength(20);
  });
});

describe('the anonymous role', () => {
  it('cannot read the tables, only call the three functions', async () => {
    await expect(db.exec('set role anon; select * from public.attendance_links')).rejects.toThrow();
    await db.exec('reset role');
  });
});

describe('offline and the log', () => {
  it('fails every call as offline while the switch is on, and does not touch the database', async () => {
    flags.offline = true;
    expect(await reasonOf(remote.view(CODE))).toBe('offline');
    expect(await reasonOf(remote.answer(CODE, ANA, 'in', false))).toBe('offline');
    expect(await reasonOf(remote.addGuest(CODE, 'Zed', null))).toBe('offline');
    flags.offline = false;
    expect(await answers()).toEqual([]);
    expect(await guests()).toEqual([]);
  });

  it('logs what it was asked, in order', async () => {
    await remote.view(CODE);
    await remote.answer(CODE, ANA, 'in', true);
    await remote.addGuest(CODE, 'Zed', ANA);
    expect(flags.calls).toEqual([`view:${CODE}`, `answer:${CODE}:${ANA}:in:true`, `addGuest:${CODE}:Zed:${ANA}`]);
  });

  it('logs a call that fails offline too', async () => {
    flags.offline = true;
    await remote.view(CODE).catch(() => undefined);
    expect(flags.calls).toEqual([`view:${CODE}`]);
  });
});
```

Create `src/member/remote.wire.test.ts`:

```typescript
// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { isMemberError, supabaseMemberRemote, type MemberReason } from './remote';

const ANA = '11111111-1111-4111-8111-111111111111';
const KEY = 'sb_publishable_test';

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
  const client = createClient('http://localhost:54321', KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchStub },
  });
  return supabaseMemberRemote(client);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const raised = (reason: string) => json(400, { code: 'P0001', details: null, hint: null, message: reason });

const reasonOf = async (p: Promise<unknown>) => {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  return isMemberError(error) ? error.reason : `not a MemberError: ${String(error)}`;
};

const calls: [string, (r: ReturnType<typeof realRemote>) => Promise<unknown>][] = [
  ['view', (r) => r.view('abc')],
  ['answer', (r) => r.answer('abc', ANA, 'in', false)],
  ['addGuest', (r) => r.addGuest('abc', 'Zed', null)],
];

beforeEach(() => {
  seen = [];
  reply = () => json(200, null);
});

describe('what the member remote sends', () => {
  it('asks the database function for the view, by code', async () => {
    const view = { title: 'Tuesday open play', play_date: '2026-11-10' };
    reply = () => json(200, view);
    expect(await realRemote().view('abc123')).toEqual(view);
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url.pathname).toBe('/rest/v1/rpc/attendance_view');
    expect(JSON.parse(seen[0].body!)).toEqual({ p_code: 'abc123' });
  });

  it('reads an unknown code as null', async () => {
    reply = () => json(200, null);
    expect(await realRemote().view('nope')).toBeNull();
  });

  it('sends an answer with the player, the status and the late flag', async () => {
    reply = () => json(200, { play_date: '2026-11-10', status: 'in', late: true });
    await realRemote().answer('abc123', ANA, 'in', true);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url.pathname).toBe('/rest/v1/rpc/attendance_answer');
    expect(JSON.parse(seen[0].body!)).toEqual({ p_code: 'abc123', p_player_id: ANA, p_status: 'in', p_late: true });
  });

  it('sends late false as false, not as a missing field', async () => {
    await realRemote().answer('abc123', ANA, 'maybe', false);
    expect(JSON.parse(seen[0].body!)).toEqual({ p_code: 'abc123', p_player_id: ANA, p_status: 'maybe', p_late: false });
  });

  it('sends a friend with the member who brings them', async () => {
    reply = () => json(200, { id: 'g1', play_date: '2026-11-10' });
    await realRemote().addGuest('abc123', 'Zed Zane', ANA);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url.pathname).toBe('/rest/v1/rpc/attendance_add_guest');
    expect(JSON.parse(seen[0].body!)).toEqual({ p_code: 'abc123', p_name: 'Zed Zane', p_brought_by: ANA });
  });

  it('sends a new member asking to join with p_brought_by null', async () => {
    await realRemote().addGuest('abc123', 'Newbie', null);
    expect(JSON.parse(seen[0].body!)).toEqual({ p_code: 'abc123', p_name: 'Newbie', p_brought_by: null });
  });

  it('sends the publishable key and no signed-in session, on every call', async () => {
    for (const [, call] of calls) await call(realRemote());
    expect(seen).toHaveLength(3);
    for (const s of seen) {
      expect(s.headers.get('apikey')).toBe(KEY);
      expect(s.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    }
  });

  it('makes one request for each call', async () => {
    for (const [, call] of calls) await call(realRemote());
    expect(seen.map((s) => s.url.pathname)).toEqual([
      '/rest/v1/rpc/attendance_view',
      '/rest/v1/rpc/attendance_answer',
      '/rest/v1/rpc/attendance_add_guest',
    ]);
  });
});

describe('what the member remote makes of a failure', () => {
  const reasons: MemberReason[] = ['bad_status', 'unknown_link', 'cancelled', 'unknown_player', 'bad_name', 'too_many'];

  it.each(reasons)('keeps the reason %s for every call', async (reason) => {
    reply = () => raised(reason);
    for (const [, call] of calls) expect(await reasonOf(call(realRemote()))).toBe(reason);
  });

  it('says server for a P0001 text it does not know', async () => {
    reply = () => raised('something_else');
    expect(await reasonOf(realRemote().answer('abc', ANA, 'in', false))).toBe('server');
  });

  it('says server for a known reason word that did not come from the database rule', async () => {
    reply = () => json(400, { code: '22P02', message: 'cancelled' });
    expect(await reasonOf(realRemote().answer('abc', ANA, 'in', false))).toBe('server');
  });

  it('says server for a 500', async () => {
    reply = () => json(500, { code: 'XX000', message: 'boom' });
    for (const [, call] of calls) expect(await reasonOf(call(realRemote()))).toBe('server');
  });

  it('says server for a 401, never signed out', async () => {
    reply = () => json(401, { code: 'PGRST301', message: 'JWT expired' });
    for (const [, call] of calls) expect(await reasonOf(call(realRemote()))).toBe('server');
  });

  it('says offline for a dropped connection', async () => {
    reply = () => {
      throw new TypeError('Failed to fetch');
    };
    for (const [, call] of calls) expect(await reasonOf(call(realRemote()))).toBe('offline');
  });

  it('says offline when the browser reports no connection, even for a server error', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
    try {
      reply = () => json(500, { code: 'XX000', message: 'boom' });
      expect(await reasonOf(realRemote().view('abc'))).toBe('offline');
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });

  it('never carries the raw database error in the error message', async () => {
    reply = () => json(400, { code: 'P0001', message: 'unknown_link', details: 'secret detail', hint: 'secret hint' });
    const error = await realRemote().view('abc').catch((e: unknown) => e);
    expect(isMemberError(error)).toBe(true);
    expect((error as Error).message).toBe('Member request failed (unknown_link)');
  });
});
```

Create `src/member/route.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { joinChanged, parseJoinHash } from './route';

describe('parseJoinHash', () => {
  it('reads the code from a join hash', () => {
    expect(parseJoinHash('#/j/abc123')).toBe('abc123');
  });

  it('accepts letters, digits, dash and underscore', () => {
    expect(parseJoinHash('#/j/Ab-9_zZ')).toBe('Ab-9_zZ');
  });

  it('keeps the case of the code', () => {
    expect(parseJoinHash('#/j/ABCdef')).toBe('ABCdef');
  });

  it('is null for no hash', () => {
    expect(parseJoinHash('')).toBeNull();
    expect(parseJoinHash('#')).toBeNull();
  });

  it('is null for another prefix', () => {
    expect(parseJoinHash('#/x/abc')).toBeNull();
    expect(parseJoinHash('#/join/abc')).toBeNull();
    expect(parseJoinHash('#j/abc')).toBeNull();
    expect(parseJoinHash('/j/abc')).toBeNull();
    expect(parseJoinHash('#/J/abc')).toBeNull();
  });

  it('is null for an empty code', () => {
    expect(parseJoinHash('#/j/')).toBeNull();
    expect(parseJoinHash('#/j')).toBeNull();
  });

  it('is null for an extra path, query or trailing slash', () => {
    expect(parseJoinHash('#/j/abc/def')).toBeNull();
    expect(parseJoinHash('#/j/abc/')).toBeNull();
    expect(parseJoinHash('#/j/abc?x=1')).toBeNull();
    expect(parseJoinHash('#/j/abc#top')).toBeNull();
  });

  it('is null for odd characters in the code', () => {
    expect(parseJoinHash('#/j/ab c')).toBeNull();
    expect(parseJoinHash('#/j/ab.c')).toBeNull();
    expect(parseJoinHash('#/j/ab%20c')).toBeNull();
    expect(parseJoinHash('#/j/<script>')).toBeNull();
    expect(parseJoinHash('#/j/abc\n')).toBeNull();
    expect(parseJoinHash('#/j/café')).toBeNull();
  });

  it('does not match text before the hash', () => {
    expect(parseJoinHash('x#/j/abc')).toBeNull();
    expect(parseJoinHash(' #/j/abc')).toBeNull();
  });
});

describe('joinChanged', () => {
  it('is false when the code is the same', () => {
    expect(joinChanged('abc', '#/j/abc')).toBe(false);
  });

  it('is true when the code changes', () => {
    expect(joinChanged('abc', '#/j/def')).toBe(true);
  });

  it('is true when a join code appears', () => {
    expect(joinChanged(null, '#/j/abc')).toBe(true);
  });

  it('is true when the join code goes away', () => {
    expect(joinChanged('abc', '')).toBe(true);
    expect(joinChanged('abc', '#/settings')).toBe(true);
  });

  it('is false when there was none and there is none', () => {
    expect(joinChanged(null, '')).toBe(false);
    expect(joinChanged(null, '#/other')).toBe(false);
  });

  it('treats a different case as a different code', () => {
    expect(joinChanged('abc', '#/j/ABC')).toBe(true);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/member/client.test.ts src/member/remote.test.ts src/member/remote.wire.test.ts src/member/route.test.ts`

Expected: it fails. Test Files `4 failed (4)`, Tests `no tests`.

- [ ] **Step 3: Write the code**

Create `src/member/client.ts`:

```typescript
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isSecretKey } from '../sync/client';

let client: SupabaseClient | null | undefined;

/**
 * The member page's own anonymous client, or null when this build has no backend. It keeps no session, so an
 * organizer signed in on the same phone cannot turn a member's request into a "signed out". Never throws.
 */
export function getMemberClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) {
    client = null;
  } else if (isSecretKey(key)) {
    console.error('VITE_SUPABASE_PUBLISHABLE_KEY holds a secret key. Ignoring it: use the publishable key.');
    client = null;
  } else {
    try {
      client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    } catch {
      console.error('Could not create the Supabase client. Check that VITE_SUPABASE_URL is the project address, like https://abc.supabase.co.');
      client = null;
    }
  }
  return client;
}
```

Create `src/member/fakeRemote.ts`:

```typescript
import type { PGlite } from '@electric-sql/pglite';
import { run } from '../sync/db/harness';
import type { AttendanceViewData } from '../sync/attendance/types';
import { MemberError, memberFailure, type MemberRemote } from './remote';

/** Switches and a log a test holds on to. */
export interface MemberFlags {
  /** While true, every request fails the way a request with no connection does. */
  offline: boolean;
  /** What the remote was asked, in order. */
  calls: string[];
}

/**
 * A stand-in for the real server, for tests: the three public functions as real SQL, run as the anonymous role on
 * the in-memory Postgres from `createDb()`, so the migration's rules really apply. A refused call keeps its reason.
 */
export function fakeMemberRemote(db: PGlite, flags: MemberFlags = { offline: false, calls: [] }): MemberRemote {
  const sql = async (call: string, text: string, params: unknown[]) => {
    flags.calls.push(call);
    if (flags.offline) throw new MemberError('offline');
    try {
      return (await run(db, 'anon', text, params)).rows as Record<string, unknown>[];
    } catch (error) {
      throw memberFailure(error as { message?: string; code?: string });
    }
  };
  return {
    async view(code) {
      const rows = await sql(`view:${code}`, 'select public.attendance_view($1) as v', [code]);
      return (rows[0]?.v as AttendanceViewData | null) ?? null;
    },
    async answer(code, playerId, status, late) {
      await sql(`answer:${code}:${playerId}:${status}:${late}`, 'select public.attendance_answer($1, $2, $3, $4)', [code, playerId, status, late]);
    },
    async addGuest(code, name, broughtBy) {
      await sql(`addGuest:${code}:${name}:${broughtBy}`, 'select public.attendance_add_guest($1, $2, $3)', [code, name, broughtBy]);
    },
  };
}
```

Create `src/member/remote.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttendanceStatus, AttendanceViewData } from '../sync/attendance/types';

/** The reasons the database raises, plus the two a failed request can be. */
export type MemberReason = 'bad_status' | 'unknown_link' | 'cancelled' | 'unknown_player' | 'bad_name' | 'too_many' | 'offline' | 'server';

const RAISED: readonly string[] = ['bad_status', 'unknown_link', 'cancelled', 'unknown_player', 'bad_name', 'too_many'];

export class MemberError extends Error {
  constructor(readonly reason: MemberReason) {
    super(`Member request failed (${reason})`);
    this.name = 'MemberError';
  }
}

/** True for a `MemberError`, even one made by another copy of this module. */
export function isMemberError(error: unknown): error is MemberError {
  return error instanceof Error && error.name === 'MemberError' && typeof (error as { reason?: unknown }).reason === 'string';
}

/** What the member page asks of the server. Every method throws a `MemberError` when it fails. */
export interface MemberRemote {
  /** What the page shows for a code, or null for an unknown code. */
  view(code: string): Promise<AttendanceViewData | null>;
  answer(code: string, playerId: string, status: AttendanceStatus, late: boolean): Promise<void>;
  /** A friend (with `broughtBy`) or a new member asking to join (null). Waits for the organizer. */
  addGuest(code: string, name: string, broughtBy: string | null): Promise<void>;
}

interface Failure {
  message?: string;
  code?: string;
  status?: number;
}

const NETWORK = /failed to fetch|network|load failed|fetch failed/i;

/** Reads the reason the database raised (plain text, code P0001), else offline or server. Status 0 is a request that never arrived. */
export function memberFailure(error: Failure, status?: number): MemberError {
  if (error.code === 'P0001' && RAISED.includes(error.message ?? '')) return new MemberError(error.message as MemberReason);
  const code = status ?? error.status;
  const offline = code === 0 || NETWORK.test(error.message ?? '') || (typeof navigator !== 'undefined' && navigator.onLine === false);
  return new MemberError(offline ? 'offline' : 'server');
}

/** The real server, as an anonymous visitor. */
export function supabaseMemberRemote(client: SupabaseClient): MemberRemote {
  return {
    async view(code) {
      const { data, error, status } = await client.rpc('attendance_view', { p_code: code });
      if (error) throw memberFailure(error, status);
      return (data as AttendanceViewData | null) ?? null;
    },
    async answer(code, playerId, status, late) {
      const res = await client.rpc('attendance_answer', { p_code: code, p_player_id: playerId, p_status: status, p_late: late });
      if (res.error) throw memberFailure(res.error, res.status);
    },
    async addGuest(code, name, broughtBy) {
      const { error, status } = await client.rpc('attendance_add_guest', { p_code: code, p_name: name, p_brought_by: broughtBy });
      if (error) throw memberFailure(error, status);
    },
  };
}
```

Create `src/member/route.ts`:

```typescript
const JOIN = /^#\/j\/([A-Za-z0-9_-]+)$/;

/** The link code in a page address hash like "#/j/abc123", or null when the hash is anything else. */
export const parseJoinHash = (hash: string): string | null => JOIN.exec(hash)?.[1] ?? null;

/** True when the hash now names a different join code (or none) than the page was opened with. */
export const joinChanged = (previous: string | null, hash: string): boolean => parseJoinHash(hash) !== previous;
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/member/client.test.ts src/member/remote.test.ts src/member/remote.wire.test.ts src/member/route.test.ts`

Expected: it passes. Test Files `4 passed (4)`, Tests `73 passed (73)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 1855 tests across 138 files.

- [ ] **Step 5: Commit**

```bash
git add src/member/client.test.ts src/member/remote.test.ts src/member/remote.wire.test.ts src/member/route.test.ts src/member/client.ts src/member/fakeRemote.ts src/member/remote.ts src/member/route.ts
git commit -m "Add the member remote: anonymous client, reasons kept, in-memory version and request shapes"
```

---

### Task 3: The helpers: remembered pick, offline copy, wording, dates and the calendar file

Small pure helpers: the player a member picked is remembered per link, the last good list is kept for offline, the wording and dates (never read from a UTC string), the busy line, and the `.ics` file (floating local time, no code in the file, escaped and folded).

**Files:**
- Create: `src/member/cache.ts`
- Create: `src/member/format.ts`
- Create: `src/member/ics.ts`
- Create: `src/member/identity.ts`
- Create: `src/member/cache.test.ts`
- Create: `src/member/format.test.ts`
- Create: `src/member/ics.test.ts`
- Create: `src/member/identity.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/member/cache.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceViewData } from '../sync/attendance/types';
import { CACHE_KEY, parseCache, readCached, writeCached } from './cache';

const view = (title = 'Tuesday open play'): AttendanceViewData => ({
  title,
  weekday: 2,
  venue: 'Sample Hall',
  start_min: 1140,
  end_min: 1260,
  courts: 3,
  play_date: '2026-11-10',
  cancelled: null,
  players: [{ id: 'p1', first_name: 'Ana', last_initial: 'R', has_photo: false, photo_seq: 0 }],
  answers: [{ player_id: 'p1', status: 'in', late: true }],
  friends: 2,
});
const stored = () => JSON.parse(localStorage.getItem(CACHE_KEY)!) as { version: number; entries: Record<string, { view: unknown; at: number }> };

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the storage key', () => {
  it('is pikl.member.cache.v1', () => {
    expect(CACHE_KEY).toBe('pikl.member.cache.v1');
  });
});

describe('writeCached and readCached', () => {
  it('reads nothing for a code never kept', () => {
    expect(readCached('abc')).toBeNull();
  });

  it('keeps the view and when it was fetched', () => {
    writeCached('abc', view(), 1000);
    expect(readCached('abc')).toEqual({ view: view(), at: 1000 });
  });

  it('keeps each code apart', () => {
    writeCached('abc', view('One'), 1);
    writeCached('def', view('Two'), 2);
    expect(readCached('abc')?.view.title).toBe('One');
    expect(readCached('def')?.view.title).toBe('Two');
  });

  it('replaces the copy for a code', () => {
    writeCached('abc', view('Old'), 1);
    writeCached('abc', view('New'), 2);
    expect(readCached('abc')).toEqual({ view: view('New'), at: 2 });
    expect(Object.keys(stored().entries)).toEqual(['abc']);
  });

  it('writes the documented shape', () => {
    writeCached('abc', view(), 1000);
    expect(stored()).toEqual({ version: 1, entries: { abc: { view: view(), at: 1000 } } });
  });

  it('keeps at most 5 codes and drops the oldest', () => {
    for (let i = 0; i < 6; i += 1) writeCached(`code${i}`, view(), i);
    expect(Object.keys(stored().entries)).toHaveLength(5);
    expect(readCached('code0')).toBeNull();
    expect(readCached('code1')).not.toBeNull();
    expect(readCached('code5')).not.toBeNull();
  });

  it('counts a rewrite as new, so it is the last to go', () => {
    for (let i = 0; i < 5; i += 1) writeCached(`code${i}`, view(), i);
    writeCached('code0', view(), 10);
    writeCached('code5', view(), 11);
    expect(readCached('code0')).not.toBeNull();
    expect(readCached('code1')).toBeNull();
  });

  it('does not throw when storage is blocked or full', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(readCached('abc')).toBeNull();
    expect(() => writeCached('abc', view(), 1)).not.toThrow();
  });
});

describe('parseCache', () => {
  const good = JSON.stringify({ version: 1, entries: { abc: { view: view(), at: 5 } } });

  it('reads a good value', () => {
    expect(parseCache(good)).toEqual({ version: 1, entries: { abc: { view: view(), at: 5 } } });
  });

  it('is empty for nothing, bad JSON, the wrong shape and another version', () => {
    for (const raw of [null, '', '{nope', 'null', '[]', '{}', '{"version":1}', '{"version":1,"entries":[]}', '{"version":1,"entries":null}', '{"version":2,"entries":{}}']) {
      expect(parseCache(raw)).toEqual({ version: 1, entries: {} });
    }
  });

  it('drops an entry whose time is not a number', () => {
    for (const at of ['5', null, 'x', {}]) {
      expect(parseCache(JSON.stringify({ version: 1, entries: { abc: { view: view(), at } } })).entries).toEqual({});
    }
  });

  it('drops an entry with no view', () => {
    expect(parseCache('{"version":1,"entries":{"abc":{"at":5},"def":null,"ghi":7}}').entries).toEqual({});
  });

  it('drops a code that is not a link code', () => {
    expect(parseCache(JSON.stringify({ version: 1, entries: { 'a b': { view: view(), at: 5 }, ok: { view: view(), at: 5 } } })).entries).toHaveProperty('ok');
    expect(Object.keys(parseCache(JSON.stringify({ version: 1, entries: { 'a b': { view: view(), at: 5 } } })).entries)).toEqual([]);
  });

  it.each([
    ['title', { title: 7 }],
    ['weekday', { weekday: 'x' }],
    ['venue', { venue: 5 }],
    ['start_min', { start_min: 'x' }],
    ['end_min', { end_min: 'x' }],
    ['courts', { courts: 'x' }],
    ['play_date', { play_date: 'soon' }],
    ['play_date missing', { play_date: undefined }],
    ['cancelled', { cancelled: 'yes' }],
    ['cancelled reason', { cancelled: { reason: 5 } }],
    ['players', { players: 'x' }],
    ['a player', { players: [{ id: 'p1' }] }],
    ['answers', { answers: {} }],
    ['an answer', { answers: [{ player_id: 'p1', status: 'bogus', late: false }] }],
    ['friends', { friends: 'two' }],
  ])('drops an entry with a bad %s', (_name, patch) => {
    const entry = { view: { ...view(), ...patch }, at: 5 };
    expect(parseCache(JSON.stringify({ version: 1, entries: { abc: entry } })).entries).toEqual({});
  });

  it('accepts null for the optional fields and a cancelled week', () => {
    const v = { ...view(), venue: null, start_min: null, end_min: null, courts: null, cancelled: { reason: null } };
    expect(parseCache(JSON.stringify({ version: 1, entries: { abc: { view: v, at: 5 } } })).entries.abc.view).toEqual(v);
    const w = { ...view(), cancelled: { reason: 'Rain' } };
    expect(parseCache(JSON.stringify({ version: 1, entries: { abc: { view: w, at: 5 } } })).entries.abc.view.cancelled).toEqual({ reason: 'Rain' });
  });

  it('keeps the good entries next to a bad one', () => {
    const raw = JSON.stringify({ version: 1, entries: { bad: { view: 7, at: 1 }, abc: { view: view(), at: 5 } } });
    expect(Object.keys(parseCache(raw).entries)).toEqual(['abc']);
  });

  it('keeps the newest 5 when more are stored', () => {
    const entries = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`code${i}`, { view: view(), at: i }]));
    const kept = Object.keys(parseCache(JSON.stringify({ version: 1, entries })).entries);
    expect(kept).toEqual(['code3', 'code4', 'code5', 'code6', 'code7']);
  });

  it('keeps only the known fields of a view', () => {
    const v = { ...view(), ownerId: 'secret', extra: 1 };
    const out = parseCache(JSON.stringify({ version: 1, entries: { abc: { view: v, at: 5 } } })).entries.abc.view;
    expect(out).toEqual(view());
    expect(out).not.toHaveProperty('ownerId');
  });
});
```

Create `src/member/format.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { AttendanceViewData } from '../sync/attendance/types';
import { busyLine, clock12, dateLabel, isBusy, nextWeek, statusLine, whenLine } from './format';

const base: AttendanceViewData = {
  title: 'Tuesday open play',
  weekday: 2,
  venue: 'Sample Hall',
  start_min: 1140,
  end_min: 1260,
  courts: 3,
  play_date: '2026-11-10',
  cancelled: null,
  players: [],
  answers: [],
  friends: 0,
};
const view = (patch: Partial<AttendanceViewData>): AttendanceViewData => ({ ...base, ...patch });

/** A view with `n` players who answered In, and `friends` friends. */
function busy(n: number, friends: number, courts: number | null): AttendanceViewData {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, first_name: `P${i}`, last_initial: null, has_photo: false, photo_seq: 0 }));
  return view({ courts, friends, players, answers: players.map((p) => ({ player_id: p.id, status: 'in' as const, late: false })) });
}

describe('clock12', () => {
  it('drops the minutes on the hour', () => {
    expect(clock12(1140)).toBe('7 pm');
    expect(clock12(540)).toBe('9 am');
  });

  it('keeps the minutes when there are some', () => {
    expect(clock12(1170)).toBe('7:30 pm');
    expect(clock12(545)).toBe('9:05 am');
  });

  it('handles midnight and noon', () => {
    expect(clock12(0)).toBe('12 am');
    expect(clock12(30)).toBe('12:30 am');
    expect(clock12(720)).toBe('12 pm');
    expect(clock12(750)).toBe('12:30 pm');
  });

  it('handles the last minute of the day', () => {
    expect(clock12(1439)).toBe('11:59 pm');
  });

  it('switches from am to pm at noon', () => {
    expect(clock12(719)).toBe('11:59 am');
    expect(clock12(780)).toBe('1 pm');
  });
});

describe('dateLabel', () => {
  it('writes the weekday, the day and the month', () => {
    expect(dateLabel('2026-11-10')).toBe('Tue 10 Nov');
  });

  it('does not pad the day', () => {
    expect(dateLabel('2026-11-03')).toBe('Tue 3 Nov');
  });

  it('is right at the start and end of a month and a year', () => {
    expect(dateLabel('2026-12-31')).toBe('Thu 31 Dec');
    expect(dateLabel('2027-01-01')).toBe('Fri 1 Jan');
    expect(dateLabel('2026-01-31')).toBe('Sat 31 Jan');
    expect(dateLabel('2026-02-01')).toBe('Sun 1 Feb');
    expect(dateLabel('2026-03-01')).toBe('Sun 1 Mar');
  });

  it('knows a leap day', () => {
    expect(dateLabel('2028-02-29')).toBe('Tue 29 Feb');
  });

  it('names every month and every weekday', () => {
    const months = Array.from({ length: 12 }, (_, i) => dateLabel(`2026-${String(i + 1).padStart(2, '0')}-15`).split(' ')[2]);
    expect(months).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
    const days = Array.from({ length: 7 }, (_, i) => dateLabel(`2026-11-0${i + 1}`).split(' ')[0]);
    expect(days).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });

  it('gives the same answer in any time zone of the device', () => {
    // 2026-11-10 is read as a calendar date, never as midnight UTC.
    expect(dateLabel('2026-11-10')).toBe('Tue 10 Nov');
  });

  it('gives back text that is not a date', () => {
    expect(dateLabel('soon')).toBe('soon');
    expect(dateLabel('')).toBe('');
  });
});

describe('nextWeek', () => {
  it('adds seven days', () => {
    expect(nextWeek('2026-11-10')).toBe('2026-11-17');
  });

  it('crosses a month end', () => {
    expect(nextWeek('2026-11-24')).toBe('2026-12-01');
    expect(nextWeek('2026-01-28')).toBe('2026-02-04');
  });

  it('crosses a year end', () => {
    expect(nextWeek('2026-12-29')).toBe('2027-01-05');
  });

  it('knows a leap year', () => {
    expect(nextWeek('2028-02-25')).toBe('2028-03-03');
    expect(nextWeek('2027-02-25')).toBe('2027-03-04');
  });

  it('pads month and day', () => {
    expect(nextWeek('2026-01-01')).toBe('2026-01-08');
  });

  it('gives back text that is not a date', () => {
    expect(nextWeek('soon')).toBe('soon');
  });
});

describe('whenLine', () => {
  it('joins the date, the time and the venue', () => {
    expect(whenLine(base)).toBe('Tue 10 Nov, 7 to 9 pm, Sample Hall');
  });

  it('writes both clocks when the range crosses noon', () => {
    expect(whenLine(view({ start_min: 660, end_min: 810 }))).toBe('Tue 10 Nov, 11 am to 1:30 pm, Sample Hall');
  });

  it('leaves out the venue when missing', () => {
    expect(whenLine(view({ venue: null }))).toBe('Tue 10 Nov, 7 to 9 pm');
    expect(whenLine(view({ venue: '  ' }))).toBe('Tue 10 Nov, 7 to 9 pm');
  });

  it('leaves out the time when there is none', () => {
    expect(whenLine(view({ start_min: null, end_min: null }))).toBe('Tue 10 Nov, Sample Hall');
  });

  it('says only the start when there is no end', () => {
    expect(whenLine(view({ end_min: null }))).toBe('Tue 10 Nov, from 7 pm, Sample Hall');
  });

  it('says only the end when there is no start', () => {
    expect(whenLine(view({ start_min: null }))).toBe('Tue 10 Nov, until 9 pm, Sample Hall');
  });

  it('is the date alone when nothing else is known', () => {
    expect(whenLine(view({ start_min: null, end_min: null, venue: null }))).toBe('Tue 10 Nov');
  });

  it('keeps a start at midnight', () => {
    expect(whenLine(view({ start_min: 0, end_min: 60, venue: null }))).toBe('Tue 10 Nov, 12 to 1 am');
  });
});

describe('statusLine', () => {
  it('says In with the date', () => {
    expect(statusLine('in', 'Tue 10 Nov')).toBe("You're in for Tue 10 Nov.");
  });

  it('says Maybe with the date and that it can change', () => {
    expect(statusLine('maybe', 'Tue 10 Nov')).toBe("You're a maybe for Tue 10 Nov. You can change this any time.");
  });

  it('says Out with the date', () => {
    expect(statusLine('out', 'Tue 10 Nov')).toBe("You're out for Tue 10 Nov.");
  });

  it('uses a straight apostrophe and no dash or exclamation mark', () => {
    for (const s of ['in', 'maybe', 'out'] as const) expect(statusLine(s, 'Tue 10 Nov')).not.toMatch(/[!\u2014\u2013\u2019]/);
  });
});

describe('isBusy', () => {
  it('is false at exactly 4 for each court', () => {
    expect(isBusy(busy(12, 0, 3))).toBe(false);
    expect(isBusy(busy(8, 4, 3))).toBe(false);
  });

  it('is true one past 4 for each court', () => {
    expect(isBusy(busy(13, 0, 3))).toBe(true);
    expect(isBusy(busy(9, 4, 3))).toBe(true);
  });

  it('counts friends with the people who are in', () => {
    expect(isBusy(busy(12, 1, 3))).toBe(true);
  });

  it('does not count Maybe or Out', () => {
    const v = busy(12, 0, 3);
    v.players.push({ id: 'm', first_name: 'M', last_initial: null, has_photo: false, photo_seq: 0 });
    v.answers.push({ player_id: 'm', status: 'maybe', late: false });
    v.players.push({ id: 'o', first_name: 'O', last_initial: null, has_photo: false, photo_seq: 0 });
    v.answers.push({ player_id: 'o', status: 'out', late: false });
    expect(isBusy(v)).toBe(false);
  });

  it('does not count an answer from someone no longer on the roster', () => {
    const v = busy(12, 0, 3);
    v.answers.push({ player_id: 'ghost', status: 'in', late: false });
    expect(isBusy(v)).toBe(false);
  });

  it('is false when the courts are not known', () => {
    expect(isBusy(busy(40, 10, null))).toBe(false);
  });

  it('scales with the courts', () => {
    expect(isBusy(busy(4, 0, 1))).toBe(false);
    expect(isBusy(busy(5, 0, 1))).toBe(true);
    expect(isBusy(busy(48, 0, 12))).toBe(false);
    expect(isBusy(busy(49, 0, 12))).toBe(true);
  });
});

describe('busyLine', () => {
  it('says the number in and the courts', () => {
    expect(busyLine(busy(13, 0, 3))).toBe('Busy night: 13 in for 3 courts. Expect to sit out a game now and then.');
  });

  it('counts friends in the number', () => {
    expect(busyLine(busy(10, 4, 3))).toBe('Busy night: 14 in for 3 courts. Expect to sit out a game now and then.');
  });

  it('says one court in the singular', () => {
    expect(busyLine(busy(5, 0, 1))).toBe('Busy night: 5 in for 1 court. Expect to sit out a game now and then.');
  });

  it('is null when not busy', () => {
    expect(busyLine(busy(12, 0, 3))).toBeNull();
    expect(busyLine(busy(40, 0, null))).toBeNull();
  });
});
```

Create `src/member/ics.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { AttendanceViewData } from '../sync/attendance/types';
import { calendarFile } from './ics';

const NOW = Date.UTC(2026, 10, 9, 12, 30, 5);
const base: AttendanceViewData = {
  title: 'Tuesday open play',
  weekday: 2,
  venue: 'Sample Hall',
  start_min: 1140,
  end_min: 1260,
  courts: 3,
  play_date: '2026-11-10',
  cancelled: null,
  players: [],
  answers: [],
  friends: 0,
};
const file = (patch: Partial<AttendanceViewData> = {}) => calendarFile({ ...base, ...patch }, NOW);
const lines = (text: string) => text.split('\r\n');
const octets = (s: string) => new TextEncoder().encode(s).length;
const unfold = (text: string) => text.replace(/\r\n /g, '');

describe('calendarFile', () => {
  it('writes a full event, exactly', () => {
    expect(file().text).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//PIKLMatch//Attendance//EN',
        'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT',
        'UID:2026-11-10-tuesday-open-play@piklmatch',
        'DTSTAMP:20261109T123005Z',
        'DTSTART:20261110T190000',
        'DTEND:20261110T210000',
        'SUMMARY:Tuesday open play',
        'LOCATION:Sample Hall',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
  });

  it('names the file after the title and the date', () => {
    expect(file().name).toBe('tuesday-open-play-2026-11-10.ics');
  });

  it('writes a two hour event when there is a start and no end', () => {
    const text = file({ end_min: null }).text;
    expect(text).toContain('\r\nDTSTART:20261110T190000\r\n');
    expect(text).toContain('\r\nDTEND:20261110T210000\r\n');
  });

  it('runs a two hour event past midnight into the next day', () => {
    const text = file({ start_min: 1380, end_min: null }).text;
    expect(text).toContain('\r\nDTSTART:20261110T230000\r\n');
    expect(text).toContain('\r\nDTEND:20261111T010000\r\n');
  });

  it('runs an end that is not after the start into the next day', () => {
    const text = file({ start_min: 1320, end_min: 60 }).text;
    expect(text).toContain('\r\nDTSTART:20261110T220000\r\n');
    expect(text).toContain('\r\nDTEND:20261111T010000\r\n');
    const same = file({ start_min: 600, end_min: 600 }).text;
    expect(same).toContain('\r\nDTEND:20261111T100000\r\n');
  });

  it('writes an all-day event when there is no start', () => {
    const text = file({ start_min: null, end_min: null }).text;
    expect(text).toContain('\r\nDTSTART;VALUE=DATE:20261110\r\n');
    expect(text).toContain('\r\nDTEND;VALUE=DATE:20261111\r\n');
    expect(text).not.toContain('DTSTART:');
  });

  it('writes an all-day event when there is an end and no start', () => {
    const text = file({ start_min: null, end_min: 1260 }).text;
    expect(text).toContain('\r\nDTSTART;VALUE=DATE:20261110\r\n');
  });

  it('ends an all-day event on the next day across a month and a year', () => {
    expect(file({ start_min: null, end_min: null, play_date: '2026-11-30' }).text).toContain('DTEND;VALUE=DATE:20261201');
    expect(file({ start_min: null, end_min: null, play_date: '2026-12-31' }).text).toContain('DTEND;VALUE=DATE:20270101');
  });

  it('pads the clock and the date', () => {
    const text = file({ play_date: '2027-01-05', start_min: 65, end_min: 125 }).text;
    expect(text).toContain('DTSTART:20270105T010500');
    expect(text).toContain('DTEND:20270105T020500');
  });

  it('leaves out the location when the venue is missing or blank', () => {
    expect(file({ venue: null }).text).not.toContain('LOCATION');
    expect(file({ venue: '   ' }).text).not.toContain('LOCATION');
  });

  it('uses CRLF for every line and ends with one', () => {
    const text = file().text;
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('has the same UID for the same date and a different one for another date', () => {
    const uid = (t: string) => /UID:(.*)\r\n/.exec(t)![1];
    expect(uid(file().text)).toBe('2026-11-10-tuesday-open-play@piklmatch');
    expect(uid(file({ play_date: '2026-11-17' }).text)).toBe('2026-11-17-tuesday-open-play@piklmatch');
  });

  it('makes the UID slug from lower case letters, digits and single dashes', () => {
    const uid = (t: string) => /UID:(.*)\r\n/.exec(t)![1];
    expect(uid(file({ title: "  Friday: Night's  Open Play!! " }).text)).toBe('2026-11-10-friday-night-s-open-play@piklmatch');
    expect(uid(file({ title: '!!!' }).text)).toBe('2026-11-10-open-play@piklmatch');
    expect(file({ title: '!!!' }).name).toBe('open-play-2026-11-10.ics');
  });

  it('never has the link code in it', () => {
    const code = 'abcdef0123456789abcdef01';
    expect(JSON.stringify(file())).not.toContain(code);
    expect(file().text).not.toMatch(/\/#\/j\//);
  });

  it('escapes backslash, semicolon, comma and newline', () => {
    const text = file({ title: 'A;B,C\\D', venue: 'Hall 1\nGate 2\r\nUp\rDown' }).text;
    expect(text).toContain('\r\nSUMMARY:A\\;B\\,C\\\\D\r\n');
    expect(text).toContain('\r\nLOCATION:Hall 1\\nGate 2\\nUp\\nDown\r\n');
  });

  it('escapes the backslash first, so it does not escape twice', () => {
    expect(file({ title: 'a\\;b' }).text).toContain('SUMMARY:a\\\\\\;b');
  });

  it('keeps every line to 75 octets', () => {
    const long = 'Spring league, doubles; mixed é ' + 'x'.repeat(200);
    const text = file({ title: long, venue: 'V'.repeat(300) }).text;
    for (const l of lines(text)) expect(octets(l)).toBeLessThanOrEqual(75);
  });

  it('folds a long line with a CRLF and one space, and unfolds to the original', () => {
    const title = 'T'.repeat(200);
    const text = file({ title }).text;
    const out = lines(text);
    const at = out.findIndex((l) => l.startsWith('SUMMARY:'));
    expect(out[at]).toHaveLength(75);
    expect(out[at + 1].startsWith(' ')).toBe(true);
    expect(unfold(text)).toContain(`SUMMARY:${title}\r\n`);
  });

  it('does not fold a line of exactly 75 octets', () => {
    const title = 'T'.repeat(75 - 'SUMMARY:'.length);
    const text = file({ title }).text;
    expect(text).toContain(`\r\nSUMMARY:${title}\r\n`);
  });

  it('folds a line of 76 octets', () => {
    const title = 'T'.repeat(76 - 'SUMMARY:'.length);
    const out = lines(file({ title }).text);
    const at = out.findIndex((l) => l.startsWith('SUMMARY:'));
    expect(out[at]).toHaveLength(75);
    expect(out[at + 1]).toBe(' T');
  });

  it('never splits a multi-byte character when folding', () => {
    const title = 'é'.repeat(100);
    const text = file({ title }).text;
    for (const l of lines(text)) expect(octets(l)).toBeLessThanOrEqual(75);
    expect(unfold(text)).toContain(`SUMMARY:${title}\r\n`);
    expect(text).not.toContain('�');
  });

  it('never splits an emoji when folding', () => {
    const title = '\u{1F3D3}'.repeat(40);
    const text = file({ title }).text;
    for (const l of lines(text)) expect(octets(l)).toBeLessThanOrEqual(75);
    expect(unfold(text)).toContain(`SUMMARY:${title}\r\n`);
  });

  it('counts the leading space of a continuation line in its 75 octets', () => {
    const out = lines(file({ title: 'T'.repeat(400) }).text);
    const folded = out.filter((l) => l.startsWith(' '));
    expect(folded.length).toBeGreaterThan(1);
    expect(folded.some((l) => octets(l) === 75)).toBe(true);
  });

  it('writes the time stamp in UTC from the moment it is given', () => {
    expect(calendarFile(base, Date.UTC(2027, 0, 2, 3, 4, 5)).text).toContain('DTSTAMP:20270102T030405Z');
  });
});
```

Create `src/member/identity.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_KEY, forgetPick, parseIdentity, readPick, savePick } from './identity';

const stored = () => JSON.parse(localStorage.getItem(IDENTITY_KEY)!) as { version: number; picks: Record<string, string> };

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the storage key', () => {
  it('is pikl.member.v1', () => {
    expect(IDENTITY_KEY).toBe('pikl.member.v1');
  });
});

describe('parseIdentity', () => {
  it('is empty for nothing', () => {
    expect(parseIdentity(null)).toEqual({ version: 1, picks: {} });
    expect(parseIdentity('')).toEqual({ version: 1, picks: {} });
  });

  it('reads a good value', () => {
    expect(parseIdentity('{"version":1,"picks":{"abc":"p1","def":"p2"}}')).toEqual({ version: 1, picks: { abc: 'p1', def: 'p2' } });
  });

  it('is empty for text that is not JSON', () => {
    expect(parseIdentity('{nope')).toEqual({ version: 1, picks: {} });
  });

  it('is empty for JSON of the wrong shape', () => {
    for (const raw of ['null', '[]', '7', '"x"', '{}', '{"version":1}', '{"version":1,"picks":[]}', '{"version":1,"picks":null}', '{"version":1,"picks":"x"}']) {
      expect(parseIdentity(raw)).toEqual({ version: 1, picks: {} });
    }
  });

  it('is empty for another version', () => {
    expect(parseIdentity('{"version":2,"picks":{"abc":"p1"}}')).toEqual({ version: 1, picks: {} });
    expect(parseIdentity('{"version":"1","picks":{"abc":"p1"}}')).toEqual({ version: 1, picks: {} });
  });

  it('drops a pick that is not a non-empty string, and keeps the others', () => {
    const raw = '{"version":1,"picks":{"a":"p1","b":7,"c":"","d":null,"e":{"x":1},"f":["p"],"g":"p7"}}';
    expect(parseIdentity(raw).picks).toEqual({ a: 'p1', g: 'p7' });
  });

  it('drops a code that is not a link code', () => {
    const raw = '{"version":1,"picks":{"ok_-1":"p1","has space":"p2","dot.dot":"p3","":"p4"}}';
    expect(parseIdentity(raw).picks).toEqual({ 'ok_-1': 'p1' });
  });

  it('drops a player id that is far too long', () => {
    expect(parseIdentity(JSON.stringify({ version: 1, picks: { a: 'x'.repeat(65), b: 'x'.repeat(64) } })).picks).toEqual({ b: 'x'.repeat(64) });
  });

  it('keeps the newest 20 codes when more are stored', () => {
    const picks = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`code${i}`, `p${i}`]));
    const kept = Object.keys(parseIdentity(JSON.stringify({ version: 1, picks })).picks);
    expect(kept).toHaveLength(20);
    expect(kept[0]).toBe('code5');
    expect(kept[19]).toBe('code24');
  });
});

describe('readPick and savePick', () => {
  it('reads nothing for a code never picked', () => {
    expect(readPick('abc')).toBeNull();
  });

  it('remembers a pick for its code only', () => {
    savePick('abc', 'p1');
    expect(readPick('abc')).toBe('p1');
    expect(readPick('other')).toBeNull();
  });

  it('writes the documented shape', () => {
    savePick('abc', 'p1');
    expect(stored()).toEqual({ version: 1, picks: { abc: 'p1' } });
  });

  it('replaces the pick for a code', () => {
    savePick('abc', 'p1');
    savePick('abc', 'p2');
    expect(readPick('abc')).toBe('p2');
    expect(Object.keys(stored().picks)).toEqual(['abc']);
  });

  it('keeps picks for other codes', () => {
    savePick('abc', 'p1');
    savePick('def', 'p2');
    expect(readPick('abc')).toBe('p1');
    expect(readPick('def')).toBe('p2');
  });

  it('keeps at most 20 codes and drops the oldest', () => {
    for (let i = 0; i < 21; i += 1) savePick(`code${i}`, `p${i}`);
    const keys = Object.keys(stored().picks);
    expect(keys).toHaveLength(20);
    expect(readPick('code0')).toBeNull();
    expect(readPick('code1')).toBe('p1');
    expect(readPick('code20')).toBe('p20');
  });

  it('counts a repeated pick as new, so it is the last to go', () => {
    for (let i = 0; i < 20; i += 1) savePick(`code${i}`, `p${i}`);
    savePick('code0', 'again');
    savePick('code20', 'p20');
    expect(readPick('code0')).toBe('again');
    expect(readPick('code1')).toBeNull();
  });

  it('ignores a bad stored value and starts over', () => {
    localStorage.setItem(IDENTITY_KEY, 'garbage');
    expect(readPick('abc')).toBeNull();
    savePick('abc', 'p1');
    expect(readPick('abc')).toBe('p1');
  });

  it('does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readPick('abc')).toBeNull();
    expect(() => savePick('abc', 'p1')).not.toThrow();
    expect(() => forgetPick('abc')).not.toThrow();
  });
});

describe('forgetPick', () => {
  it('forgets one code and keeps the others', () => {
    savePick('abc', 'p1');
    savePick('def', 'p2');
    forgetPick('abc');
    expect(readPick('abc')).toBeNull();
    expect(readPick('def')).toBe('p2');
  });

  it('does nothing for a code with no pick', () => {
    savePick('def', 'p2');
    forgetPick('abc');
    expect(readPick('def')).toBe('p2');
  });

  it('does not write when there is nothing to forget', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    forgetPick('abc');
    expect(set).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/member/cache.test.ts src/member/format.test.ts src/member/ics.test.ts src/member/identity.test.ts`

Expected: it fails. Test Files `4 failed (4)`, Tests `no tests`.

- [ ] **Step 3: Write the code**

Create `src/member/cache.ts`:

```typescript
import type { AttendanceViewData } from '../sync/attendance/types';

export const CACHE_KEY = 'pikl.member.cache.v1';

const MAX_CODES = 5;
const CODE = /^[A-Za-z0-9_-]+$/;
const STATUSES = ['in', 'maybe', 'out'];

export interface Cached {
  view: AttendanceViewData;
  /** When the view was fetched, in ms. */
  at: number;
}

export interface CacheData {
  version: 1;
  /** The last good view by link code. Oldest first. */
  entries: Record<string, Cached>;
}

const empty = (): CacheData => ({ version: 1, entries: {} });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isNumberOrNull = (v: unknown): v is number | null => v === null || isNumber(v);

/** A view rebuilt from only the fields the page reads, or null when any of them is wrong. */
function asView(raw: unknown): AttendanceViewData | null {
  if (!isObject(raw)) return null;
  const { title, weekday, venue, start_min, end_min, courts, play_date, cancelled, players, answers, friends } = raw;
  if (typeof title !== 'string' || !isNumber(weekday) || !isStringOrNull(venue)) return null;
  if (!isNumberOrNull(start_min) || !isNumberOrNull(end_min) || !isNumberOrNull(courts)) return null;
  if (typeof play_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(play_date) || !isNumber(friends)) return null;
  if (cancelled !== null && !(isObject(cancelled) && isStringOrNull(cancelled.reason))) return null;
  if (!Array.isArray(players) || !Array.isArray(answers)) return null;
  const goodPlayers = players.every(
    (p) =>
      isObject(p) && typeof p.id === 'string' && typeof p.first_name === 'string' && isStringOrNull(p.last_initial) && typeof p.has_photo === 'boolean' && isNumber(p.photo_seq),
  );
  const goodAnswers = answers.every(
    (a) => isObject(a) && typeof a.player_id === 'string' && typeof a.status === 'string' && STATUSES.includes(a.status) && typeof a.late === 'boolean',
  );
  if (!goodPlayers || !goodAnswers) return null;
  return {
    title,
    weekday,
    venue,
    start_min,
    end_min,
    courts,
    play_date,
    cancelled: cancelled === null ? null : { reason: (cancelled as { reason: string | null }).reason },
    players: (players as AttendanceViewData['players']).map((p) => ({
      id: p.id,
      first_name: p.first_name,
      last_initial: p.last_initial,
      has_photo: p.has_photo,
      photo_seq: p.photo_seq,
    })),
    answers: (answers as AttendanceViewData['answers']).map((a) => ({ player_id: a.player_id, status: a.status, late: a.late })),
    friends,
  };
}

/** Defaults for anything missing or malformed. Drops bad entries and keeps the newest 5 codes. */
export function parseCache(raw: string | null): CacheData {
  if (!raw) return empty();
  try {
    const data: unknown = JSON.parse(raw);
    if (!isObject(data) || data.version !== 1 || !isObject(data.entries)) return empty();
    const kept: [string, Cached][] = [];
    for (const [code, entry] of Object.entries(data.entries)) {
      if (!CODE.test(code) || !isObject(entry) || !isNumber(entry.at)) continue;
      const view = asView(entry.view);
      if (view) kept.push([code, { view, at: entry.at }]);
    }
    return { version: 1, entries: Object.fromEntries(kept.slice(-MAX_CODES)) };
  } catch {
    return empty();
  }
}

function load(): CacheData {
  try {
    return parseCache(localStorage.getItem(CACHE_KEY));
  } catch {
    return empty();
  }
}

export const readCached = (code: string): Cached | null => load().entries[code] ?? null;

/** Keeps the last good view for a code. A code written again counts as new, so the oldest codes go first. */
export function writeCached(code: string, view: AttendanceViewData, at: number): void {
  const data = load();
  delete data.entries[code];
  data.entries[code] = { view, at };
  data.entries = Object.fromEntries(Object.entries(data.entries).slice(-MAX_CODES));
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // Storage is blocked or full: the page works without an offline copy.
  }
}
```

Create `src/member/format.ts`:

```typescript
import type { AttendanceStatus, AttendanceViewData } from '../sync/attendance/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// A copy of the slot clock wording, so this page imports no store. The hour alone when there are no minutes.
const part = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return { text: m === 0 ? `${h % 12 || 12}` : `${h % 12 || 12}:${String(m).padStart(2, '0')}`, suffix: h % 24 < 12 ? 'am' : 'pm' };
};

/** "7 pm", "7:30 pm". */
export function clock12(min: number): string {
  const p = part(min);
  return `${p.text} ${p.suffix}`;
}

/** A calendar date as a UTC day, so no time zone can move it. */
function utcDay(playDate: string): Date | null {
  const m = DATE.exec(playDate);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

/** "Tue 10 Nov" from "2026-11-10". Text that is not a date comes back as it is. */
export function dateLabel(playDate: string): string {
  const d = utcDay(playDate);
  return d ? `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : playDate;
}

/** The same weekday a week later, as "2026-11-17". */
export function nextWeek(playDate: string): string {
  const d = utcDay(playDate);
  if (!d) return playDate;
  d.setUTCDate(d.getUTCDate() + 7);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function timeText(start: number | null, end: number | null): string | null {
  if (start !== null && end !== null) {
    const a = part(start);
    const b = part(end);
    return a.suffix === b.suffix ? `${a.text} to ${b.text} ${b.suffix}` : `${clock12(start)} to ${clock12(end)}`;
  }
  if (start !== null) return `from ${clock12(start)}`;
  if (end !== null) return `until ${clock12(end)}`;
  return null;
}

/** "Tue 10 Nov, 7 to 9 pm, Sample Hall". Parts that are missing are left out. */
export function whenLine(view: AttendanceViewData): string {
  return [dateLabel(view.play_date), timeText(view.start_min, view.end_min), view.venue?.trim() || null].filter(Boolean).join(', ');
}

export function statusLine(status: AttendanceStatus, date: string): string {
  if (status === 'in') return `You're in for ${date}.`;
  if (status === 'maybe') return `You're a maybe for ${date}. You can change this any time.`;
  return `You're out for ${date}.`;
}

/** People who are in (on the roster) plus friends. */
function headcount(view: AttendanceViewData): number {
  const ids = new Set(view.players.map((p) => p.id));
  return view.answers.filter((a) => a.status === 'in' && ids.has(a.player_id)).length + view.friends;
}

/** More than 4 for each court. Never when the courts are not known. */
export function isBusy(view: AttendanceViewData): boolean {
  return view.courts !== null && view.courts > 0 && headcount(view) > 4 * view.courts;
}

export function busyLine(view: AttendanceViewData): string | null {
  if (!isBusy(view)) return null;
  const courts = view.courts as number;
  return `Busy night: ${headcount(view)} in for ${courts} ${courts === 1 ? 'court' : 'courts'}. Expect to sit out a game now and then.`;
}
```

Create `src/member/ics.ts`:

```typescript
import type { AttendanceViewData } from '../sync/attendance/types';

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** The slug a title gives: lower case letters and digits joined by single dashes. */
const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'open-play';

const stamp = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const clock = (d: Date) => `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;

const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

const encoder = new TextEncoder();

/** Folds a line so no physical line is over 75 octets. Continuation lines start with one space. Never splits a character. */
function fold(line: string): string {
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (size + n > 75) {
      out.push(current);
      current = ' ';
      size = 1;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join('\r\n');
}

/**
 * The play date as a calendar file. Times are floating (no time zone), because the view has none: the event
 * lands on the same clock time wherever the phone is. `now` is only the time stamp the format asks for.
 */
export function calendarFile(view: AttendanceViewData, now: number = Date.now()): { name: string; text: string } {
  const [y, m, d] = view.play_date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  const props: string[] = [];
  if (view.start_min === null) {
    const next = new Date(day.getTime());
    next.setUTCDate(next.getUTCDate() + 1);
    props.push(`DTSTART;VALUE=DATE:${stamp(day)}`, `DTEND;VALUE=DATE:${stamp(next)}`);
  } else {
    const start = new Date(day.getTime() + view.start_min * 60_000);
    // Two hours when there is no end. An end that is not after the start means the next day.
    const endMin = view.end_min === null ? view.start_min + 120 : view.end_min > view.start_min ? view.end_min : view.end_min + 1440;
    const end = new Date(day.getTime() + endMin * 60_000);
    props.push(`DTSTART:${stamp(start)}T${clock(start)}`, `DTEND:${stamp(end)}T${clock(end)}`);
  }
  const venue = view.venue?.trim();
  const base = slug(view.title);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PIKLMatch//Attendance//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${view.play_date}-${base}@piklmatch`,
    `DTSTAMP:${stamp(new Date(now))}T${clock(new Date(now))}Z`,
    ...props,
    `SUMMARY:${escapeText(view.title)}`,
    ...(venue ? [`LOCATION:${escapeText(venue)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return { name: `${base}-${view.play_date}.ics`, text: lines.map(fold).join('\r\n') + '\r\n' };
}
```

Create `src/member/identity.ts`:

```typescript
export const IDENTITY_KEY = 'pikl.member.v1';

const MAX_CODES = 20;
const CODE = /^[A-Za-z0-9_-]+$/;

export interface Identity {
  version: 1;
  /** The player a member picked, by link code. Oldest first. */
  picks: Record<string, string>;
}

const empty = (): Identity => ({ version: 1, picks: {} });

/** Defaults for anything missing or malformed. Keeps the newest 20 codes. */
export function parseIdentity(raw: string | null): Identity {
  if (!raw) return empty();
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || (data as { version?: unknown }).version !== 1) return empty();
    const picks = (data as { picks?: unknown }).picks;
    if (typeof picks !== 'object' || picks === null || Array.isArray(picks)) return empty();
    const kept = Object.entries(picks).filter(
      (entry): entry is [string, string] => CODE.test(entry[0]) && typeof entry[1] === 'string' && entry[1] !== '' && entry[1].length <= 64,
    );
    return { version: 1, picks: Object.fromEntries(kept.slice(-MAX_CODES)) };
  } catch {
    return empty();
  }
}

function load(): Identity {
  try {
    return parseIdentity(localStorage.getItem(IDENTITY_KEY));
  } catch {
    return empty();
  }
}

function persist(identity: Identity): void {
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    // Storage is blocked or full: the pick holds until the page closes.
  }
}

export const readPick = (code: string): string | null => load().picks[code] ?? null;

/** Remembers the pick. A code saved again counts as new, so the oldest codes go first. */
export function savePick(code: string, playerId: string): void {
  const identity = load();
  delete identity.picks[code];
  identity.picks[code] = playerId;
  identity.picks = Object.fromEntries(Object.entries(identity.picks).slice(-MAX_CODES));
  persist(identity);
}

export function forgetPick(code: string): void {
  const identity = load();
  if (!(code in identity.picks)) return;
  delete identity.picks[code];
  persist(identity);
}
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/member/cache.test.ts src/member/format.test.ts src/member/ics.test.ts src/member/identity.test.ts`

Expected: it passes. Test Files `4 passed (4)`, Tests `120 passed (120)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 1975 tests across 142 files.

- [ ] **Step 5: Commit**

```bash
git add src/member/cache.test.ts src/member/format.test.ts src/member/ics.test.ts src/member/identity.test.ts src/member/cache.ts src/member/format.ts src/member/ics.ts src/member/identity.ts
git commit -m "Add the member helpers: remembered pick, offline copy, wording, dates and calendar file"
```

---

### Task 4: The hook behind the page

Everything the page does, in one hook: load, refresh every 30 seconds while visible and when the page becomes visible, pick and forget, answer (shown at once, then checked with the server), bring a friend, ask to join, retry, and the phases (loading, ready, not found, failed, unavailable). A late reply from an earlier request never changes the page.

**Files:**
- Create: `src/member/useMemberPage.ts`
- Create: `src/member/useMemberPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/member/useMemberPage.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceViewData } from '../sync/attendance/types';
import { CACHE_KEY, readCached, writeCached } from './cache';
import { IDENTITY_KEY, readPick, savePick } from './identity';
import { MemberError, type MemberReason, type MemberRemote } from './remote';
import { useMemberPage } from './useMemberPage';

const CODE = 'abc123';
const ANA = 'p-ana';
const BEN = 'p-ben';
const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);

const player = (id: string, first: string) => ({ id, first_name: first, last_initial: null, has_photo: false, photo_seq: 0 });
const VIEW: AttendanceViewData = {
  title: 'Tuesday open play',
  weekday: 2,
  venue: 'Sample Hall',
  start_min: 1140,
  end_min: 1260,
  courts: 3,
  play_date: '2026-11-10',
  cancelled: null,
  players: [player(ANA, 'Ana'), player(BEN, 'Ben')],
  answers: [{ player_id: BEN, status: 'maybe', late: false }],
  friends: 0,
};
const view = (patch: Partial<AttendanceViewData> = {}): AttendanceViewData => ({ ...VIEW, ...patch });

type Stub = { [K in keyof MemberRemote]: ReturnType<typeof vi.fn<MemberRemote[K]>> };
function makeRemote(data: AttendanceViewData | null = VIEW): Stub {
  return {
    view: vi.fn<MemberRemote['view']>(async () => data),
    answer: vi.fn<MemberRemote['answer']>(async () => undefined),
    addGuest: vi.fn<MemberRemote['addGuest']>(async () => undefined),
  };
}
const fails = (reason: MemberReason) => async () => {
  throw new MemberError(reason);
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
/** Lets a request that has already settled reach the hook. */
const settle = () => act(async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
});
async function mount(remote: MemberRemote | null, options: { strict?: boolean } = {}) {
  const hook = renderHook(() => useMemberPage(CODE, remote), options.strict ? { wrapper: StrictMode } : undefined);
  await settle();
  return hook;
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('phases', () => {
  it('is unavailable, and asks for nothing, when there is no backend', async () => {
    const { result } = await mount(null);
    expect(result.current.phase).toBe('unavailable');
    expect(result.current.view).toBeNull();
  });

  it('starts loading, then is ready with the view', async () => {
    const reply = deferred<AttendanceViewData | null>();
    const remote = makeRemote();
    remote.view.mockReturnValue(reply.promise);
    const { result } = renderHook(() => useMemberPage(CODE, remote));
    expect(result.current.phase).toBe('loading');
    expect(result.current.view).toBeNull();
    reply.resolve(VIEW);
    await settle();
    expect(result.current.phase).toBe('ready');
    expect(result.current.view).toEqual(VIEW);
    expect(result.current.stale).toBeNull();
    expect(result.current.error).toBeNull();
    expect(remote.view).toHaveBeenCalledWith(CODE);
  });

  it('is notfound for an unknown code', async () => {
    const { result } = await mount(makeRemote(null));
    expect(result.current.phase).toBe('notfound');
    expect(result.current.view).toBeNull();
  });

  it('is failed, with the reason, when the first request fails and there is no copy', async () => {
    const remote = makeRemote();
    remote.view.mockImplementation(fails('offline'));
    const { result } = await mount(remote);
    expect(result.current.phase).toBe('failed');
    expect(result.current.error).toBe('offline');
    expect(result.current.view).toBeNull();
  });

  it('says server for a server failure with no copy', async () => {
    const remote = makeRemote();
    remote.view.mockImplementation(fails('server'));
    const { result } = await mount(remote);
    expect(result.current.phase).toBe('failed');
    expect(result.current.error).toBe('server');
  });

  it('treats a failure that is not a MemberError as a server failure', async () => {
    const remote = makeRemote();
    remote.view.mockRejectedValue(new Error('boom'));
    const { result } = await mount(remote);
    expect(result.current.phase).toBe('failed');
    expect(result.current.error).toBe('server');
  });

  it('keeps a good copy of the view for next time', async () => {
    await mount(makeRemote());
    expect(readCached(CODE)).toEqual({ view: VIEW, at: NOW });
  });

  it('does not keep a copy of an unknown code', async () => {
    await mount(makeRemote(null));
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });
});

describe('the offline copy', () => {
  const CACHED_AT = NOW - 60_000;
  beforeEach(() => writeCached(CODE, view({ title: 'Cached play' }), CACHED_AT));

  it('shows the copy at once, with when it was updated', async () => {
    const reply = deferred<AttendanceViewData | null>();
    const remote = makeRemote();
    remote.view.mockReturnValue(reply.promise);
    const { result } = renderHook(() => useMemberPage(CODE, remote));
    expect(result.current.phase).toBe('ready');
    expect(result.current.view?.title).toBe('Cached play');
    expect(result.current.stale).toEqual({ at: CACHED_AT, offline: false });
  });

  it('replaces the copy when the refresh works, and the stale note goes', async () => {
    const { result } = await mount(makeRemote());
    expect(result.current.view?.title).toBe('Tuesday open play');
    expect(result.current.stale).toBeNull();
    expect(readCached(CODE)).toEqual({ view: VIEW, at: NOW });
  });

  it('keeps the copy, marked offline, when the refresh fails offline', async () => {
    const remote = makeRemote();
    remote.view.mockImplementation(fails('offline'));
    const { result } = await mount(remote);
    expect(result.current.phase).toBe('ready');
    expect(result.current.view?.title).toBe('Cached play');
    expect(result.current.stale).toEqual({ at: CACHED_AT, offline: true });
    expect(result.current.error).toBe('offline');
  });

  it('keeps the copy, not marked offline, when the refresh fails on the server', async () => {
    const remote = makeRemote();
    remote.view.mockImplementation(fails('server'));
    const { result } = await mount(remote);
    expect(result.current.phase).toBe('ready');
    expect(result.current.stale).toEqual({ at: CACHED_AT, offline: false });
    expect(result.current.error).toBe('server');
  });

  it('is notfound for a code the server no longer knows, even with a copy', async () => {
    const { result } = await mount(makeRemote(null));
    expect(result.current.phase).toBe('notfound');
  });

  it('dates a later failure from the last good refresh', async () => {
    const remote = makeRemote();
    const { result } = await mount(remote);
    vi.setSystemTime(NOW + 5 * 60_000);
    remote.view.mockImplementation(fails('offline'));
    await act(async () => {
      result.current.retry();
    });
    await settle();
    expect(result.current.stale).toEqual({ at: NOW, offline: true });
    expect(result.current.view?.title).toBe('Tuesday open play');
  });

  it('clears the stale note and the error when a later refresh works', async () => {
    const remote = makeRemote();
    remote.view.mockImplementationOnce(fails('offline'));
    const { result } = await mount(remote);
    expect(result.current.stale?.offline).toBe(true);
    await act(async () => {
      result.current.retry();
    });
    await settle();
    expect(result.current.stale).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

describe('retry', () => {
  it('asks again from the failed screen, shows loading, then the view', async () => {
    const remote = makeRemote();
    remote.view.mockImplementationOnce(fails('offline'));
    const { result } = await mount(remote);
    expect(result.current.phase).toBe('failed');
    const reply = deferred<AttendanceViewData | null>();
    remote.view.mockReturnValueOnce(reply.promise);
    await act(async () => {
      result.current.retry();
    });
    expect(result.current.phase).toBe('loading');
    expect(result.current.error).toBeNull();
    reply.resolve(VIEW);
    await settle();
    expect(result.current.phase).toBe('ready');
    expect(remote.view).toHaveBeenCalledTimes(2);
  });

  it('goes back to failed when it fails again', async () => {
    const remote = makeRemote();
    remote.view.mockImplementation(fails('server'));
    const { result } = await mount(remote);
    await act(async () => {
      result.current.retry();
    });
    await settle();
    expect(result.current.phase).toBe('failed');
    expect(result.current.error).toBe('server');
  });

  it('does nothing when there is no backend', async () => {
    const { result } = await mount(null);
    await act(async () => {
      result.current.retry();
    });
    expect(result.current.phase).toBe('unavailable');
  });
});

describe('picking a name', () => {
  it('starts with nobody picked', async () => {
    const { result } = await mount(makeRemote());
    expect(result.current.me).toBeNull();
  });

  it('picks a player on the roster and remembers it for this code', async () => {
    const { result } = await mount(makeRemote());
    act(() => result.current.pick(ANA));
    expect(result.current.me).toBe(ANA);
    expect(readPick(CODE)).toBe(ANA);
    expect(JSON.parse(localStorage.getItem(IDENTITY_KEY)!)).toEqual({ version: 1, picks: { [CODE]: ANA } });
  });

  it('ignores a pick that is not on the roster', async () => {
    const { result } = await mount(makeRemote());
    act(() => result.current.pick('stranger'));
    expect(result.current.me).toBeNull();
    expect(readPick(CODE)).toBeNull();
  });

  it('knows the remembered player on the next visit', async () => {
    savePick(CODE, ANA);
    const { result } = await mount(makeRemote());
    expect(result.current.me).toBe(ANA);
  });

  it('forgets a remembered player who is no longer on the roster', async () => {
    savePick(CODE, 'removed');
    const { result } = await mount(makeRemote());
    expect(result.current.me).toBeNull();
    expect(readPick(CODE)).toBeNull();
  });

  it('keeps the remembered player while only the offline copy is showing', async () => {
    writeCached(CODE, VIEW, NOW);
    savePick(CODE, ANA);
    const remote = makeRemote();
    remote.view.mockImplementation(fails('offline'));
    const { result } = await mount(remote);
    expect(result.current.me).toBe(ANA);
  });

  it('forgets who they are, for this code only', async () => {
    savePick(CODE, ANA);
    savePick('other', BEN);
    const { result } = await mount(makeRemote());
    act(() => result.current.forget());
    expect(result.current.me).toBeNull();
    expect(readPick(CODE)).toBeNull();
    expect(readPick('other')).toBe(BEN);
  });

  it('clears an old message when the pick changes', async () => {
    const remote = makeRemote();
    savePick(CODE, ANA);
    const { result } = await mount(remote);
    remote.answer.mockImplementation(fails('offline'));
    await act(async () => {
      await result.current.answer('in');
    });
    expect(result.current.message).not.toBeNull();
    act(() => result.current.forget());
    expect(result.current.message).toBeNull();
  });
});

describe('answering', () => {
  async function ready(remote: Stub = makeRemote()) {
    savePick(CODE, ANA);
    const hook = await mount(remote);
    return { ...hook, remote };
  }

  it.each(['in', 'maybe', 'out'] as const)('sends %s for the picked player', async (status) => {
    const { result, remote } = await ready();
    await act(async () => {
      await result.current.answer(status);
    });
    expect(remote.answer).toHaveBeenCalledWith(CODE, ANA, status, false);
  });

  it('sends the late flag with In', async () => {
    const { result, remote } = await ready();
    await act(async () => {
      await result.current.answer('in', true);
    });
    expect(remote.answer).toHaveBeenCalledWith(CODE, ANA, 'in', true);
  });

  it('never sends the late flag with Maybe or Out', async () => {
    const { result, remote } = await ready();
    await act(async () => {
      await result.current.answer('maybe', true);
      await result.current.answer('out', true);
    });
    expect(remote.answer).toHaveBeenNthCalledWith(1, CODE, ANA, 'maybe', false);
    expect(remote.answer).toHaveBeenNthCalledWith(2, CODE, ANA, 'out', false);
  });

  it('shows the new answer at once, and asks the server again', async () => {
    const { result, remote } = await ready();
    remote.view.mockResolvedValue(view({ answers: [{ player_id: BEN, status: 'maybe', late: false }, { player_id: ANA, status: 'in', late: true }] }));
    await act(async () => {
      await result.current.answer('in', true);
    });
    expect(remote.view).toHaveBeenCalledTimes(2);
    expect(result.current.view?.answers).toContainEqual({ player_id: ANA, status: 'in', late: true });
    expect(result.current.message).toBeNull();
  });

  it('shows the new answer even when the refresh after it fails', async () => {
    const { result, remote } = await ready();
    remote.view.mockImplementation(fails('offline'));
    await act(async () => {
      await result.current.answer('in', true);
    });
    expect(result.current.view?.answers).toContainEqual({ player_id: ANA, status: 'in', late: true });
    expect(result.current.stale?.offline).toBe(true);
  });

  it('replaces an earlier answer of the same player and leaves the others', async () => {
    const remote = makeRemote(view({ answers: [{ player_id: ANA, status: 'maybe', late: false }, { player_id: BEN, status: 'in', late: false }] }));
    const { result } = await ready(remote);
    remote.view.mockImplementation(fails('offline'));
    await act(async () => {
      await result.current.answer('out');
    });
    expect(result.current.view?.answers).toEqual([
      { player_id: BEN, status: 'in', late: false },
      { player_id: ANA, status: 'out', late: false },
    ]);
  });

  it('is busy while the answer is on its way', async () => {
    const { result, remote } = await ready();
    const reply = deferred<void>();
    remote.answer.mockReturnValue(reply.promise);
    let done!: Promise<void>;
    act(() => {
      done = result.current.answer('in');
    });
    expect(result.current.busy).toBe(true);
    reply.resolve();
    await act(async () => {
      await done;
    });
    expect(result.current.busy).toBe(false);
  });

  it('ignores a second answer while one is on its way', async () => {
    const { result, remote } = await ready();
    const reply = deferred<void>();
    remote.answer.mockReturnValue(reply.promise);
    act(() => {
      void result.current.answer('in');
    });
    await act(async () => {
      await result.current.answer('out');
    });
    expect(remote.answer).toHaveBeenCalledTimes(1);
    reply.resolve();
    await settle();
  });

  it('does nothing when nobody is picked', async () => {
    const remote = makeRemote();
    const { result } = await mount(remote);
    await act(async () => {
      await result.current.answer('in');
    });
    expect(remote.answer).not.toHaveBeenCalled();
  });

  it('does nothing on a cancelled date', async () => {
    const { result, remote } = await ready(makeRemote(view({ cancelled: { reason: 'Rain' } })));
    await act(async () => {
      await result.current.answer('in');
    });
    expect(remote.answer).not.toHaveBeenCalled();
  });

  it('changes nothing when offline, and says so', async () => {
    const { result, remote } = await ready();
    remote.answer.mockImplementation(fails('offline'));
    const before = result.current.view;
    await act(async () => {
      await result.current.answer('in', true);
    });
    expect(result.current.view).toBe(before);
    expect(result.current.view?.answers).toEqual(VIEW.answers);
    expect(result.current.message).toBe('No connection. Try again when you are online.');
    expect(result.current.busy).toBe(false);
    expect(result.current.phase).toBe('ready');
    expect(remote.view).toHaveBeenCalledTimes(1);
  });

  it('says something went wrong for a server failure, and changes nothing', async () => {
    const { result, remote } = await ready();
    remote.answer.mockImplementation(fails('server'));
    await act(async () => {
      await result.current.answer('in');
    });
    expect(result.current.message).toBe('Something went wrong. Try again.');
    expect(result.current.view?.answers).toEqual(VIEW.answers);
  });

  it('clears the message on the next answer that works', async () => {
    const { result, remote } = await ready();
    remote.answer.mockImplementationOnce(fails('offline'));
    await act(async () => {
      await result.current.answer('in');
    });
    expect(result.current.message).not.toBeNull();
    await act(async () => {
      await result.current.answer('in');
    });
    expect(result.current.message).toBeNull();
  });

  it('shows the cancelled week after a cancelled answer, with no error text', async () => {
    const { result, remote } = await ready();
    remote.answer.mockImplementation(fails('cancelled'));
    remote.view.mockResolvedValue(view({ cancelled: { reason: 'Rain' } }));
    await act(async () => {
      await result.current.answer('in');
    });
    expect(result.current.view?.cancelled).toEqual({ reason: 'Rain' });
    expect(result.current.message).toBeNull();
  });

  it('asks for the name again when the server no longer knows the player', async () => {
    const { result, remote } = await ready();
    remote.answer.mockImplementation(fails('unknown_player'));
    remote.view.mockResolvedValue(view({ players: [player(BEN, 'Ben')] }));
    await act(async () => {
      await result.current.answer('in');
    });
    expect(result.current.me).toBeNull();
    expect(readPick(CODE)).toBeNull();
  });

  it('is notfound when the link stopped working', async () => {
    const { result, remote } = await ready();
    remote.answer.mockImplementation(fails('unknown_link'));
    await act(async () => {
      await result.current.answer('in');
    });
    expect(result.current.phase).toBe('notfound');
  });

  it('says something went wrong for a status the server refused', async () => {
    const { result, remote } = await ready();
    remote.answer.mockImplementation(fails('bad_status'));
    await act(async () => {
      await result.current.answer('in');
    });
    expect(result.current.message).toBe('Something went wrong. Try again.');
  });
});

describe('friends and new names', () => {
  async function ready(remote: Stub = makeRemote()) {
    savePick(CODE, ANA);
    const hook = await mount(remote);
    return { ...hook, remote };
  }

  it('adds a friend for the picked player, with the name trimmed', async () => {
    const { result, remote } = await ready();
    let out: Awaited<ReturnType<typeof result.current.addFriend>> | undefined;
    await act(async () => {
      out = await result.current.addFriend('  Zed Zane ');
    });
    expect(remote.addGuest).toHaveBeenCalledWith(CODE, 'Zed Zane', ANA);
    expect(out).toEqual({ ok: true, message: 'Added for the organizer to confirm.' });
    expect(result.current.message).toBe('Added for the organizer to confirm.');
  });

  it('asks to join with nobody bringing them, and needs no pick', async () => {
    const remote = makeRemote();
    const { result } = await mount(remote);
    let out: Awaited<ReturnType<typeof result.current.askToJoin>> | undefined;
    await act(async () => {
      out = await result.current.askToJoin('Newbie');
    });
    expect(remote.addGuest).toHaveBeenCalledWith(CODE, 'Newbie', null);
    expect(out).toEqual({ ok: true, message: 'Thanks. The organizer will see your name.' });
  });

  it('asks again after a friend is added, so the friends count follows', async () => {
    const { result, remote } = await ready();
    remote.view.mockResolvedValue(view({ friends: 1 }));
    await act(async () => {
      await result.current.addFriend('Zed');
    });
    expect(result.current.view?.friends).toBe(1);
  });

  it('adds a friend only for a picked player', async () => {
    const remote = makeRemote();
    const { result } = await mount(remote);
    let out: Awaited<ReturnType<typeof result.current.addFriend>> | undefined;
    await act(async () => {
      out = await result.current.addFriend('Zed');
    });
    expect(remote.addGuest).not.toHaveBeenCalled();
    expect(out?.ok).toBe(false);
  });

  it.each([['empty', ''], ['blank', '   '], ['41 characters', 'x'.repeat(41)]])('refuses a %s name without asking the server', async (_n, name) => {
    const { result, remote } = await ready();
    let out: Awaited<ReturnType<typeof result.current.addFriend>> | undefined;
    await act(async () => {
      out = await result.current.addFriend(name);
    });
    expect(out).toEqual({ ok: false, reason: 'bad_name', message: 'Use 1 to 40 characters.' });
    expect(remote.addGuest).not.toHaveBeenCalled();
  });

  it('accepts 40 characters', async () => {
    const { result, remote } = await ready();
    await act(async () => {
      await result.current.askToJoin('x'.repeat(40));
    });
    expect(remote.addGuest).toHaveBeenCalledTimes(1);
  });

  it('counts the length after trimming', async () => {
    const { result, remote } = await ready();
    await act(async () => {
      await result.current.askToJoin(` ${'x'.repeat(40)} `);
    });
    expect(remote.addGuest).toHaveBeenCalledWith(CODE, 'x'.repeat(40), null);
  });

  it.each([
    ['too_many', 'The list of new names is full. Ask your organizer.'],
    ['bad_name', 'Use 1 to 40 characters.'],
    ['offline', 'No connection. Try again when you are online.'],
    ['server', 'Something went wrong. Try again.'],
  ] as const)('says the right thing for %s', async (reason, text) => {
    const { result, remote } = await ready();
    remote.addGuest.mockImplementation(fails(reason));
    let out: Awaited<ReturnType<typeof result.current.askToJoin>> | undefined;
    await act(async () => {
      out = await result.current.askToJoin('Newbie');
    });
    expect(out).toEqual({ ok: false, reason, message: text });
    expect(result.current.message).toBe(text);
    expect(result.current.busy).toBe(false);
  });

  it('shows the cancelled week after a cancelled name', async () => {
    const { result, remote } = await ready();
    remote.addGuest.mockImplementation(fails('cancelled'));
    remote.view.mockResolvedValue(view({ cancelled: { reason: null } }));
    let out: Awaited<ReturnType<typeof result.current.askToJoin>> | undefined;
    await act(async () => {
      out = await result.current.askToJoin('Newbie');
    });
    expect(result.current.view?.cancelled).toEqual({ reason: null });
    expect(out).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(result.current.message).toBeNull();
  });

  it('is notfound when the link stopped working', async () => {
    const { result, remote } = await ready();
    remote.addGuest.mockImplementation(fails('unknown_link'));
    await act(async () => {
      await result.current.askToJoin('Newbie');
    });
    expect(result.current.phase).toBe('notfound');
  });

  it('asks for the name again when the player who brings a friend is gone', async () => {
    const { result, remote } = await ready();
    remote.addGuest.mockImplementation(fails('unknown_player'));
    remote.view.mockResolvedValue(view({ players: [player(BEN, 'Ben')] }));
    await act(async () => {
      await result.current.addFriend('Zed');
    });
    expect(result.current.me).toBeNull();
    expect(readPick(CODE)).toBeNull();
  });

  it('is busy while a name is on its way', async () => {
    const { result, remote } = await ready();
    const reply = deferred<void>();
    remote.addGuest.mockReturnValue(reply.promise);
    let done!: Promise<unknown>;
    act(() => {
      done = result.current.askToJoin('Newbie');
    });
    expect(result.current.busy).toBe(true);
    reply.resolve();
    await act(async () => {
      await done;
    });
    expect(result.current.busy).toBe(false);
  });
});

describe('refreshing', () => {
  const visible = (state: 'visible' | 'hidden') => vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  beforeEach(() => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
  });

  const tick = (ms: number) => act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

  it('asks again every 30 seconds while the page is visible', async () => {
    visible('visible');
    const remote = makeRemote();
    await mount(remote);
    expect(remote.view).toHaveBeenCalledTimes(1);
    await tick(29_999);
    expect(remote.view).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(remote.view).toHaveBeenCalledTimes(2);
    await tick(30_000);
    expect(remote.view).toHaveBeenCalledTimes(3);
  });

  it('does not ask while the page is hidden', async () => {
    visible('hidden');
    const remote = makeRemote();
    await mount(remote);
    const before = remote.view.mock.calls.length;
    await tick(90_000);
    expect(remote.view).toHaveBeenCalledTimes(before);
  });

  it('asks when the page becomes visible', async () => {
    const state = visible('hidden');
    const remote = makeRemote();
    await mount(remote);
    const before = remote.view.mock.calls.length;
    state.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(remote.view).toHaveBeenCalledTimes(before + 1);
  });

  it('does not ask when the page becomes hidden', async () => {
    const state = visible('visible');
    const remote = makeRemote();
    await mount(remote);
    state.mockReturnValue('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(remote.view).toHaveBeenCalledTimes(1);
  });

  it('stops asking, and stops listening, when the page closes', async () => {
    visible('visible');
    const remote = makeRemote();
    const { unmount } = await mount(remote);
    unmount();
    await tick(120_000);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(remote.view).toHaveBeenCalledTimes(1);
  });

  it('keeps the view when a poll fails, and marks it stale', async () => {
    visible('visible');
    const remote = makeRemote();
    const { result } = await mount(remote);
    remote.view.mockImplementation(fails('offline'));
    await tick(30_000);
    expect(result.current.view).toEqual(VIEW);
    expect(result.current.stale).toEqual({ at: NOW, offline: true });
  });

  it('shows a new view from a poll', async () => {
    visible('visible');
    const remote = makeRemote();
    const { result } = await mount(remote);
    remote.view.mockResolvedValue(view({ friends: 3 }));
    await tick(30_000);
    expect(result.current.view?.friends).toBe(3);
  });

  it('does not keep asking for a code that does not exist', async () => {
    visible('visible');
    const remote = makeRemote(null);
    await mount(remote);
    await tick(120_000);
    expect(remote.view).toHaveBeenCalledTimes(1);
  });

  it('does not ask at all when there is no backend', async () => {
    visible('visible');
    const { result } = await mount(null);
    await tick(60_000);
    expect(result.current.phase).toBe('unavailable');
  });
});

describe('a late reply from an earlier request', () => {
  it('is ignored when a newer request has already answered (the double effect run)', async () => {
    const first = deferred<AttendanceViewData | null>();
    const second = deferred<AttendanceViewData | null>();
    const remote = makeRemote();
    remote.view.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useMemberPage(CODE, remote), { wrapper: StrictMode });
    expect(remote.view).toHaveBeenCalledTimes(2);
    second.resolve(view({ title: 'Newer' }));
    await settle();
    expect(result.current.view?.title).toBe('Newer');
    first.resolve(view({ title: 'Older' }));
    await settle();
    expect(result.current.view?.title).toBe('Newer');
    expect(readCached(CODE)?.view.title).toBe('Newer');
  });

  it('is ignored when it arrives first, and the newer reply still counts', async () => {
    const first = deferred<AttendanceViewData | null>();
    const second = deferred<AttendanceViewData | null>();
    const remote = makeRemote();
    remote.view.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useMemberPage(CODE, remote), { wrapper: StrictMode });
    first.resolve(view({ title: 'Older' }));
    await settle();
    expect(result.current.phase).toBe('loading');
    second.resolve(view({ title: 'Newer' }));
    await settle();
    expect(result.current.phase).toBe('ready');
    expect(result.current.view?.title).toBe('Newer');
  });

  it('is ignored when an earlier request fails late', async () => {
    const first = deferred<AttendanceViewData | null>();
    const second = deferred<AttendanceViewData | null>();
    const remote = makeRemote();
    remote.view.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useMemberPage(CODE, remote), { wrapper: StrictMode });
    second.resolve(VIEW);
    await settle();
    first.reject(new MemberError('offline'));
    await settle();
    expect(result.current.phase).toBe('ready');
    expect(result.current.stale).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('is ignored when it comes after the page closed', async () => {
    const reply = deferred<AttendanceViewData | null>();
    const remote = makeRemote();
    remote.view.mockReturnValue(reply.promise);
    const { unmount } = renderHook(() => useMemberPage(CODE, remote));
    unmount();
    reply.resolve(VIEW);
    await settle();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it('is ignored when a poll answers after a newer answer-refresh', async () => {
    savePick(CODE, ANA);
    const remote = makeRemote();
    const { result } = await mount(remote);
    const slow = deferred<AttendanceViewData | null>();
    remote.view.mockReturnValueOnce(slow.promise);
    await act(async () => {
      result.current.retry();
    });
    remote.view.mockResolvedValue(view({ friends: 2 }));
    await act(async () => {
      await result.current.answer('in');
    });
    expect(result.current.view?.friends).toBe(2);
    slow.resolve(view({ friends: 99 }));
    await settle();
    expect(result.current.view?.friends).toBe(2);
  });
});

describe('the double effect run', () => {
  it('ends with a ready view and one remembered pick', async () => {
    savePick(CODE, ANA);
    const { result } = await mount(makeRemote(), { strict: true });
    expect(result.current.phase).toBe('ready');
    expect(result.current.me).toBe(ANA);
  });
});

describe('what the hook imports', () => {
  const sources = import.meta.glob('./*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const DENIED = [
    'ui/App',
    'ui/HomeScreen',
    'ui/AttendanceCard',
    'ui/useAttendance',
    'sync/attendance/start',
    'sync/attendance/store',
    'sync/coordinator',
    'sync/auth',
    'store/rosterStore',
    'store/sessionStore',
    'store/slots',
    'ui/ErrorBoundary',
  ];
  const specifiers = (text: string) => [...text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const resolve = (spec: string) => {
    if (!spec.startsWith('.')) return spec;
    const parts = ['member'];
    for (const piece of spec.split('/')) {
      if (piece === '..') parts.pop();
      else if (piece !== '.') parts.push(piece);
    }
    return parts.join('/').replace(/\/index$/, '');
  };

  it('imports none of the app, the stores or the sync engine', () => {
    const files = Object.entries(sources).filter(([name]) => !/\.test\.tsx?$/.test(name) && !name.includes('fakeRemote'));
    expect(files.map(([name]) => name)).toContain('./useMemberPage.ts');
    for (const [name, text] of files) {
      for (const spec of specifiers(text)) expect([name, DENIED.includes(resolve(spec))]).toEqual([name, false]);
    }
  });

  it('reads the specifiers it should', () => {
    expect(specifiers(sources['./useMemberPage.ts'])).toContain('react');
    expect(specifiers("import x from '../ui/App';")).toEqual(['../ui/App']);
    expect(resolve('../ui/App')).toBe('ui/App');
    expect(resolve('./remote')).toBe('member/remote');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/member/useMemberPage.test.tsx`

Expected: it fails. Test Files `1 failed (1)`, Tests `no tests`.

- [ ] **Step 3: Write the code**

Create `src/member/useMemberPage.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttendanceStatus, AttendanceViewData } from '../sync/attendance/types';
import { readCached, writeCached } from './cache';
import { forgetPick, readPick, savePick } from './identity';
import { isMemberError, type MemberReason, type MemberRemote } from './remote';

export type MemberPhase = 'loading' | 'ready' | 'notfound' | 'failed' | 'unavailable';

/** What a sheet gets back: the words to show, and for a failure its reason. */
export type ActionResult = { ok: true; message: string } | { ok: false; reason: MemberReason; message: string };

export interface MemberPageState {
  phase: MemberPhase;
  view: AttendanceViewData | null;
  /** Set while the view on screen is older than the server: when it was fetched, and whether the failure was offline. */
  stale: { at: number; offline: boolean } | null;
  /** Why the last request failed, until one works. */
  error: MemberReason | null;
  /** The player this member picked, or null. */
  me: string | null;
  busy: boolean;
  /** The words for the last answer or name that went wrong or right. */
  message: string | null;
}

export interface MemberPage extends MemberPageState {
  pick(playerId: string): void;
  forget(): void;
  answer(status: AttendanceStatus, late?: boolean): Promise<void>;
  addFriend(name: string): Promise<ActionResult>;
  askToJoin(name: string): Promise<ActionResult>;
  retry(): void;
}

const POLL_MS = 30_000;
const OFFLINE = 'No connection. Try again when you are online.';
const GENERIC = 'Something went wrong. Try again.';
const FRIEND_ADDED = 'Added for the organizer to confirm.';
const ASKED = 'Thanks. The organizer will see your name.';
const BAD_NAME = 'Use 1 to 40 characters.';
const TOO_MANY = 'The list of new names is full. Ask your organizer.';
const PICK_FIRST = 'Pick your name first.';

const reasonOf = (error: unknown): MemberReason => (isMemberError(error) ? error.reason : 'server');

/** The words for a failed answer or name. Null for a reason the page shows by itself (a cancelled week, a dead link). */
function wordsFor(reason: MemberReason): string | null {
  if (reason === 'offline') return OFFLINE;
  if (reason === 'too_many') return TOO_MANY;
  if (reason === 'bad_name') return BAD_NAME;
  if (reason === 'cancelled' || reason === 'unknown_link') return null;
  return GENERIC;
}

/** The view with one player's answer replaced. */
function withAnswer(view: AttendanceViewData, playerId: string, status: AttendanceStatus, late: boolean): AttendanceViewData {
  return { ...view, answers: [...view.answers.filter((a) => a.player_id !== playerId), { player_id: playerId, status, late }] };
}

function initial(code: string, remote: MemberRemote | null): MemberPageState {
  const base = { error: null, me: readPick(code), busy: false, message: null };
  if (!remote) return { ...base, phase: 'unavailable', view: null, stale: null };
  const cached = readCached(code);
  if (cached) return { ...base, phase: 'ready', view: cached.view, stale: { at: cached.at, offline: false } };
  return { ...base, phase: 'loading', view: null, stale: null };
}

/**
 * Everything the member page does. `code` does not change over the life of the page. `remote` is null in a build
 * with no backend. Nothing is guessed: a view only changes when the server (or an accepted answer) says so.
 */
export function useMemberPage(code: string, remote: MemberRemote | null): MemberPage {
  const [state, setState] = useState<MemberPageState>(() => initial(code, remote));
  const ref = useRef(state);
  // Each request takes a number. Only the newest may change the page, so a slow earlier reply is ignored.
  const latest = useRef(0);
  // When the view on screen was fetched.
  const fetchedAt = useRef<number>(readCached(code)?.at ?? 0);

  const update = useCallback((patch: Partial<MemberPageState>) => {
    ref.current = { ...ref.current, ...patch };
    setState(ref.current);
  }, []);

  const refresh = useCallback(async () => {
    if (!remote) return;
    const mine = ++latest.current;
    try {
      const data = await remote.view(code);
      if (mine !== latest.current) return;
      if (!data) {
        update({ phase: 'notfound', view: null, stale: null, error: null });
        return;
      }
      fetchedAt.current = Date.now();
      writeCached(code, data, fetchedAt.current);
      // A remembered player who is no longer on the roster is dropped.
      const me = ref.current.me;
      const gone = me !== null && !data.players.some((p) => p.id === me);
      if (gone) forgetPick(code);
      update({ phase: 'ready', view: data, stale: null, error: null, me: gone ? null : me });
    } catch (error) {
      if (mine !== latest.current) return;
      const reason = reasonOf(error);
      if (reason === 'unknown_link') update({ phase: 'notfound', view: null, stale: null, error: null });
      else if (ref.current.view) update({ phase: 'ready', stale: { at: fetchedAt.current, offline: reason === 'offline' }, error: reason });
      else update({ phase: 'failed', error: reason });
    }
  }, [code, remote, update]);

  useEffect(() => {
    if (!remote) return;
    void refresh();
    const visible = () => document.visibilityState === 'visible' && ref.current.phase !== 'notfound';
    const timer = setInterval(() => {
      if (visible()) void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (visible()) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      // Whatever is still on its way no longer counts.
      latest.current += 1;
    };
  }, [remote, refresh]);

  const retry = useCallback(() => {
    if (!remote) return;
    if (!ref.current.view) update({ phase: 'loading', error: null });
    void refresh();
  }, [remote, refresh, update]);

  const pick = useCallback(
    (playerId: string) => {
      if (!ref.current.view?.players.some((p) => p.id === playerId)) return;
      savePick(code, playerId);
      update({ me: playerId, message: null });
    },
    [code, update],
  );

  const forget = useCallback(() => {
    forgetPick(code);
    update({ me: null, message: null });
  }, [code, update]);

  /** What every failed answer or name does to the page. Returns the words to show, or null. */
  const settleFailure = useCallback(
    async (reason: MemberReason): Promise<string | null> => {
      if (reason === 'unknown_link') update({ phase: 'notfound', view: null, stale: null, error: null });
      else if (reason === 'cancelled') await refresh();
      else if (reason === 'unknown_player') {
        forgetPick(code);
        update({ me: null });
        await refresh();
      }
      return wordsFor(reason);
    },
    [code, refresh, update],
  );

  const answer = useCallback(
    async (status: AttendanceStatus, late = false) => {
      const { me, view, busy } = ref.current;
      if (!remote || !me || !view || view.cancelled || busy) return;
      const isLate = status === 'in' && late;
      update({ busy: true, message: null });
      try {
        await remote.answer(code, me, status, isLate);
      } catch (error) {
        const message = await settleFailure(reasonOf(error));
        update({ busy: false, message });
        return;
      }
      // Show the answer now, then check with the server.
      if (ref.current.view) update({ view: withAnswer(ref.current.view, me, status, isLate) });
      await refresh();
      update({ busy: false });
    },
    [code, remote, refresh, settleFailure, update],
  );

  const submitName = useCallback(
    async (name: string, broughtBy: string | null, done: string): Promise<ActionResult> => {
      const clean = name.trim();
      if (clean.length < 1 || clean.length > 40) {
        update({ message: BAD_NAME });
        return { ok: false, reason: 'bad_name', message: BAD_NAME };
      }
      if (!remote || ref.current.busy) return { ok: false, reason: 'server', message: GENERIC };
      update({ busy: true, message: null });
      try {
        await remote.addGuest(code, clean, broughtBy);
      } catch (error) {
        const reason = reasonOf(error);
        const message = await settleFailure(reason);
        update({ busy: false, message });
        return { ok: false, reason, message: message ?? '' };
      }
      update({ message: done });
      await refresh();
      update({ busy: false });
      return { ok: true, message: done };
    },
    [code, remote, refresh, settleFailure, update],
  );

  const addFriend = useCallback(
    (name: string): Promise<ActionResult> => {
      const me = ref.current.me;
      if (!me) return Promise.resolve({ ok: false, reason: 'unknown_player', message: PICK_FIRST });
      return submitName(name, me, FRIEND_ADDED);
    },
    [submitName],
  );

  const askToJoin = useCallback((name: string) => submitName(name, null, ASKED), [submitName]);

  return { ...state, pick, forget, answer, addFriend, askToJoin, retry };
}
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/member/useMemberPage.test.tsx`

Expected: it passes. Test Files `1 passed (1)`, Tests `79 passed (79)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 2054 tests across 143 files.

- [ ] **Step 5: Commit**

```bash
git add src/member/useMemberPage.test.tsx src/member/useMemberPage.ts
git commit -m "Add the hook behind the member page"
```

---

### Task 5: Cover the gaps the first break-it-on-purpose run found (data layer)

Tests only, added after deliberate breaks to Tasks 1 to 4 got through. They pass on the code from Tasks 1 to 4.

**Files:**
- Modify: `src/member/cache.test.ts`
- Create: `src/member/fakeRemote.test.ts`
- Modify: `src/member/remote.wire.test.ts`
- Modify: `src/member/useMemberPage.test.tsx`

- [ ] **Step 1: Add the tests**

Apply this patch to `src/member/cache.test.ts`:

```diff
diff --git a/src/member/cache.test.ts b/src/member/cache.test.ts
index cccbae0..14bb824 100644
--- a/src/member/cache.test.ts
+++ b/src/member/cache.test.ts
@@ -158,4 +158,26 @@ describe('parseCache', () => {
     expect(out).toEqual(view());
     expect(out).not.toHaveProperty('ownerId');
   });
+
+  it('keeps an answer of every status', () => {
+    const v = { ...view(), answers: [{ player_id: 'p1', status: 'out', late: false }, { player_id: 'p2', status: 'maybe', late: false }] };
+    expect(parseCache(JSON.stringify({ version: 1, entries: { abc: { view: v, at: 5 } } })).entries.abc.view.answers).toEqual(v.answers);
+  });
+
+  it('drops an empty code', () => {
+    expect(parseCache(JSON.stringify({ version: 1, entries: { '': { view: view(), at: 5 } } })).entries).toEqual({});
+  });
+
+  it('keeps only the known fields of a player, so a full name is never stored', () => {
+    const v = { ...view(), players: [{ id: 'p1', first_name: 'Ana', last_initial: 'R', has_photo: false, photo_seq: 0, name: 'Ana Reyes', owner_id: 'x' }] };
+    const out = parseCache(JSON.stringify({ version: 1, entries: { abc: { view: v, at: 5 } } })).entries.abc.view.players[0];
+    expect(out).toEqual({ id: 'p1', first_name: 'Ana', last_initial: 'R', has_photo: false, photo_seq: 0 });
+    expect(out).not.toHaveProperty('name');
+  });
+
+  it('keeps only the known fields of an answer', () => {
+    const v = { ...view(), answers: [{ player_id: 'p1', status: 'in', late: false, note: 'x' }] };
+    expect(parseCache(JSON.stringify({ version: 1, entries: { abc: { view: v, at: 5 } } })).entries.abc.view.answers[0]).toEqual({ player_id: 'p1', status: 'in', late: false });
+  });
 });
+
```

Create `src/member/fakeRemote.test.ts`:

```typescript
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A } from '../sync/db/harness';

const callers: unknown[] = [];
vi.mock('../sync/db/harness', async (importOriginal) => {
  const real = await importOriginal<typeof import('../sync/db/harness')>();
  return {
    ...real,
    run: (db: PGlite, caller: Parameters<typeof real.run>[1], sql: string, params?: unknown[]) => {
      callers.push(caller);
      return real.run(db, caller, sql, params);
    },
  };
});

const { createDb } = await import('../sync/db/harness');
const { fakeMemberRemote } = await import('./fakeRemote');

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
  await db.exec(`insert into public.attendance_links (owner_id, slot_id, code, title, weekday) values ('${USER_A}', 'tue', 'abcdef0123456789abcdef01', 'Tuesday open play', 2)`);
});
afterAll(async () => {
  await db.close();
});

describe('fakeMemberRemote', () => {
  it('runs every call as the anonymous role', async () => {
    const remote = fakeMemberRemote(db);
    await remote.view('abcdef0123456789abcdef01');
    await remote.answer('abcdef0123456789abcdef01', '99999999-9999-4999-8999-999999999999', 'in', false).catch(() => undefined);
    await remote.addGuest('abcdef0123456789abcdef01', 'Zed', null);
    expect(callers).toEqual(['anon', 'anon', 'anon']);
  });
});
```

Apply this patch to `src/member/remote.wire.test.ts`:

```diff
diff --git a/src/member/remote.wire.test.ts b/src/member/remote.wire.test.ts
index 0351e92..b9308c6 100644
--- a/src/member/remote.wire.test.ts
+++ b/src/member/remote.wire.test.ts
@@ -1,7 +1,7 @@
 // @vitest-environment node
 import { createClient } from '@supabase/supabase-js';
 import { beforeEach, describe, expect, it } from 'vitest';
-import { isMemberError, supabaseMemberRemote, type MemberReason } from './remote';
+import { MemberError, isMemberError, memberFailure, supabaseMemberRemote, type MemberReason } from './remote';
 
 const ANA = '11111111-1111-4111-8111-111111111111';
 const KEY = 'sb_publishable_test';
@@ -173,3 +173,46 @@ describe('what the member remote makes of a failure', () => {
     expect((error as Error).message).toBe('Member request failed (unknown_link)');
   });
 });
+
+describe('memberFailure', () => {
+  it('says offline for status 0 whatever the text, from the argument or from the error', () => {
+    expect(memberFailure({ message: 'boom' }, 0).reason).toBe('offline');
+    expect(memberFailure({ message: 'boom', status: 0 }).reason).toBe('offline');
+  });
+
+  it('says offline for each kind of network text', () => {
+    for (const message of ['TypeError: Failed to fetch', 'NetworkError when attempting to fetch resource.', 'TypeError: Load failed', 'TypeError: fetch failed']) {
+      expect(memberFailure({ message }, 500).reason).toBe('offline');
+    }
+  });
+
+  it('says server for any other status and text', () => {
+    expect(memberFailure({ message: 'boom' }, 500).reason).toBe('server');
+    expect(memberFailure({ message: 'boom', status: 502 }).reason).toBe('server');
+    expect(memberFailure({}).reason).toBe('server');
+  });
+
+  it('keeps a reason only for the database code with an exact word', () => {
+    expect(memberFailure({ code: 'P0001', message: 'too_many' }, 400).reason).toBe('too_many');
+    expect(memberFailure({ code: 'P0001', message: 'too_many ' }, 400).reason).toBe('server');
+    expect(memberFailure({ code: 'P0001', message: 'Too_Many' }, 400).reason).toBe('server');
+  });
+});
+
+describe('isMemberError', () => {
+  it('is true for a MemberError only', () => {
+    expect(isMemberError(new MemberError('server'))).toBe(true);
+    expect(isMemberError(new Error('x'))).toBe(false);
+    expect(isMemberError(Object.assign(new Error('x'), { reason: 'server' }))).toBe(false);
+    expect(isMemberError({ name: 'MemberError', reason: 'server' })).toBe(false);
+    expect(isMemberError(null)).toBe(false);
+    expect(isMemberError('server')).toBe(false);
+  });
+});
+
+describe('a view that comes back with no data', () => {
+  it('is null', async () => {
+    const client = { rpc: async () => ({ data: undefined, error: null, status: 200 }) } as unknown as Parameters<typeof supabaseMemberRemote>[0];
+    expect(await supabaseMemberRemote(client).view('abc')).toBeNull();
+  });
+});
```

Apply this patch to `src/member/useMemberPage.test.tsx`:

```diff
diff --git a/src/member/useMemberPage.test.tsx b/src/member/useMemberPage.test.tsx
index c006735..3ad47ce 100644
--- a/src/member/useMemberPage.test.tsx
+++ b/src/member/useMemberPage.test.tsx
@@ -114,6 +114,15 @@ describe('phases', () => {
     expect(result.current.error).toBe('server');
   });
 
+  it('is notfound when the refresh says the link is unknown, even with a copy', async () => {
+    writeCached(CODE, VIEW, NOW);
+    const remote = makeRemote();
+    remote.view.mockImplementation(fails('unknown_link'));
+    const { result } = await mount(remote);
+    expect(result.current.phase).toBe('notfound');
+    expect(result.current.view).toBeNull();
+  });
+
   it('treats a failure that is not a MemberError as a server failure', async () => {
     const remote = makeRemote();
     remote.view.mockRejectedValue(new Error('boom'));
@@ -236,6 +245,20 @@ describe('retry', () => {
     expect(result.current.error).toBe('server');
   });
 
+  it('keeps showing the view while it asks again', async () => {
+    const remote = makeRemote();
+    const { result } = await mount(remote);
+    const reply = deferred<AttendanceViewData | null>();
+    remote.view.mockReturnValueOnce(reply.promise);
+    await act(async () => {
+      result.current.retry();
+    });
+    expect(result.current.phase).toBe('ready');
+    expect(result.current.view).toEqual(VIEW);
+    reply.resolve(VIEW);
+    await settle();
+  });
+
   it('does nothing when there is no backend', async () => {
     const { result } = await mount(null);
     await act(async () => {
```

- [ ] **Step 2: Run them, then the whole project**

Run: `npx vitest run src/member/cache.test.ts src/member/fakeRemote.test.ts src/member/remote.wire.test.ts src/member/useMemberPage.test.tsx`

Expected: it passes. Test Files `4 passed (4)`, Tests `146 passed (146)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 2067 tests across 144 files.

- [ ] **Step 3: Commit**

```bash
git add src/member/cache.test.ts src/member/fakeRemote.test.ts src/member/remote.wire.test.ts src/member/useMemberPage.test.tsx
git commit -m "Cover a gap found by the mutation check"
```

---

### Task 6: The styles and the coloured name circle

The `/* Member page */` section of `app.css`, placed just before the Board section (a Board test forbids the app colour variables after `/* Board */`), the coloured initials circle (the same colour values the Board proved readable for every hue), and the tests that keep the styles honest. `cssBalance.test.ts` now also checks the new section starts at the top level.

**Files:**
- Create: `src/member/MemberTile.tsx`
- Modify: `src/styles/app.css`
- Create: `src/member/MemberTile.test.tsx`
- Modify: `src/ui/attendanceCss.test.ts`
- Modify: `src/ui/cssBalance.test.ts`
- Create: `src/ui/memberCss.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/member/MemberTile.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { nameHue } from '../store/boardInfo';
import { MemberTile } from './MemberTile';

describe('MemberTile', () => {
  it('shows the initials of the name', () => {
    const { container } = render(<MemberTile name="Ana" />);
    expect(container.firstElementChild).toHaveTextContent('AN');
  });

  it('uses two letters from a name with a last initial: first and last', () => {
    const { container } = render(<MemberTile name="Ben C." />);
    expect(container.firstElementChild).toHaveTextContent('BC');
  });

  it('is hidden from screen readers, because the parent shows the name', () => {
    const { container } = render(<MemberTile name="Ana" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('takes its colour from the name', () => {
    const { container } = render(<MemberTile name="Ana" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue('--h')).toBe(String(nameHue('Ana')));
    const other = render(<MemberTile name="Zed" />).container.firstElementChild as HTMLElement;
    expect(other.style.getPropertyValue('--h')).toBe(String(nameHue('Zed')));
  });

  it('is the medium size by default and the small size when asked', () => {
    const md = render(<MemberTile name="Ana" />).container.firstElementChild;
    expect(md).toHaveClass('member-tile', 'member-tile-md');
    const sm = render(<MemberTile name="Ana" size="sm" />).container.firstElementChild;
    expect(sm).toHaveClass('member-tile', 'member-tile-sm');
    expect(sm).not.toHaveClass('member-tile-md');
  });
});
```

Apply this patch to `src/ui/attendanceCss.test.ts`:

```diff
diff --git a/src/ui/attendanceCss.test.ts b/src/ui/attendanceCss.test.ts
index e3be27a..38e9aac 100644
--- a/src/ui/attendanceCss.test.ts
+++ b/src/ui/attendanceCss.test.ts
@@ -1,9 +1,9 @@
 import { describe, expect, it } from 'vitest';
 import css from '../styles/app.css?raw';
 
-// The board section runs to the end of the file and bans the app variables, so this one sits just before it.
+// The member page section follows this one, then the board, which runs to the end of the file and bans the app variables.
 const START = css.indexOf('/* Attendance card */');
-const END = css.indexOf('/* Board */');
+const END = css.indexOf('/* Member page */');
 const section = START >= 0 ? css.slice(START, END) : '';
 
 /** The declarations of the first rule in the attendance section whose selector is exactly this one. */
```

Apply this patch to `src/ui/cssBalance.test.ts`:

```diff
diff --git a/src/ui/cssBalance.test.ts b/src/ui/cssBalance.test.ts
index 766c508..324674a 100644
--- a/src/ui/cssBalance.test.ts
+++ b/src/ui/cssBalance.test.ts
@@ -44,7 +44,7 @@ describe('the stylesheets', () => {
     const css = sheets['../styles/app.css'];
     const { atLine } = depths(css);
     const lines = css.split('\n');
-    const named = ['/* Home */', '/* Attendance card */', '/* Board */'];
+    const named = ['/* Home */', '/* Attendance card */', '/* Member page */', '/* Board */'];
     for (const marker of named) {
       const i = lines.findIndex((l) => l.startsWith(marker));
       expect(i, `${marker} is in app.css`).toBeGreaterThanOrEqual(0);
```

Create `src/ui/memberCss.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import css from '../styles/app.css?raw';
import { nameHue } from '../store/boardInfo';

// The board section runs to the end of the file and bans the app variables, so this one sits just before it.
const START = css.indexOf('/* Member page */');
const END = css.indexOf('/* Board */');
const section = START >= 0 ? css.slice(START, END) : '';

/** The declarations of the first rule in the member section whose selector is exactly this one. */
function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(section);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

describe('Member page styles', () => {
  it('is its own section, after the attendance card and before the board', () => {
    expect(START).toBeGreaterThan(0);
    expect(css.indexOf('/* Member page */', START + 1)).toBe(-1);
    expect(css.indexOf('/* Attendance card */')).toBeGreaterThan(0);
    expect(css.indexOf('/* Attendance card */')).toBeLessThan(START);
    expect(END).toBeGreaterThan(START);
    expect(section.length).toBeGreaterThan(500);
  });

  it('keeps every button at 44 px or more', () => {
    for (const sel of ['.member-pick', '.member-link', '.member-answer', '.member-chip', '.member-calendar', '.member-submit', '.member-retry']) {
      expect(rule(sel), sel).toMatch(/min-height:\s*(44|[5-9]\d)px/);
    }
  });

  it('keeps every field at 44 px or more and 16 px type or more, so a phone does not zoom', () => {
    for (const sel of ['.member-search', '.member-input']) {
      expect(rule(sel), sel).toMatch(/min-height:\s*44px/);
      const size = /font-size:\s*(\d+)px/.exec(rule(sel));
      expect(size, sel).not.toBeNull();
      expect(Number(size![1]), sel).toBeGreaterThanOrEqual(16);
    }
  });

  it('draws the circles at 38 and 56 px', () => {
    expect(rule('.member-tile-sm')).toMatch(/width:\s*38px/);
    expect(rule('.member-tile-sm')).toMatch(/height:\s*38px/);
    expect(rule('.member-tile-md')).toMatch(/width:\s*56px/);
    expect(rule('.member-tile-md')).toMatch(/height:\s*56px/);
    expect(rule('.member-tile')).toMatch(/border-radius:\s*50%/);
  });

  it('colours a circle from its hue, with white text, and nothing else is coloured by hand', () => {
    expect(rule('.member-tile')).toContain('background: hsl(var(--h) 42% 32%)');
    expect(rule('.member-tile')).toMatch(/color:\s*#fff\s*;/);
    const rest = section.replace(/\.member-tile\s*\{[^}]*\}/, '');
    expect(rest).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rest).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(rest).not.toContain('--h');
  });

  it('uses only the existing variables and adds none', () => {
    expect(section).toContain('var(--');
    expect(section).not.toMatch(/(^|[\s{;])--[a-z-]+\s*:/);
    const allowed = ['--bg', '--surface', '--line', '--ink', '--muted', '--accent', '--accent-ink', '--danger', '--chip-ring', '--radius', '--h'];
    for (const [, name] of section.matchAll(/var\((--[a-z-]+)/g)) expect(allowed).toContain(name);
  });

  it('wraps long text and never scrolls sideways', () => {
    expect(rule('.member-title')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule('.member-grid')).toMatch(/minmax\(0,\s*1fr\)/);
    expect(rule('.member')).toMatch(/max-width:\s*480px/);
    expect(rule('.member-chips')).toMatch(/flex-wrap:\s*wrap/);
  });

  it('keeps the In button lime when it is the answer', () => {
    expect(rule(".member-answer-in[aria-pressed='true']")).toMatch(/background:\s*var\(--accent\)/);
    expect(rule(".member-answer-in[aria-pressed='true']")).toMatch(/color:\s*var\(--accent-ink\)/);
  });

  it('shows an error message in the danger colour', () => {
    expect(rule(".member-message[role='alert']")).toMatch(/color:\s*var\(--danger\)/);
  });

  it('has no em dashes', () => {
    expect(section).not.toContain(String.fromCharCode(0x2014));
  });
});

// The same maths the Board test uses.
const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

function hslLum(h: number, s: number, l: number): number {
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lig - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return lum(r + m, g + m, b + m);
}

describe('the name circles', () => {
  it('keeps white initials at 4.5 to 1 or more on every one of the 360 hues', () => {
    const m = /hsl\(var\(--h\)\s+(\d+)%\s+(\d+)%\)/.exec(rule('.member-tile'));
    expect(m).not.toBeNull();
    const [s, l] = [Number(m![1]), Number(m![2])];
    for (let h = 0; h < 360; h += 1) {
      expect(1.05 / (hslLum(h, s, l) + 0.05), `hue ${h}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('gives every name a hue from 0 to 359', () => {
    for (const name of ['Ana', 'Ben C.', 'Zasz', 'Enzo']) {
      expect(nameHue(name)).toBeGreaterThanOrEqual(0);
      expect(nameHue(name)).toBeLessThan(360);
    }
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/member/MemberTile.test.tsx src/ui/attendanceCss.test.ts src/ui/cssBalance.test.ts src/ui/memberCss.test.ts`

Expected: it fails. Test Files `4 failed (4)`, Tests `13 failed | 13 passed (26)`.

- [ ] **Step 3: Write the code**

Create `src/member/MemberTile.tsx`:

```tsx
import type { CSSProperties } from 'react';
import { nameHue } from '../store/boardInfo';
import { initials } from '../ui/Avatar';

interface MemberTileProps {
  name: string;
  size?: 'sm' | 'md';
}

/** Initials on a colour that comes from the name. The name itself is shown by whoever uses this. */
export function MemberTile({ name, size = 'md' }: MemberTileProps) {
  return (
    <span className={`member-tile member-tile-${size}`} style={{ '--h': nameHue(name) } as CSSProperties} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
```

Apply this patch to `src/styles/app.css`:

```diff
diff --git a/src/styles/app.css b/src/styles/app.css
index 2529f70..5e154e5 100644
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -2636,6 +2636,353 @@ caption {
   font-size: 14px;
 }
 
+/* Member page */
+/* What a club member sees at the join link. It uses the app colours; only the name circles bring their own. */
+.member {
+  max-width: 480px;
+  min-height: 100vh;
+  min-height: 100dvh;
+  margin: 0 auto;
+  padding: 24px 16px calc(32px + env(safe-area-inset-bottom));
+  display: flex;
+  flex-direction: column;
+  gap: 16px;
+  background: var(--bg);
+  color: var(--ink);
+}
+
+.member-head {
+  display: flex;
+  flex-direction: column;
+  gap: 2px;
+  min-width: 0;
+}
+
+.member-brand {
+  font-size: 13px;
+  font-weight: 800;
+  letter-spacing: 0.1em;
+}
+
+.member-title {
+  font-size: 26px;
+  font-weight: 800;
+  line-height: 1.15;
+  overflow-wrap: anywhere;
+}
+
+.member-when {
+  color: var(--muted);
+  overflow-wrap: anywhere;
+}
+
+.member-stale {
+  color: var(--muted);
+  font-size: 13px;
+}
+
+.member-heading {
+  font-size: 18px;
+  font-weight: 700;
+}
+
+.member-search {
+  width: 100%;
+  min-height: 44px;
+  padding: 10px 14px;
+  border-radius: 12px;
+  border: 1px solid var(--line);
+  background: var(--surface);
+  color: var(--ink);
+  font-size: 16px;
+}
+
+.member-grid {
+  display: grid;
+  grid-template-columns: repeat(3, minmax(0, 1fr));
+  gap: 12px 8px;
+}
+
+.member-pick {
+  min-height: 44px;
+  padding: 6px 4px;
+  display: flex;
+  flex-direction: column;
+  align-items: center;
+  gap: 6px;
+  border: 0;
+  border-radius: 12px;
+  background: transparent;
+  color: var(--ink);
+  font-size: 14px;
+  font-weight: 600;
+  cursor: pointer;
+}
+
+.member-pick-name {
+  max-width: 100%;
+  overflow-wrap: anywhere;
+  text-align: center;
+}
+
+.member-tile {
+  display: inline-flex;
+  align-items: center;
+  justify-content: center;
+  flex: none;
+  border-radius: 50%;
+  background: hsl(var(--h) 42% 32%);
+  color: #fff;
+  font-weight: 700;
+  line-height: 1;
+}
+
+.member-tile-sm {
+  width: 38px;
+  height: 38px;
+  font-size: 14px;
+}
+
+.member-tile-md {
+  width: 56px;
+  height: 56px;
+  font-size: 19px;
+}
+
+.member-note {
+  color: var(--muted);
+  font-size: 14px;
+}
+
+.member-link {
+  min-height: 44px;
+  padding: 0 4px;
+  border: 0;
+  background: transparent;
+  color: var(--ink);
+  font-size: 14px;
+  font-weight: 600;
+  text-decoration: underline;
+  cursor: pointer;
+}
+
+.member-greet {
+  display: flex;
+  flex-wrap: wrap;
+  align-items: center;
+  justify-content: space-between;
+  gap: 0 12px;
+}
+
+.member-banner {
+  padding: 12px 14px;
+  border-radius: 12px;
+  border: 1px solid var(--chip-ring);
+  background: var(--surface);
+  font-weight: 600;
+}
+
+.member-answers {
+  display: grid;
+  grid-template-columns: repeat(3, minmax(0, 1fr));
+  gap: 8px;
+}
+
+.member-answer {
+  min-height: 64px;
+  padding: 6px 4px;
+  border-radius: 14px;
+  border: 1px solid var(--line);
+  background: var(--surface);
+  color: var(--ink);
+  font-size: 17px;
+  font-weight: 700;
+  cursor: pointer;
+}
+
+.member-answer-in {
+  border-color: var(--accent);
+}
+
+.member-answer[aria-pressed='true'] {
+  border-color: var(--ink);
+  background: var(--ink);
+  color: var(--bg);
+}
+
+.member-answer-in[aria-pressed='true'] {
+  border-color: var(--chip-ring);
+  background: var(--accent);
+  color: var(--accent-ink);
+}
+
+.member-answer:disabled {
+  opacity: 0.55;
+  cursor: not-allowed;
+}
+
+.member-chips {
+  display: flex;
+  flex-wrap: wrap;
+  gap: 8px;
+}
+
+.member-chip {
+  min-height: 44px;
+  padding: 0 16px;
+  border-radius: 999px;
+  border: 1px solid var(--line);
+  background: var(--surface);
+  color: var(--ink);
+  font-size: 15px;
+  font-weight: 600;
+  cursor: pointer;
+}
+
+.member-chip[aria-pressed='true'] {
+  border-color: var(--chip-ring);
+  box-shadow: inset 0 0 0 1px var(--chip-ring);
+}
+
+.member-chip:disabled {
+  opacity: 0.55;
+  cursor: not-allowed;
+}
+
+.member-section {
+  display: flex;
+  flex-direction: column;
+  gap: 10px;
+}
+
+.member-section-head {
+  display: flex;
+  align-items: baseline;
+  justify-content: space-between;
+  gap: 12px;
+  font-weight: 700;
+}
+
+.member-faces {
+  display: grid;
+  grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
+  gap: 10px 4px;
+}
+
+.member-face {
+  display: flex;
+  flex-direction: column;
+  align-items: center;
+  gap: 4px;
+  min-width: 0;
+  font-size: 12px;
+}
+
+.member-face-name {
+  max-width: 100%;
+  overflow-wrap: anywhere;
+  text-align: center;
+}
+
+.member-line {
+  font-size: 15px;
+}
+
+.member-busy {
+  padding: 10px 12px;
+  border-radius: 12px;
+  border: 1px solid var(--line);
+  background: var(--surface);
+  font-size: 14px;
+}
+
+.member-calendar {
+  width: 100%;
+  min-height: 44px;
+  border-radius: 999px;
+  border: 1px solid var(--line);
+  background: var(--surface);
+  color: var(--ink);
+  font-weight: 600;
+  cursor: pointer;
+}
+
+.member-message {
+  font-size: 14px;
+  font-weight: 600;
+}
+
+.member-message[role='alert'] {
+  color: var(--danger);
+}
+
+.member-notice {
+  padding: 12px 14px;
+  border-radius: 12px;
+  border: 1px solid var(--line);
+  background: var(--surface);
+  overflow-wrap: anywhere;
+}
+
+.member-next {
+  padding: 14px;
+  border-radius: var(--radius);
+  border: 1px solid var(--line);
+  background: var(--surface);
+  font-weight: 600;
+}
+
+.member-form {
+  display: flex;
+  flex-direction: column;
+  gap: 10px;
+}
+
+.member-input {
+  width: 100%;
+  min-height: 44px;
+  padding: 10px 14px;
+  border-radius: 12px;
+  border: 1px solid var(--line);
+  background: var(--surface);
+  color: var(--ink);
+  font-size: 16px;
+}
+
+.member-submit {
+  min-height: 44px;
+  padding: 0 20px;
+  border-radius: 999px;
+  border: 1px solid var(--ink);
+  background: var(--ink);
+  color: var(--bg);
+  font-weight: 700;
+  cursor: pointer;
+}
+
+.member-submit:disabled {
+  opacity: 0.55;
+  cursor: not-allowed;
+}
+
+.member-retry {
+  align-self: flex-start;
+  min-height: 44px;
+  padding: 0 20px;
+  border-radius: 999px;
+  border: 1px solid var(--ink);
+  background: var(--ink);
+  color: var(--bg);
+  font-weight: 700;
+  cursor: pointer;
+}
+
+.member-search:focus-visible,
+.member-input:focus-visible {
+  outline: 3px solid var(--ink);
+  outline-offset: 2px;
+}
+
 /* Board */
 /* A full-screen board for a TV or a phone on a stand. It sets its own dark colours whatever the app theme is. */
 .board {
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/member/MemberTile.test.tsx src/ui/attendanceCss.test.ts src/ui/cssBalance.test.ts src/ui/memberCss.test.ts`

Expected: it passes. Test Files `4 passed (4)`, Tests `31 passed (31)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 2084 tests across 146 files.

- [ ] **Step 5: Commit**

```bash
git add src/member/MemberTile.test.tsx src/ui/attendanceCss.test.ts src/ui/cssBalance.test.ts src/ui/memberCss.test.ts src/member/MemberTile.tsx src/styles/app.css
git commit -m "Add the member page styles and the coloured name circle"
```

---

### Task 7: The screens

The picker (who are you, with search and "Ask to join"), the answer screen (In, Maybe, Out, late, bring a friend, who is in, the busy line, add to calendar), the cancelled screen (the reason and the next date), the two name sheets, and the calendar download. It never shows Out answers, full names or the code.

**Files:**
- Create: `src/member/MemberAnswer.tsx`
- Create: `src/member/MemberCancelled.tsx`
- Create: `src/member/MemberPicker.tsx`
- Create: `src/member/MemberSheets.tsx`
- Create: `src/member/download.ts`
- Create: `src/member/fixtures.ts`
- Modify: `src/styles/app.css`
- Create: `src/member/MemberAnswer.test.tsx`
- Create: `src/member/MemberCancelled.test.tsx`
- Create: `src/member/MemberPicker.test.tsx`
- Create: `src/member/MemberSheets.test.tsx`
- Create: `src/member/download.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/member/MemberAnswer.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceViewData } from '../sync/attendance/types';
import * as download from './download';
import { sample } from './fixtures';
import { MemberAnswer } from './MemberAnswer';

const ANA = 'p01';
const OK = { ok: true as const, message: 'Added for the organizer to confirm.' };

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

interface Options {
  view?: AttendanceViewData;
  me?: string;
  busy?: boolean;
  message?: { text: string; ok: boolean } | null;
}
function setup({ view = sample(), me = ANA, busy = false, message = null }: Options = {}) {
  const onAnswer = vi.fn();
  const onForget = vi.fn();
  const onAddFriend = vi.fn(async () => OK);
  render(<MemberAnswer view={view} me={me} busy={busy} message={message} onAnswer={onAnswer} onForget={onForget} onAddFriend={onAddFriend} />);
  return { onAnswer, onForget, onAddFriend };
}
/** The view with one player's answer changed. */
const answered = (id: string, status: 'in' | 'maybe' | 'out', late = false) => {
  const base = sample();
  return sample({ answers: [...base.answers.filter((a) => a.player_id !== id), { player_id: id, status, late }] });
};
/** The view with no answer from one player. */
const unanswered = (id: string) => sample({ answers: sample().answers.filter((a) => a.player_id !== id) });

describe('the greeting', () => {
  it('says Hi with the first name and shows when and where', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Hi Ana' })).toBeInTheDocument();
    expect(screen.getByText('Tue 10 Nov, 7 to 9 pm, Sample Hall')).toBeInTheDocument();
  });

  it('uses the first name only, even when the list shows a last initial', () => {
    setup({ me: 'p02' });
    expect(screen.getByRole('heading', { name: 'Hi Ben' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not Ben?' })).toBeInTheDocument();
  });

  it('offers Not Ana? and forgets on a tap', async () => {
    const { onForget } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Not Ana?' }));
    expect(onForget).toHaveBeenCalledTimes(1);
  });
});

describe('the answer', () => {
  it('shows In, Maybe and Out, and marks the current one pressed', () => {
    setup();
    expect(screen.getByRole('button', { name: 'In' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Maybe' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Out' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks Maybe and Out when those are the answer', () => {
    const { unmount } = render(
      <MemberAnswer view={answered(ANA, 'maybe')} me={ANA} busy={false} message={null} onAnswer={vi.fn()} onForget={vi.fn()} onAddFriend={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Maybe' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'In' })).toHaveAttribute('aria-pressed', 'false');
    unmount();
    render(<MemberAnswer view={answered(ANA, 'out')} me={ANA} busy={false} message={null} onAnswer={vi.fn()} onForget={vi.fn()} onAddFriend={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Out' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks nothing before the first answer, and shows no banner', () => {
    setup({ view: unanswered(ANA) });
    for (const name of ['In', 'Maybe', 'Out']) expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/^You're/)).toBeNull();
  });

  it('says the answer in a status banner with the date', () => {
    setup();
    expect(screen.getByText("You're in for Tue 10 Nov.")).toBeInTheDocument();
    expect(screen.getByText("You're in for Tue 10 Nov.")).toHaveAttribute('role', 'status');
  });

  it('words the banner for Maybe and for Out', () => {
    const maybe = render(
      <MemberAnswer view={answered(ANA, 'maybe')} me={ANA} busy={false} message={null} onAnswer={vi.fn()} onForget={vi.fn()} onAddFriend={vi.fn()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent("You're a maybe for Tue 10 Nov. You can change this any time.");
    maybe.unmount();
    render(<MemberAnswer view={answered(ANA, 'out')} me={ANA} busy={false} message={null} onAnswer={vi.fn()} onForget={vi.fn()} onAddFriend={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent("You're out for Tue 10 Nov.");
  });

  it('answers with a tap on each button', async () => {
    const { onAnswer } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Maybe' }));
    expect(onAnswer).toHaveBeenLastCalledWith('maybe');
    await userEvent.click(screen.getByRole('button', { name: 'Out' }));
    expect(onAnswer).toHaveBeenLastCalledWith('out');
    await userEvent.click(screen.getByRole('button', { name: 'In' }));
    expect(onAnswer).toHaveBeenLastCalledWith('in', false);
    expect(onAnswer).toHaveBeenCalledTimes(3);
  });

  it('disables every answer while busy', () => {
    setup({ busy: true });
    for (const name of ['In', 'Maybe', 'Out', "I'll arrive late"]) expect(screen.getByRole('button', { name })).toBeDisabled();
  });

  it('does not disable them when not busy', () => {
    setup();
    for (const name of ['In', 'Maybe', 'Out', "I'll arrive late"]) expect(screen.getByRole('button', { name })).toBeEnabled();
  });
});

describe('arriving late', () => {
  it('is not pressed when you are not late', () => {
    setup();
    expect(screen.getByRole('button', { name: "I'll arrive late" })).toHaveAttribute('aria-pressed', 'false');
  });

  it('is pressed when you are in and late', () => {
    setup({ view: answered(ANA, 'in', true) });
    expect(screen.getByRole('button', { name: "I'll arrive late" })).toHaveAttribute('aria-pressed', 'true');
  });

  it('is not pressed when late is kept on a maybe', () => {
    setup({ view: answered(ANA, 'maybe', true) });
    expect(screen.getByRole('button', { name: "I'll arrive late" })).toHaveAttribute('aria-pressed', 'false');
  });

  it('turns late on while you are in', async () => {
    const { onAnswer } = setup();
    await userEvent.click(screen.getByRole('button', { name: "I'll arrive late" }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('in', true);
  });

  it('turns late off while you are in and late', async () => {
    const { onAnswer } = setup({ view: answered(ANA, 'in', true) });
    await userEvent.click(screen.getByRole('button', { name: "I'll arrive late" }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('in', false);
  });

  it('answers In with late when you were a maybe', async () => {
    const { onAnswer } = setup({ view: answered(ANA, 'maybe') });
    await userEvent.click(screen.getByRole('button', { name: "I'll arrive late" }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('in', true);
  });

  it('answers In with late when you were out, or had not answered', async () => {
    const first = setup({ view: unanswered(ANA) });
    await userEvent.click(screen.getByRole('button', { name: "I'll arrive late" }));
    expect(first.onAnswer).toHaveBeenCalledExactlyOnceWith('in', true);
  });

  it('keeps late when you tap In again while late', async () => {
    const { onAnswer } = setup({ view: answered(ANA, 'in', true) });
    await userEvent.click(screen.getByRole('button', { name: 'In' }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('in', true);
  });
});

describe('who is in', () => {
  it('lists the In people as circles with first names, in the list order', () => {
    setup();
    const section = screen.getByRole('region', { name: 'In' });
    const names = within(section)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(names.slice(0, 3)).toEqual(['ANAna', 'BCBen C.', 'CACarlo']);
    expect(names).toHaveLength(11);
  });

  it('shows the count', () => {
    setup();
    expect(within(screen.getByRole('region', { name: 'In' })).getByText('11 people')).toBeInTheDocument();
  });

  it('says 1 person for one', () => {
    const only = sample({ answers: [{ player_id: ANA, status: 'in', late: false }], friends: 0 });
    setup({ view: only });
    expect(screen.getByText('1 person')).toBeInTheDocument();
  });

  it('shows 12 circles at most, then how many more', () => {
    const many = sample({
      players: Array.from({ length: 15 }, (_, i) => ({ id: `q${i}`, first_name: `Name${String.fromCharCode(97 + i)}`, last_initial: null, has_photo: false, photo_seq: 0 })),
      answers: Array.from({ length: 15 }, (_, i) => ({ player_id: `q${i}`, status: 'in' as const, late: false })),
      friends: 0,
    });
    setup({ view: many, me: 'q0' });
    const items = within(screen.getByRole('region', { name: 'In' })).getAllByRole('listitem');
    expect(items).toHaveLength(13);
    expect(items[12]).toHaveTextContent('+3 more');
    expect(screen.getByText('15 people')).toBeInTheDocument();
  });

  it('shows exactly 12 with no more line', () => {
    const twelve = sample({
      players: Array.from({ length: 12 }, (_, i) => ({ id: `q${i}`, first_name: `Name${String.fromCharCode(97 + i)}`, last_initial: null, has_photo: false, photo_seq: 0 })),
      answers: Array.from({ length: 12 }, (_, i) => ({ player_id: `q${i}`, status: 'in' as const, late: false })),
      friends: 0,
    });
    setup({ view: twelve, me: 'q0' });
    expect(within(screen.getByRole('region', { name: 'In' })).getAllByRole('listitem')).toHaveLength(12);
    expect(screen.queryByText(/more$/)).toBeNull();
  });

  it('ignores an answer from someone who is not on the roster', () => {
    const view = sample({ answers: [...sample().answers, { player_id: 'gone', status: 'in', late: false }] });
    setup({ view });
    expect(screen.getByText('11 people')).toBeInTheDocument();
  });

  it('shows no In list when nobody is in', () => {
    setup({ view: sample({ answers: [], friends: 0 }) });
    expect(screen.getByText('Nobody yet.')).toBeInTheDocument();
    expect(screen.queryByText(/people$/)).toBeNull();
  });

  it('shows the last initial for the two Bens', () => {
    setup({ view: answered('p14', 'in') });
    const section = screen.getByRole('region', { name: 'In' });
    expect(within(section).getByText('Ben C.')).toBeInTheDocument();
    expect(within(section).getByText('Ben D.')).toBeInTheDocument();
  });
});

describe('maybe, out and friends', () => {
  it('shows Maybe as a count and never as names', () => {
    setup();
    expect(screen.getByText('3 maybe')).toBeInTheDocument();
    for (const name of ['Mo', 'Ben D.']) expect(screen.queryByText(name)).toBeNull();
  });

  it('leaves the Maybe line out when there are none', () => {
    setup({ view: sample({ answers: sample().answers.filter((a) => a.status !== 'maybe') }) });
    expect(screen.queryByText(/maybe$/)).toBeNull();
  });

  it('never shows an Out count or an Out name', () => {
    setup();
    expect(screen.queryByText('Ned')).toBeNull();
    expect(screen.queryByText('Ola')).toBeNull();
    expect(screen.queryByText(/\b2 out\b/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/Ned|Ola/);
  });

  it('shows no names for people who are not In, apart from you', () => {
    setup({ view: answered('p01', 'out') });
    // You are out, and still not in the In list.
    expect(within(screen.getByRole('region', { name: 'In' })).queryByText('Ana')).toBeNull();
  });

  it('shows friends as a count', () => {
    setup();
    expect(screen.getByText('Plus 1 friend')).toBeInTheDocument();
  });

  it('says friends for more than one, and nothing for none', () => {
    const two = render(
      <MemberAnswer view={sample({ friends: 2 })} me={ANA} busy={false} message={null} onAnswer={vi.fn()} onForget={vi.fn()} onAddFriend={vi.fn()} />,
    );
    expect(screen.getByText('Plus 2 friends')).toBeInTheDocument();
    two.unmount();
    render(<MemberAnswer view={sample({ friends: 0 })} me={ANA} busy={false} message={null} onAnswer={vi.fn()} onForget={vi.fn()} onAddFriend={vi.fn()} />);
    expect(screen.queryByText(/^Plus /)).toBeNull();
  });

  it('never shows the link code or a player id', () => {
    setup();
    expect(document.body.textContent).not.toMatch(/p01|abc123/);
  });
});

describe('the busy line', () => {
  it('shows when more than 4 for each court are in, friends included', () => {
    // 11 in plus 2 friends is 13, and 3 courts is 12.
    setup({ view: sample({ friends: 2 }) });
    expect(screen.getByText('Busy night: 13 in for 3 courts. Expect to sit out a game now and then.')).toBeInTheDocument();
  });

  it('does not show at exactly 4 for each court', () => {
    setup({ view: sample({ friends: 1 }) });
    expect(screen.queryByText(/^Busy night/)).toBeNull();
  });

  it('does not show when the courts are not known', () => {
    setup({ view: sample({ courts: null, friends: 9 }) });
    expect(screen.queryByText(/^Busy night/)).toBeNull();
  });
});

describe('Bring a friend', () => {
  it('opens the friend sheet and sends the name', async () => {
    const { onAddFriend } = setup();
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Bring a friend' }));
    expect(screen.getByRole('dialog', { name: 'Bring a friend' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Friend's name"), 'Rico');
    await userEvent.click(screen.getByRole('button', { name: 'Add friend' }));
    expect(onAddFriend).toHaveBeenCalledExactlyOnceWith('Rico');
  });

  it('closes the sheet with Escape', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Bring a friend' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is disabled while busy', () => {
    setup({ busy: true });
    expect(screen.getByRole('button', { name: 'Bring a friend' })).toBeDisabled();
  });
});

describe('the message', () => {
  it('shows nothing when there is none', () => {
    setup();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a failure as an alert', () => {
    setup({ message: { text: 'No connection. Try again when you are online.', ok: false } });
    expect(screen.getByRole('alert')).toHaveTextContent('No connection. Try again when you are online.');
  });

  it('shows a success as a status', () => {
    setup({ message: { text: 'Added for the organizer to confirm.', ok: true } });
    const el = screen.getByText('Added for the organizer to confirm.');
    expect(el).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Add to calendar', () => {
  it('downloads the calendar file for the view', async () => {
    const spy = vi.spyOn(download, 'downloadFile').mockImplementation(() => undefined);
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
    expect(spy).toHaveBeenCalledTimes(1);
    const [name, text] = spy.mock.calls[0];
    expect(name).toMatch(/\.ics$/);
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain('SUMMARY:Tuesday open play');
    expect(text).toContain('DTSTART:20261110T190000');
    expect(text).toContain('LOCATION:Sample Hall');
  });
});

describe('what is never shown', () => {
  it('has no exclamation marks and no em dashes', () => {
    setup();
    expect(document.body.textContent).not.toContain('!');
    expect(document.body.textContent).not.toContain(String.fromCharCode(0x2014));
  });
});
```

Create `src/member/MemberCancelled.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { sample } from './fixtures';
import { MemberCancelled } from './MemberCancelled';

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
  delete document.documentElement.dataset.theme;
});

const cancelled = (reason: string | null, playDate = '2026-11-10') => sample({ cancelled: { reason }, play_date: playDate });

describe('MemberCancelled', () => {
  it('says no play this weekday, using the date', () => {
    render(<MemberCancelled view={cancelled(null)} />);
    expect(screen.getByRole('heading', { name: 'No play this Tuesday' })).toBeInTheDocument();
  });

  it('uses the weekday of the date and not the weekday on the link', () => {
    render(<MemberCancelled view={{ ...cancelled(null, '2026-11-12'), weekday: 2 }} />);
    expect(screen.getByRole('heading', { name: 'No play this Thursday' })).toBeInTheDocument();
  });

  it('shows the date', () => {
    render(<MemberCancelled view={cancelled(null)} />);
    expect(screen.getByText('Tue 10 Nov')).toBeInTheDocument();
  });

  it('shows the reason in a notice when there is one', () => {
    render(<MemberCancelled view={cancelled('Venue is closed for floor repairs.')} />);
    expect(screen.getByText('Venue is closed for floor repairs.')).toHaveClass('member-notice');
  });

  it('shows no notice when there is no reason, or only spaces', () => {
    const { container, rerender } = render(<MemberCancelled view={cancelled(null)} />);
    expect(container.querySelector('.member-notice')).toBeNull();
    rerender(<MemberCancelled view={cancelled('   ')} />);
    expect(container.querySelector('.member-notice')).toBeNull();
  });

  it('shows the next session a week later', () => {
    render(<MemberCancelled view={cancelled(null)} />);
    expect(screen.getByText('Next session: Tue 17 Nov')).toBeInTheDocument();
  });

  it('carries the next session over a month and a year end', () => {
    render(<MemberCancelled view={cancelled(null, '2026-12-29')} />);
    expect(screen.getByText('Next session: Tue 5 Jan')).toBeInTheDocument();
  });

  it('has no answer buttons, no roster and no counts', () => {
    render(<MemberCancelled view={cancelled('Rain')} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/Ana|maybe|people/);
  });
});
```

Create `src/member/MemberPicker.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE } from './fixtures';
import { MemberPicker } from './MemberPicker';

const OK = { ok: true as const, message: 'Thanks. The organizer will see your name.' };

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
  delete document.documentElement.dataset.theme;
});

function setup(players = SAMPLE.players, onAskToJoin = vi.fn(async () => OK)) {
  const onPick = vi.fn();
  render(<MemberPicker players={players} onPick={onPick} onAskToJoin={onAskToJoin} />);
  return { onPick, onAskToJoin };
}

describe('MemberPicker', () => {
  it('asks who you are and says it is first names only', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expect(screen.getByText('First names only. No account.')).toBeInTheDocument();
  });

  it('shows a button for every player, named by first name', () => {
    setup();
    const grid = screen.getByRole('list');
    expect(within(grid).getAllByRole('button')).toHaveLength(16);
    expect(screen.getByRole('button', { name: 'Ana' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Carlo' })).toBeInTheDocument();
  });

  it('gives each circle the initials, hidden from screen readers', () => {
    setup();
    const ana = screen.getByRole('button', { name: 'Ana' });
    const tile = ana.querySelector('.member-tile');
    expect(tile).toHaveTextContent('AN');
    expect(tile).toHaveAttribute('aria-hidden', 'true');
  });

  it('adds a last initial when two players share a first name', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Ben C.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ben D.' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ben' })).toBeNull();
  });

  it('picks with the player id', async () => {
    const { onPick } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Ben D.' }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith('p14');
  });

  it('filters as you type, ignoring case', async () => {
    setup();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search your name' }), 'aN');
    expect(screen.getByRole('button', { name: 'Ana' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carlo' })).toBeNull();
  });

  it('matches a part of a name and ignores spaces at the ends', async () => {
    setup();
    await userEvent.type(screen.getByRole('searchbox'), ' ben ');
    expect(screen.getAllByRole('button', { name: /^Ben/ })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Ana' })).toBeNull();
  });

  it('says No match when nothing fits, and still offers Ask to join', async () => {
    setup();
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('No match.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('button', { name: 'Not on the list? Ask to join.' })).toBeInTheDocument();
  });

  it('says there are no names yet for an empty roster, with no search field', () => {
    setup([]);
    expect(screen.getByText('No names yet. Ask your organizer.')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByText('No match.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Not on the list? Ask to join.' })).toBeInTheDocument();
  });

  it('has a 16 px search field', () => {
    setup();
    expect(screen.getByRole('searchbox')).toHaveClass('member-search');
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', 'Search your name');
  });

  it('opens the Ask to join sheet and sends the name', async () => {
    const { onAskToJoin } = setup();
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Not on the list? Ask to join.' }));
    expect(screen.getByRole('dialog', { name: 'Ask to join' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Your name'), 'Mika');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onAskToJoin).toHaveBeenCalledExactlyOnceWith('Mika');
  });

  it('closes the sheet on Escape', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Not on the list? Ask to join.' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('never shows a last name or an answer', () => {
    setup();
    expect(document.body.textContent).not.toMatch(/\bout\b/i);
  });
});
```

Create `src/member/MemberSheets.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ActionResult } from './useMemberPage';
import { FriendSheet, JoinSheet } from './MemberSheets';

const OK: ActionResult = { ok: true, message: 'Added for the organizer to confirm.' };
const user = () => userEvent.setup({ delay: null });

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
  delete document.documentElement.dataset.theme;
});
afterEach(() => {
  vi.restoreAllMocks();
});

// Fake timers do not mix with Testing Library's waiting, so the close timer is read from a spy and run by hand.
function closeTimer(spy: MockInstance<typeof setTimeout>) {
  const at = spy.mock.calls.findIndex((c) => c[1] === 1500);
  return at < 0 ? null : { run: spy.mock.calls[at][0] as () => void, id: spy.mock.results[at].value };
}

describe('the two sheets', () => {
  it('opens Bring a friend as a dialog with a name field, 16 px type and a 40 character limit', () => {
    render(<FriendSheet onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Bring a friend' })).toBeInTheDocument();
    const field = screen.getByLabelText("Friend's name");
    expect(field).toHaveAttribute('maxlength', '40');
    expect(field).toHaveClass('member-input');
    expect(screen.getByRole('button', { name: 'Add friend' })).toBeEnabled();
  });

  it('opens Ask to join as a dialog with its own label and button', () => {
    render(<JoinSheet onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Ask to join' })).toBeInTheDocument();
    expect(screen.getByLabelText('Your name')).toHaveAttribute('maxlength', '40');
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('sends the trimmed name', async () => {
    const onSubmit = vi.fn(async () => OK);
    render(<FriendSheet onSubmit={onSubmit} onClose={vi.fn()} />);
    await user().type(screen.getByLabelText("Friend's name"), '  Rico  ');
    await user().click(screen.getByRole('button', { name: 'Add friend' }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Rico');
  });

  it('sends with Enter too', async () => {
    const onSubmit = vi.fn(async () => OK);
    render(<JoinSheet onSubmit={onSubmit} onClose={vi.fn()} />);
    await user().type(screen.getByLabelText('Your name'), 'Mika{Enter}');
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Mika');
  });

  it('does not send an empty name and says why', async () => {
    const onSubmit = vi.fn(async () => OK);
    render(<JoinSheet onSubmit={onSubmit} onClose={vi.fn()} />);
    await user().click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Use 1 to 40 characters.');
  });

  it('does not send a name of only spaces', async () => {
    const onSubmit = vi.fn(async () => OK);
    render(<JoinSheet onSubmit={onSubmit} onClose={vi.fn()} />);
    await user().type(screen.getByLabelText('Your name'), '   ');
    await user().click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows a success as a status, then closes after a moment', async () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const onClose = vi.fn();
    render(<FriendSheet onSubmit={async () => OK} onClose={onClose} />);
    await user().type(screen.getByLabelText("Friend's name"), 'Rico');
    await user().click(screen.getByRole('button', { name: 'Add friend' }));
    expect(screen.getByRole('status')).toHaveTextContent('Added for the organizer to confirm.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    const timer = closeTimer(spy);
    expect(timer).not.toBeNull();
    act(() => timer!.run());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close after a success when the sheet is gone first', async () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = render(<FriendSheet onSubmit={async () => OK} onClose={vi.fn()} />);
    await user().type(screen.getByLabelText("Friend's name"), 'Rico');
    await user().click(screen.getByRole('button', { name: 'Add friend' }));
    const timer = closeTimer(spy);
    expect(timer).not.toBeNull();
    unmount();
    expect(clear).toHaveBeenCalledWith(timer!.id);
  });

  it('shows a failure as an alert and stays open for another try', async () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const onClose = vi.fn();
    const failed: ActionResult = { ok: false, reason: 'too_many', message: 'The list of new names is full. Ask your organizer.' };
    render(<JoinSheet onSubmit={async () => failed} onClose={onClose} />);
    await user().type(screen.getByLabelText('Your name'), 'Mika');
    await user().click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The list of new names is full. Ask your organizer.');
    expect(closeTimer(spy)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(screen.getByLabelText('Your name')).toHaveValue('Mika');
  });

  it('closes at once when a failure has no words, because the page shows the reason itself', async () => {
    const onClose = vi.fn();
    render(<JoinSheet onSubmit={async () => ({ ok: false, reason: 'cancelled', message: '' })} onClose={onClose} />);
    await user().type(screen.getByLabelText('Your name'), 'Mika');
    await user().click(screen.getByRole('button', { name: 'Send' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is disabled while the request runs, and sends once', async () => {
    let finish!: (r: ActionResult) => void;
    const onSubmit = vi.fn(() => new Promise<ActionResult>((resolve) => (finish = resolve)));
    render(<JoinSheet onSubmit={onSubmit} onClose={vi.fn()} />);
    await user().type(screen.getByLabelText('Your name'), 'Mika');
    await user().click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByLabelText('Your name')).toBeDisabled();
    await user().keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: false, reason: 'server', message: 'Something went wrong. Try again.' }));
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('stays disabled after a success, so a name is not sent twice', async () => {
    const onSubmit = vi.fn(async () => OK);
    render(<FriendSheet onSubmit={onSubmit} onClose={vi.fn()} />);
    await user().type(screen.getByLabelText("Friend's name"), 'Rico');
    await user().click(screen.getByRole('button', { name: 'Add friend' }));
    expect(screen.getByRole('button', { name: 'Add friend' })).toBeDisabled();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<FriendSheet onSubmit={vi.fn()} onClose={onClose} />);
    await user().keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the Close button', async () => {
    const onClose = vi.fn();
    render(<JoinSheet onSubmit={vi.fn()} onClose={onClose} />);
    await user().click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

Create `src/member/download.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadFile } from './download';

const created: Blob[] = [];
let clicked: { download: string; href: string }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  created.length = 0;
  clicked = [];
  URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
    created.push(blob as Blob);
    return 'blob:test/1';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ download: this.download, href: this.href });
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('downloadFile', () => {
  it('clicks a temporary link that downloads the file under its name', () => {
    downloadFile('play.ics', 'BEGIN:VCALENDAR');
    expect(clicked).toEqual([{ download: 'play.ics', href: 'blob:test/1' }]);
  });

  it('puts the text in a calendar blob', () => {
    downloadFile('play.ics', 'BEGIN:VCALENDAR');
    expect(created).toHaveLength(1);
    expect(created[0].type).toBe('text/calendar;charset=utf-8');
    expect(created[0].size).toBe('BEGIN:VCALENDAR'.length);
  });

  it('removes the link from the page, and frees the object url a moment later', () => {
    downloadFile('play.ics', 'x');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/member/MemberAnswer.test.tsx src/member/MemberCancelled.test.tsx src/member/MemberPicker.test.tsx src/member/MemberSheets.test.tsx src/member/download.test.ts`

Expected: it fails. Test Files `5 failed (5)`, Tests `no tests`.

- [ ] **Step 3: Write the code**

Create `src/member/MemberAnswer.tsx`:

```tsx
import { useState } from 'react';
import type { AttendanceStatus, AttendanceViewData } from '../sync/attendance/types';
import { displayNames } from '../sync/attendance/links';
import { downloadFile } from './download';
import { busyLine, dateLabel, statusLine, whenLine } from './format';
import { calendarFile } from './ics';
import { FriendSheet } from './MemberSheets';
import { MemberTile } from './MemberTile';
import type { ActionResult } from './useMemberPage';

const FACES = 12;

interface MemberAnswerProps {
  view: AttendanceViewData;
  /** The player id of the member. */
  me: string;
  busy: boolean;
  message: { text: string; ok: boolean } | null;
  onAnswer: (status: AttendanceStatus, late?: boolean) => void;
  onForget: () => void;
  onAddFriend: (name: string) => Promise<ActionResult>;
}

const BUTTONS: { status: AttendanceStatus; label: string }[] = [
  { status: 'in', label: 'In' },
  { status: 'maybe', label: 'Maybe' },
  { status: 'out', label: 'Out' },
];

/** Screen 2: answer In, Maybe or Out, and see who is coming. Never shows who is out. */
export function MemberAnswer({ view, me, busy, message, onAnswer, onForget, onAddFriend }: MemberAnswerProps) {
  const [friend, setFriend] = useState(false);
  const names = displayNames(view.players);
  const mine = view.answers.find((a) => a.player_id === me);
  const first = view.players.find((p) => p.id === me)?.first_name ?? '';
  const onRoster = new Set(view.players.map((p) => p.id));
  const status = new Map(view.answers.filter((a) => onRoster.has(a.player_id)).map((a) => [a.player_id, a.status]));
  const inPeople = view.players.filter((p) => status.get(p.id) === 'in');
  const maybe = [...status.values()].filter((s) => s === 'maybe').length;
  const busyText = busyLine(view);
  const lateOn = mine?.status === 'in' && mine.late;

  return (
    <div className="member-section">
      <div className="member-greet">
        <h2 className="member-heading">Hi {first}</h2>
        <button type="button" className="member-link" onClick={onForget}>
          Not {first}?
        </button>
      </div>
      <p className="member-when">{whenLine(view)}</p>
      {mine && (
        <p className="member-banner" role="status">
          {statusLine(mine.status, dateLabel(view.play_date))}
        </p>
      )}
      <div className="member-answers">
        {BUTTONS.map(({ status: s, label }) => (
          <button
            key={s}
            type="button"
            className={`member-answer member-answer-${s}`}
            aria-pressed={mine?.status === s}
            disabled={busy}
            // Tapping In again keeps the late mark.
            onClick={() => (s === 'in' ? onAnswer('in', lateOn) : onAnswer(s))}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="member-chips">
        <button type="button" className="member-chip" aria-pressed={lateOn} disabled={busy} onClick={() => onAnswer('in', !lateOn)}>
          I'll arrive late
        </button>
        <button type="button" className="member-chip" disabled={busy} onClick={() => setFriend(true)}>
          Bring a friend
        </button>
      </div>
      {message && (
        <p className="member-message" role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
      <section className="member-section" aria-labelledby="member-in">
        <div className="member-section-head">
          <h3 id="member-in" className="member-heading">
            In
          </h3>
          {inPeople.length > 0 && <span>{inPeople.length === 1 ? '1 person' : `${inPeople.length} people`}</span>}
        </div>
        {inPeople.length === 0 ? (
          <p className="member-note">Nobody yet.</p>
        ) : (
          <ul className="member-faces">
            {inPeople.slice(0, FACES).map((p) => (
              <li key={p.id} className="member-face">
                <MemberTile name={names[p.id]} size="sm" />
                <span className="member-face-name">{names[p.id]}</span>
              </li>
            ))}
            {inPeople.length > FACES && (
              <li className="member-face">
                <span className="member-face-name">+{inPeople.length - FACES} more</span>
              </li>
            )}
          </ul>
        )}
      </section>
      {maybe > 0 && <p className="member-line">{maybe} maybe</p>}
      {view.friends > 0 && <p className="member-line">Plus {view.friends} {view.friends === 1 ? 'friend' : 'friends'}</p>}
      {busyText && <p className="member-busy">{busyText}</p>}
      <button
        type="button"
        className="member-calendar"
        onClick={() => {
          const file = calendarFile(view);
          downloadFile(file.name, file.text);
        }}
      >
        Add to calendar
      </button>
      {friend && <FriendSheet onSubmit={onAddFriend} onClose={() => setFriend(false)} />}
    </div>
  );
}
```

Create `src/member/MemberCancelled.tsx`:

```tsx
import type { AttendanceViewData } from '../sync/attendance/types';
import { dateLabel, nextWeek } from './format';

/** The weekday name of a play date ("Tuesday"), read as a calendar day so no time zone moves it. */
function weekdayName(playDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(playDate);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

/** Screen 6: no play this week. Nothing to answer. */
export function MemberCancelled({ view }: { view: AttendanceViewData }) {
  const day = weekdayName(view.play_date);
  const reason = view.cancelled?.reason?.trim();
  return (
    <section className="member-section">
      <h2 className="member-heading">{day ? `No play this ${day}` : 'No play this week'}</h2>
      <p className="member-when">{dateLabel(view.play_date)}</p>
      {reason && <p className="member-notice">{reason}</p>}
      <p className="member-next">Next session: {dateLabel(nextWeek(view.play_date))}</p>
    </section>
  );
}
```

Create `src/member/MemberPicker.tsx`:

```tsx
import { useState } from 'react';
import type { AttendanceViewData } from '../sync/attendance/types';
import { displayNames } from '../sync/attendance/links';
import { MemberTile } from './MemberTile';
import { JoinSheet } from './MemberSheets';
import type { ActionResult } from './useMemberPage';

interface MemberPickerProps {
  players: AttendanceViewData['players'];
  onPick: (playerId: string) => void;
  onAskToJoin: (name: string) => Promise<ActionResult>;
}

/** Screen 1: tap your own name. */
export function MemberPicker({ players, onPick, onAskToJoin }: MemberPickerProps) {
  const [query, setQuery] = useState('');
  const [asking, setAsking] = useState(false);
  const names = displayNames(players);
  const needle = query.trim().toLowerCase();
  const shown = players.filter((p) => names[p.id].toLowerCase().includes(needle));

  return (
    <section className="member-section" aria-labelledby="member-who">
      <h2 id="member-who" className="member-heading">
        Who are you?
      </h2>
      {players.length === 0 ? (
        <p className="member-note">No names yet. Ask your organizer.</p>
      ) : (
        <>
          <input
            type="search"
            className="member-search"
            aria-label="Search your name"
            placeholder="Search your name"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {shown.length === 0 ? (
            <p className="member-note">No match.</p>
          ) : (
            <ul className="member-grid">
              {shown.map((p) => (
                <li key={p.id}>
                  <button type="button" className="member-pick" onClick={() => onPick(p.id)}>
                    <MemberTile name={names[p.id]} />
                    <span className="member-pick-name">{names[p.id]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <button type="button" className="member-link" onClick={() => setAsking(true)}>
        Not on the list? Ask to join.
      </button>
      <p className="member-note">First names only. No account.</p>
      {asking && <JoinSheet onSubmit={onAskToJoin} onClose={() => setAsking(false)} />}
    </section>
  );
}
```

Create `src/member/MemberSheets.tsx`:

```tsx
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Sheet } from '../ui/Sheet';
import type { ActionResult } from './useMemberPage';

const BAD_NAME = 'Use 1 to 40 characters.';
// How long the thank you stays before the sheet closes.
const SHOW_MS = 1500;

interface NameSheetProps {
  title: string;
  label: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<ActionResult>;
  onClose: () => void;
}

type Shown = { text: string; ok: boolean } | null;

function NameSheet({ title, label, submitLabel, onSubmit, onClose }: NameSheetProps) {
  const id = useId();
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [shown, setShown] = useState<Shown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const clean = name.trim();
    if (clean.length < 1 || clean.length > 40) {
      setShown({ text: BAD_NAME, ok: false });
      return;
    }
    setPending(true);
    setShown(null);
    const result = await onSubmit(clean);
    if (result.ok) {
      setShown({ text: result.message, ok: true });
      timer.current = setTimeout(() => closeRef.current(), SHOW_MS);
      return;
    }
    setPending(false);
    // A failure with no words is one the page shows by itself, like a cancelled week.
    if (result.message === '') closeRef.current();
    else setShown({ text: result.message, ok: false });
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <form className="member-form" onSubmit={submit} noValidate>
        <label className="label" htmlFor={id}>
          {label}
        </label>
        <input id={id} className="member-input" value={name} maxLength={40} autoComplete="off" disabled={pending} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="member-submit" disabled={pending}>
          {submitLabel}
        </button>
        {shown && (
          <p className="member-message" role={shown.ok ? 'status' : 'alert'}>
            {shown.text}
          </p>
        )}
      </form>
    </Sheet>
  );
}

interface SheetProps {
  onSubmit: (name: string) => Promise<ActionResult>;
  onClose: () => void;
}

export function FriendSheet(props: SheetProps) {
  return <NameSheet title="Bring a friend" label="Friend's name" submitLabel="Add friend" {...props} />;
}

export function JoinSheet(props: SheetProps) {
  return <NameSheet title="Ask to join" label="Your name" submitLabel="Send" {...props} />;
}
```

Create `src/member/download.ts`:

```typescript
/** Saves text as a calendar file with a temporary link. */
export function downloadFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Some browsers start the save a moment after the click, so the address is freed later.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

Create `src/member/fixtures.ts`:

```typescript
import type { AttendanceViewData } from '../sync/attendance/types';
import type { MemberRemote } from './remote';

// Sample data for the member page tests and the browser check. Not used by the app.
type Row = [id: string, first: string, initial: string | null, answer: 'in' | 'maybe' | 'out' | null];

// Two players are called Ben. 11 are in, 3 maybe, 2 out.
const ROWS: Row[] = [
  ['p01', 'Ana', null, 'in'],
  ['p02', 'Ben', 'C', 'in'],
  ['p03', 'Carlo', null, 'in'],
  ['p04', 'Dee', null, 'in'],
  ['p05', 'Eli', null, 'in'],
  ['p06', 'Fay', null, 'in'],
  ['p07', 'Gus', null, 'in'],
  ['p08', 'Hera', null, 'in'],
  ['p09', 'Ian', null, 'in'],
  ['p10', 'Jun', null, 'in'],
  ['p11', 'Kai', null, 'in'],
  ['p12', 'Lia', null, 'maybe'],
  ['p13', 'Mo', null, 'maybe'],
  ['p14', 'Ben', 'D', 'maybe'],
  ['p15', 'Ned', null, 'out'],
  ['p16', 'Ola', null, 'out'],
];

export const SAMPLE: AttendanceViewData = {
  title: 'Tuesday open play',
  weekday: 2,
  venue: 'Sample Hall',
  start_min: 1140,
  end_min: 1260,
  courts: 3,
  play_date: '2026-11-10',
  cancelled: null,
  players: ROWS.map(([id, first_name, last_initial]) => ({ id, first_name, last_initial, has_photo: false, photo_seq: 0 })),
  answers: ROWS.flatMap(([id, , , answer]) => (answer ? [{ player_id: id, status: answer, late: false }] : [])),
  friends: 1,
};

export const sample = (patch: Partial<AttendanceViewData> = {}): AttendanceViewData => ({ ...SAMPLE, ...patch });

/** A remote that keeps the answers in memory, so the whole page can be driven without a server. */
export function memoryRemote(start: AttendanceViewData = SAMPLE): MemberRemote & { data: AttendanceViewData } {
  const remote = {
    data: start,
    async view() {
      return remote.data;
    },
    async answer(_code: string, playerId: string, status: 'in' | 'maybe' | 'out', late: boolean) {
      remote.data = {
        ...remote.data,
        answers: [...remote.data.answers.filter((a) => a.player_id !== playerId), { player_id: playerId, status, late: status === 'in' && late }],
      };
    },
    async addGuest(_code: string, _name: string, broughtBy: string | null) {
      if (broughtBy) remote.data = { ...remote.data, friends: remote.data.friends + 1 };
    },
  };
  return remote;
}
```

Apply this patch to `src/styles/app.css`:

```diff
diff --git a/src/styles/app.css b/src/styles/app.css
index 5e154e5..ef1e10e 100644
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -2697,6 +2697,13 @@ caption {
   font-size: 16px;
 }
 
+.member-grid,
+.member-faces {
+  margin: 0;
+  padding: 0;
+  list-style: none;
+}
+
 .member-grid {
   display: grid;
   grid-template-columns: repeat(3, minmax(0, 1fr));
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/member/MemberAnswer.test.tsx src/member/MemberCancelled.test.tsx src/member/MemberPicker.test.tsx src/member/MemberSheets.test.tsx src/member/download.test.ts`

Expected: it passes. Test Files `5 passed (5)`, Tests `83 passed (83)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 2167 tests across 151 files.

- [ ] **Step 5: Commit**

```bash
git add src/member/MemberAnswer.test.tsx src/member/MemberCancelled.test.tsx src/member/MemberPicker.test.tsx src/member/MemberSheets.test.tsx src/member/download.test.ts src/member/MemberAnswer.tsx src/member/MemberCancelled.tsx src/member/MemberPicker.tsx src/member/MemberSheets.tsx src/member/download.ts src/member/fixtures.ts src/styles/app.css
git commit -m "Add the member screens"
```

---

### Task 8: Open the member page from a hash link

The page container (which screen, the header, the stale lines), the root with its own small error boundary and no organizer code, and `main.tsx` choosing the root from the hash and reloading when the join code in the hash changes. The member root never starts sync, sign-in or attendance sync.

**Files:**
- Create: `src/chooseRoot.ts`
- Modify: `src/main.tsx`
- Modify: `src/member/MemberAnswer.tsx`
- Create: `src/member/MemberPage.tsx`
- Create: `src/member/MemberRoot.tsx`
- Create: `src/chooseRoot.test.ts`
- Modify: `src/member/MemberAnswer.test.tsx`
- Create: `src/member/MemberPage.test.tsx`
- Create: `src/member/MemberRoot.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/chooseRoot.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { chooseRoot, watchJoin } from './chooseRoot';

describe('chooseRoot', () => {
  it('opens the member page for a join hash', () => {
    expect(chooseRoot('#/j/abc123')).toEqual({ kind: 'member', code: 'abc123' });
  });

  it('keeps dashes and underscores in the code', () => {
    expect(chooseRoot('#/j/a-b_C9')).toEqual({ kind: 'member', code: 'a-b_C9' });
  });

  it('opens the app for anything else', () => {
    for (const hash of ['', '#', '#/', '#/j/', '#/j/abc/extra', '#/x/abc123', '#/j/ab c', '/j/abc123', '#/j/abc?x=1']) {
      expect(chooseRoot(hash), hash).toEqual({ kind: 'app' });
    }
  });
});

describe('watchJoin', () => {
  function setup(code: string | null) {
    const listeners: (() => void)[] = [];
    const win = {
      location: { hash: '' },
      addEventListener: vi.fn((type: string, fn: () => void) => {
        expect(type).toBe('hashchange');
        listeners.push(fn);
      }),
    };
    const reload = vi.fn();
    watchJoin(code, win, reload);
    return { win, reload, fire: () => listeners.forEach((fn) => fn()) };
  }

  it('listens for hash changes once', () => {
    expect(setup('abc').win.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('reloads when the code changes', () => {
    const { win, reload, fire } = setup('abc');
    win.location.hash = '#/j/xyz';
    fire();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads when a code appears or goes away', () => {
    const appears = setup(null);
    appears.win.location.hash = '#/j/abc';
    appears.fire();
    expect(appears.reload).toHaveBeenCalledTimes(1);
    const goes = setup('abc');
    goes.win.location.hash = '';
    goes.fire();
    expect(goes.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when the code is the same, or the hash is not a join hash and there was none', () => {
    const same = setup('abc');
    same.win.location.hash = '#/j/abc';
    same.fire();
    expect(same.reload).not.toHaveBeenCalled();
    const none = setup(null);
    none.win.location.hash = '#/settings';
    none.fire();
    expect(none.reload).not.toHaveBeenCalled();
  });
});
```

Apply this patch to `src/member/MemberAnswer.test.tsx`:

```diff
diff --git a/src/member/MemberAnswer.test.tsx b/src/member/MemberAnswer.test.tsx
index 5016019..8ed072a 100644
--- a/src/member/MemberAnswer.test.tsx
+++ b/src/member/MemberAnswer.test.tsx
@@ -38,10 +38,10 @@ const answered = (id: string, status: 'in' | 'maybe' | 'out', late = false) => {
 const unanswered = (id: string) => sample({ answers: sample().answers.filter((a) => a.player_id !== id) });
 
 describe('the greeting', () => {
-  it('says Hi with the first name and shows when and where', () => {
+  it('says Hi with the first name, and leaves the when line to the page header', () => {
     setup();
     expect(screen.getByRole('heading', { name: 'Hi Ana' })).toBeInTheDocument();
-    expect(screen.getByText('Tue 10 Nov, 7 to 9 pm, Sample Hall')).toBeInTheDocument();
+    expect(screen.queryByText('Tue 10 Nov, 7 to 9 pm, Sample Hall')).toBeNull();
   });
 
   it('uses the first name only, even when the list shows a last initial', () => {
```

Create `src/member/MemberPage.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writeCached } from './cache';
import { memoryRemote, sample } from './fixtures';
import { readPick, savePick } from './identity';
import { MemberPage } from './MemberPage';
import { MemberError, type MemberReason, type MemberRemote } from './remote';

const CODE = 'abc123';
const ANA = 'p01';
const FOUR_TWELVE = new Date(2026, 10, 9, 16, 12).getTime();

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
  delete document.documentElement.dataset.theme;
  document.title = 'PIKLMatch';
  vi.restoreAllMocks();
});

const failing = (reason: MemberReason): MemberRemote => ({
  view: vi.fn(async () => {
    throw new MemberError(reason);
  }),
  answer: vi.fn(async () => undefined),
  addGuest: vi.fn(async () => undefined),
});

describe('the phases', () => {
  it('says this link cannot be opened when the build has no backend', () => {
    render(<MemberPage code={CODE} remote={null} />);
    expect(screen.getByText('This link cannot be opened in this build.')).toBeInTheDocument();
    expect(screen.getByText('PIKL')).toBeInTheDocument();
  });

  it('says it is opening the list while the first request is out', () => {
    const remote: MemberRemote = { ...memoryRemote(), view: () => new Promise(() => undefined) };
    render(<MemberPage code={CODE} remote={remote} />);
    expect(screen.getByText('Opening the list')).toBeInTheDocument();
  });

  it('says the link is not working for an unknown code', async () => {
    const remote: MemberRemote = { ...memoryRemote(), view: async () => null };
    render(<MemberPage code={CODE} remote={remote} />);
    expect(await screen.findByText('This link is not working. Ask your organizer for the new one.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says it could not open the list, with Retry, when the first request fails', async () => {
    render(<MemberPage code={CODE} remote={failing('server')} />);
    expect(await screen.findByText('Could not open the list. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).toBeNull();
  });

  it('adds an offline line when the failure was offline', async () => {
    render(<MemberPage code={CODE} remote={failing('offline')} />);
    expect(await screen.findByText('Could not open the list. Try again.')).toBeInTheDocument();
    expect(screen.getByText('You seem to be offline.')).toBeInTheDocument();
  });

  it('opens the list when Retry works', async () => {
    const remote = memoryRemote();
    const view = vi.spyOn(remote, 'view').mockRejectedValueOnce(new MemberError('offline'));
    render(<MemberPage code={CODE} remote={remote} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expect(view).toHaveBeenCalledTimes(2);
  });
});

describe('the header', () => {
  it('shows PIKL, the title and the when line on the picker', async () => {
    render(<MemberPage code={CODE} remote={memoryRemote()} />);
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expect(screen.getByText('PIKL')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Tuesday open play' })).toBeInTheDocument();
    expect(screen.getByText('Tue 10 Nov, 7 to 9 pm, Sample Hall')).toBeInTheDocument();
  });

  it('shows the same header on the answer screen, with the when line once', async () => {
    savePick(CODE, ANA);
    render(<MemberPage code={CODE} remote={memoryRemote()} />);
    expect(await screen.findByRole('heading', { name: 'Hi Ana' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Tuesday open play' })).toBeInTheDocument();
    expect(screen.getAllByText('Tue 10 Nov, 7 to 9 pm, Sample Hall')).toHaveLength(1);
  });

  it('sets the page title to the title of the view', async () => {
    render(<MemberPage code={CODE} remote={memoryRemote()} />);
    await screen.findByRole('heading', { name: 'Who are you?' });
    expect(document.title).toBe('Tuesday open play');
  });

  it('leaves the page title alone while there is no view', async () => {
    render(<MemberPage code={CODE} remote={failing('server')} />);
    await screen.findByText('Could not open the list. Try again.');
    expect(document.title).toBe('PIKLMatch');
  });
});

describe('the screens', () => {
  it('shows the picker when nobody is picked', async () => {
    render(<MemberPage code={CODE} remote={memoryRemote()} />);
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'In' })).toBeNull();
  });

  it('goes straight to the answer screen for a remembered player', async () => {
    savePick(CODE, ANA);
    render(<MemberPage code={CODE} remote={memoryRemote()} />);
    expect(await screen.findByRole('heading', { name: 'Hi Ana' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Who are you?' })).toBeNull();
  });

  it('shows the picker again when the remembered player is no longer on the roster', async () => {
    savePick(CODE, 'gone');
    render(<MemberPage code={CODE} remote={memoryRemote()} />);
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expect(readPick(CODE)).toBeNull();
  });

  it('shows the cancelled screen, with no picker and no answers, even for a remembered player', async () => {
    savePick(CODE, ANA);
    const remote = memoryRemote(sample({ cancelled: { reason: 'Venue is closed for floor repairs.' } }));
    render(<MemberPage code={CODE} remote={remote} />);
    expect(await screen.findByRole('heading', { name: 'No play this Tuesday' })).toBeInTheDocument();
    expect(screen.getByText('Venue is closed for floor repairs.')).toBeInTheDocument();
    expect(screen.getByText('Next session: Tue 17 Nov')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Tuesday open play' })).toBeInTheDocument();
  });
});

describe('the last list', () => {
  it('shows when it was updated, and that you are offline, when a refresh fails offline', async () => {
    writeCached(CODE, sample(), FOUR_TWELVE);
    render(<MemberPage code={CODE} remote={failing('offline')} />);
    expect(await screen.findByText('Offline, showing the last list')).toBeInTheDocument();
    expect(screen.getByText('Updated 4:12 pm')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
  });

  it('shows only the time for a server failure', async () => {
    writeCached(CODE, sample(), FOUR_TWELVE);
    render(<MemberPage code={CODE} remote={failing('server')} />);
    expect(await screen.findByText('Updated 4:12 pm')).toBeInTheDocument();
    expect(screen.queryByText(/Offline/)).toBeNull();
  });

  it('shows nothing about it once the list is fresh', async () => {
    writeCached(CODE, sample(), FOUR_TWELVE);
    render(<MemberPage code={CODE} remote={memoryRemote()} />);
    await screen.findByRole('heading', { name: 'Who are you?' });
    await vi.waitFor(() => expect(screen.queryByText(/^Updated/)).toBeNull());
    expect(screen.queryByText(/Offline/)).toBeNull();
  });
});

describe('the whole path', () => {
  it('opens, picks, answers, changes the answer, brings a friend, asks to join and forgets', async () => {
    const remote = memoryRemote();
    render(
      <StrictMode>
        <MemberPage code={CODE} remote={remote} />
      </StrictMode>,
    );
    // Pick Ana.
    await userEvent.click(await screen.findByRole('button', { name: 'Ana' }));
    expect(await screen.findByRole('heading', { name: 'Hi Ana' })).toBeInTheDocument();
    expect(readPick(CODE)).toBe(ANA);
    expect(screen.getByText("You're in for Tue 10 Nov.")).toBeInTheDocument();

    // Change the answer to Maybe, then Out.
    await userEvent.click(screen.getByRole('button', { name: 'Maybe' }));
    expect(await screen.findByText("You're a maybe for Tue 10 Nov. You can change this any time.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Maybe' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('4 maybe')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Out' }));
    expect(await screen.findByText("You're out for Tue 10 Nov.")).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'In' })).queryByText('Ana')).toBeNull();
    expect(screen.getByText('10 people')).toBeInTheDocument();

    // In and late.
    await userEvent.click(screen.getByRole('button', { name: "I'll arrive late" }));
    expect(await screen.findByText("You're in for Tue 10 Nov.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "I'll arrive late" })).toHaveAttribute('aria-pressed', 'true');
    expect(remote.data.answers.find((a) => a.player_id === ANA)).toEqual({ player_id: ANA, status: 'in', late: true });

    // Bring a friend.
    await userEvent.click(screen.getByRole('button', { name: 'Bring a friend' }));
    await userEvent.type(screen.getByLabelText("Friend's name"), 'Rico');
    await userEvent.click(screen.getByRole('button', { name: 'Add friend' }));
    expect((await screen.findAllByText('Added for the organizer to confirm.')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Plus 2 friends')).toBeInTheDocument();

    // Not Ana: back to the picker, and the pick is forgotten.
    await userEvent.click(screen.getByRole('button', { name: 'Not Ana?' }));
    expect(screen.getByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expect(readPick(CODE)).toBeNull();

    // Ask to join.
    await userEvent.click(screen.getByRole('button', { name: 'Not on the list? Ask to join.' }));
    await userEvent.type(screen.getByLabelText('Your name'), 'Mika');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Thanks. The organizer will see your name.')).toBeInTheDocument();
  });

  it('says there is no connection when an answer cannot be sent, and keeps the old answer', async () => {
    savePick(CODE, ANA);
    const remote = memoryRemote();
    vi.spyOn(remote, 'answer').mockRejectedValue(new MemberError('offline'));
    render(<MemberPage code={CODE} remote={remote} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No connection. Try again when you are online.');
    expect(screen.getByRole('button', { name: 'In' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a success message as a status and a failure as an alert', async () => {
    savePick(CODE, ANA);
    const remote = memoryRemote();
    render(<MemberPage code={CODE} remote={remote} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Bring a friend' }));
    await userEvent.type(screen.getByLabelText("Friend's name"), 'Rico');
    await userEvent.click(screen.getByRole('button', { name: 'Add friend' }));
    const shown = await screen.findAllByText('Added for the organizer to confirm.');
    for (const el of shown) expect(el).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the cancelled screen when the week is cancelled while answering', async () => {
    savePick(CODE, ANA);
    const remote = memoryRemote();
    render(<MemberPage code={CODE} remote={remote} />);
    await screen.findByRole('heading', { name: 'Hi Ana' });
    vi.spyOn(remote, 'answer').mockImplementation(async () => {
      remote.data = sample({ cancelled: { reason: null } });
      throw new MemberError('cancelled');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Out' }));
    expect(await screen.findByRole('heading', { name: 'No play this Tuesday' })).toBeInTheDocument();
  });
});
```

Create `src/member/MemberRoot.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// None of these may run on the member page. A call to any of them fails the test below.
const spies = vi.hoisted(() => ({ coordinator: vi.fn(() => () => undefined), attendance: vi.fn(() => () => undefined), init: vi.fn() }));
vi.mock('../sync/coordinator', () => ({ startSyncCoordinator: spies.coordinator }));
vi.mock('../sync/attendance/start', () => ({ startAttendanceSync: spies.attendance }));
vi.mock('../sync/auth', () => ({ useAuthStore: Object.assign(() => ({}), { getState: () => ({ init: spies.init }) }) }));

import { memoryRemote, sample } from './fixtures';
import { MemberRoot } from './MemberRoot';

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
  delete document.documentElement.dataset.theme;
  vi.clearAllMocks();
});

describe('MemberRoot', () => {
  it('opens the page with an injected remote', async () => {
    render(<MemberRoot code="abc123" remote={memoryRemote()} />);
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
  });

  it('says the link cannot be opened when the remote is null', () => {
    render(<MemberRoot code="abc123" remote={null} />);
    expect(screen.getByText('This link cannot be opened in this build.')).toBeInTheDocument();
  });

  it('has no backend in this build by default, so it says the same', () => {
    render(<MemberRoot code="abc123" />);
    expect(screen.getByText('This link cannot be opened in this build.')).toBeInTheDocument();
  });

  it('starts no sync, no attendance sync and no sign-in', async () => {
    render(<MemberRoot code="abc123" remote={memoryRemote()} />);
    await screen.findByRole('heading', { name: 'Who are you?' });
    expect(spies.coordinator).not.toHaveBeenCalled();
    expect(spies.attendance).not.toHaveBeenCalled();
    expect(spies.init).not.toHaveBeenCalled();
  });

  it('shows plain words and a Reload button when the page breaks', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A reason that is not text breaks the cancelled screen while it draws.
    const broken = memoryRemote(sample({ cancelled: { reason: 5 as never } }));
    render(<MemberRoot code="abc123" remote={broken} />);
    expect(await screen.findByText('Something went wrong opening this page.')).toBeInTheDocument();
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, reload }, configurable: true });
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/chooseRoot.test.ts src/member/MemberAnswer.test.tsx src/member/MemberPage.test.tsx src/member/MemberRoot.test.tsx`

Expected: it fails. Test Files `4 failed (4)`, Tests `1 failed | 44 passed (45)`.

- [ ] **Step 3: Write the code**

Create `src/chooseRoot.ts`:

```typescript
import { joinChanged, parseJoinHash } from './member/route';

export type RootChoice = { kind: 'member'; code: string } | { kind: 'app' };

/** The member page for a join hash like "#/j/abc123", the organizer app for anything else. */
export function chooseRoot(hash: string): RootChoice {
  const code = parseJoinHash(hash);
  return code ? { kind: 'member', code } : { kind: 'app' };
}

/** Reloads the page when the join code in the address changes, so a pasted link in an open tab works. */
export function watchJoin(
  code: string | null,
  win: { location: { hash: string }; addEventListener: (type: 'hashchange', fn: () => void) => void },
  reload: () => void,
): void {
  win.addEventListener('hashchange', () => {
    if (joinChanged(code, win.location.hash)) reload();
  });
}
```

Apply this patch to `src/main.tsx`:

```diff
diff --git a/src/main.tsx b/src/main.tsx
index 15249d3..89add53 100644
--- a/src/main.tsx
+++ b/src/main.tsx
@@ -4,6 +4,8 @@ import { registerSW } from 'virtual:pwa-register';
 import './styles/app.css';
 import './styles/playerSheet.css';
 import './styles/editSlot.css';
+import { chooseRoot, watchJoin } from './chooseRoot';
+import { MemberRoot } from './member/MemberRoot';
 import { useUpdateStore } from './pwa';
 import App from './ui/App';
 import { applyTheme, getInitialTheme } from './ui/theme';
@@ -19,8 +21,10 @@ const updateSW = registerSW({
   },
 });
 
+// The hash is read once. A join link opens the member page, which never mounts the app or starts sync.
+const choice = chooseRoot(location.hash);
+watchJoin(choice.kind === 'member' ? choice.code : null, window, () => location.reload());
+
 createRoot(document.getElementById('root')!).render(
-  <React.StrictMode>
-    <App />
-  </React.StrictMode>,
+  <React.StrictMode>{choice.kind === 'member' ? <MemberRoot code={choice.code} /> : <App />}</React.StrictMode>,
 );
```

Apply this patch to `src/member/MemberAnswer.tsx`:

```diff
diff --git a/src/member/MemberAnswer.tsx b/src/member/MemberAnswer.tsx
index 030a2f7..67e1bb6 100644
--- a/src/member/MemberAnswer.tsx
+++ b/src/member/MemberAnswer.tsx
@@ -2,7 +2,7 @@ import { useState } from 'react';
 import type { AttendanceStatus, AttendanceViewData } from '../sync/attendance/types';
 import { displayNames } from '../sync/attendance/links';
 import { downloadFile } from './download';
-import { busyLine, dateLabel, statusLine, whenLine } from './format';
+import { busyLine, dateLabel, statusLine } from './format';
 import { calendarFile } from './ics';
 import { FriendSheet } from './MemberSheets';
 import { MemberTile } from './MemberTile';
@@ -48,7 +48,6 @@ export function MemberAnswer({ view, me, busy, message, onAnswer, onForget, onAd
           Not {first}?
         </button>
       </div>
-      <p className="member-when">{whenLine(view)}</p>
       {mine && (
         <p className="member-banner" role="status">
           {statusLine(mine.status, dateLabel(view.play_date))}
```

Create `src/member/MemberPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { clock12, whenLine } from './format';
import { MemberAnswer } from './MemberAnswer';
import { MemberCancelled } from './MemberCancelled';
import { MemberPicker } from './MemberPicker';
import type { MemberRemote } from './remote';
import { useMemberPage, type ActionResult } from './useMemberPage';

const localClock = (at: number) => {
  const d = new Date(at);
  return clock12(d.getHours() * 60 + d.getMinutes());
};

/** The page a member opens from the group chat. Picks the screen for what the hook says. */
export function MemberPage({ code, remote }: { code: string; remote: MemberRemote | null }) {
  const page = useMemberPage(code, remote);
  const { phase, view, stale, error, me } = page;
  const { addFriend, askToJoin } = page;
  // The hook gives the words but not whether they were good news, so the successes are noted here.
  const [good, setGood] = useState<string | null>(null);

  const rememberGood = useCallback(
    async (send: (name: string) => Promise<ActionResult>, name: string) => {
      const result = await send(name);
      if (result.ok) setGood(result.message);
      return result;
    },
    [],
  );
  const onAddFriend = useCallback((name: string) => rememberGood(addFriend, name), [rememberGood, addFriend]);
  const onAskToJoin = useCallback((name: string) => rememberGood(askToJoin, name), [rememberGood, askToJoin]);

  const title = view?.title;
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  let body;
  if (phase === 'unavailable') {
    body = <p className="member-note">This link cannot be opened in this build.</p>;
  } else if (phase === 'loading') {
    body = <p className="member-note">Opening the list</p>;
  } else if (phase === 'notfound') {
    body = <p className="member-note">This link is not working. Ask your organizer for the new one.</p>;
  } else if (phase === 'failed' || !view) {
    body = (
      <div className="member-section">
        <p className="member-message" role="alert">
          Could not open the list. Try again.
        </p>
        {error === 'offline' && <p className="member-note">You seem to be offline.</p>}
        <button type="button" className="member-retry" onClick={page.retry}>
          Retry
        </button>
      </div>
    );
  } else if (view.cancelled) {
    body = <MemberCancelled view={view} />;
  } else if (!me) {
    body = <MemberPicker players={view.players} onPick={page.pick} onAskToJoin={onAskToJoin} />;
  } else {
    body = (
      <MemberAnswer
        view={view}
        me={me}
        busy={page.busy}
        message={page.message ? { text: page.message, ok: page.message === good } : null}
        onAnswer={(status, late) => void page.answer(status, late)}
        onForget={page.forget}
        onAddFriend={onAddFriend}
      />
    );
  }

  return (
    <main className="member">
      <header className="member-head">
        <span className="member-brand">PIKL</span>
        {view && <h1 className="member-title">{view.title}</h1>}
        {view && <p className="member-when">{whenLine(view)}</p>}
        {stale && <p className="member-stale">Updated {localClock(stale.at)}</p>}
        {stale?.offline && <p className="member-stale">Offline, showing the last list</p>}
      </header>
      {body}
    </main>
  );
}
```

Create `src/member/MemberRoot.tsx`:

```tsx
import { Component, type ReactNode } from 'react';
import { getMemberClient } from './client';
import { MemberPage } from './MemberPage';
import { supabaseMemberRemote, type MemberRemote } from './remote';

let made: MemberRemote | null | undefined;

/** The real remote, made once, or null in a build with no backend. */
function defaultRemote(): MemberRemote | null {
  if (made === undefined) {
    const client = getMemberClient();
    made = client ? supabaseMemberRemote(client) : null;
  }
  return made;
}

// Its own small boundary, so the member page needs nothing from the organizer app.
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('The member page failed to draw.', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="member">
        <span className="member-brand">PIKL</span>
        <p className="member-message" role="alert">
          Something went wrong opening this page.
        </p>
        <button type="button" className="member-retry" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}

/** The root for a join link. `remote` is only given by tests and the browser check. */
export function MemberRoot({ code, remote }: { code: string; remote?: MemberRemote | null }) {
  return (
    <Boundary>
      <MemberPage code={code} remote={remote === undefined ? defaultRemote() : remote} />
    </Boundary>
  );
}
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/chooseRoot.test.ts src/member/MemberAnswer.test.tsx src/member/MemberPage.test.tsx src/member/MemberRoot.test.tsx`

Expected: it passes. Test Files `4 passed (4)`, Tests `78 passed (78)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 2200 tests across 154 files.

- [ ] **Step 5: Commit**

```bash
git add src/chooseRoot.test.ts src/member/MemberAnswer.test.tsx src/member/MemberPage.test.tsx src/member/MemberRoot.test.tsx src/chooseRoot.ts src/main.tsx src/member/MemberAnswer.tsx src/member/MemberPage.tsx src/member/MemberRoot.tsx
git commit -m "Open the member page from a hash link"
```

---

### Task 9: Polish from the browser check

Found by looking at the page in a browser: the name buttons in the picker were not the full width of their cell, so the circles sat left of centre. A test first, then the fix.

**Files:**
- Modify: `src/styles/app.css`
- Modify: `src/ui/memberCss.test.ts`

- [ ] **Step 1: Write the failing tests**

Apply this patch to `src/ui/memberCss.test.ts`:

```diff
diff --git a/src/ui/memberCss.test.ts b/src/ui/memberCss.test.ts
index d874324..545b504 100644
--- a/src/ui/memberCss.test.ts
+++ b/src/ui/memberCss.test.ts
@@ -40,6 +40,10 @@ describe('Member page styles', () => {
     }
   });
 
+  it('makes each name button as wide as its grid cell, so the circle sits in the middle of the cell', () => {
+    expect(rule('.member-pick')).toMatch(/width:\s*100%/);
+  });
+
   it('draws the circles at 38 and 56 px', () => {
     expect(rule('.member-tile-sm')).toMatch(/width:\s*38px/);
     expect(rule('.member-tile-sm')).toMatch(/height:\s*38px/);
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/memberCss.test.ts`

Expected: it fails. Test Files `1 failed (1)`, Tests `1 failed | 12 passed (13)`.

- [ ] **Step 3: Write the code**

Apply this patch to `src/styles/app.css`:

```diff
diff --git a/src/styles/app.css b/src/styles/app.css
index ef1e10e..56badd6 100644
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -2711,6 +2711,7 @@ caption {
 }
 
 .member-pick {
+  width: 100%;
   min-height: 44px;
   padding: 6px 4px;
   display: flex;
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/memberCss.test.ts`

Expected: it passes. Test Files `1 passed (1)`, Tests `13 passed (13)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 2201 tests across 154 files.

- [ ] **Step 5: Commit**

```bash
git add src/ui/memberCss.test.ts src/styles/app.css
git commit -m "Polish the member page from the browser check"
```

---

### Task 10: Cover the gaps the second break-it-on-purpose run found (screens)

Tests only, added after deliberate breaks to Tasks 6 to 9 got through. They pass on the code from Tasks 6 to 9.

**Files:**
- Create: `src/main.test.ts`
- Modify: `src/member/MemberAnswer.test.tsx`
- Modify: `src/member/MemberPage.test.tsx`
- Modify: `src/member/MemberPicker.test.tsx`
- Modify: `src/member/MemberSheets.test.tsx`

- [ ] **Step 1: Add the tests**

Create `src/main.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import source from './main.tsx?raw';

// main.tsx runs on import, so it cannot be loaded in a test. These read it instead.
describe('main.tsx', () => {
  it('reads the hash once and chooses the root with chooseRoot', () => {
    expect(source).toContain("import { chooseRoot, watchJoin } from './chooseRoot';");
    expect(source.match(/chooseRoot\(location\.hash\)/g)).toHaveLength(1);
  });

  it('renders the member page for a member choice and the app otherwise, inside StrictMode', () => {
    expect(source).toMatch(/<React\.StrictMode>\{choice\.kind === 'member' \? <MemberRoot code=\{choice\.code\} \/> : <App \/>\}<\/React\.StrictMode>/);
  });

  it('reloads on a changed join hash', () => {
    expect(source).toContain("watchJoin(choice.kind === 'member' ? choice.code : null, window, () => location.reload());");
  });

  it('keeps the service worker and the update store for both roots', () => {
    expect(source).toContain('registerSW({');
    expect(source).toContain('useUpdateStore.getState().markReady');
    expect(source).toContain('applyTheme(getInitialTheme());');
  });
});
```

Apply this patch to `src/member/MemberAnswer.test.tsx`:

```diff
diff --git a/src/member/MemberAnswer.test.tsx b/src/member/MemberAnswer.test.tsx
index 8ed072a..a483ee7 100644
--- a/src/member/MemberAnswer.test.tsx
+++ b/src/member/MemberAnswer.test.tsx
@@ -219,6 +219,12 @@ describe('who is in', () => {
     expect(screen.getByText('11 people')).toBeInTheDocument();
   });
 
+  it('does not count a maybe from someone who is not on the roster', () => {
+    const view = sample({ answers: [...sample().answers, { player_id: 'gone', status: 'maybe', late: false }] });
+    setup({ view });
+    expect(screen.getByText('3 maybe')).toBeInTheDocument();
+  });
+
   it('shows no In list when nobody is in', () => {
     setup({ view: sample({ answers: [], friends: 0 }) });
     expect(screen.getByText('Nobody yet.')).toBeInTheDocument();
```

Apply this patch to `src/member/MemberPage.test.tsx`:

```diff
diff --git a/src/member/MemberPage.test.tsx b/src/member/MemberPage.test.tsx
index 2d22c59..ca435c6 100644
--- a/src/member/MemberPage.test.tsx
+++ b/src/member/MemberPage.test.tsx
@@ -230,6 +230,19 @@ describe('the whole path', () => {
     expect(screen.queryByRole('alert')).toBeNull();
   });
 
+  it('shows a failed friend as an alert, never as good news', async () => {
+    savePick(CODE, ANA);
+    const remote = memoryRemote();
+    vi.spyOn(remote, 'addGuest').mockRejectedValue(new MemberError('too_many'));
+    render(<MemberPage code={CODE} remote={remote} />);
+    await userEvent.click(await screen.findByRole('button', { name: 'Bring a friend' }));
+    await userEvent.type(screen.getByLabelText("Friend's name"), 'Rico');
+    await userEvent.click(screen.getByRole('button', { name: 'Add friend' }));
+    const shown = await screen.findAllByText('The list of new names is full. Ask your organizer.');
+    expect(shown.length).toBeGreaterThan(1);
+    for (const el of shown) expect(el).toHaveAttribute('role', 'alert');
+  });
+
   it('shows the cancelled screen when the week is cancelled while answering', async () => {
     savePick(CODE, ANA);
     const remote = memoryRemote();
```

Apply this patch to `src/member/MemberPicker.test.tsx`:

```diff
diff --git a/src/member/MemberPicker.test.tsx b/src/member/MemberPicker.test.tsx
index 40153ef..7cb11dd 100644
--- a/src/member/MemberPicker.test.tsx
+++ b/src/member/MemberPicker.test.tsx
@@ -48,6 +48,12 @@ describe('MemberPicker', () => {
     expect(screen.queryByRole('button', { name: 'Ben' })).toBeNull();
   });
 
+  it('draws the circle from the name on the button, so the two Bens differ', () => {
+    setup();
+    expect(screen.getByRole('button', { name: 'Ben C.' }).querySelector('.member-tile')).toHaveTextContent('BC');
+    expect(screen.getByRole('button', { name: 'Ben D.' }).querySelector('.member-tile')).toHaveTextContent('BD');
+  });
+
   it('picks with the player id', async () => {
     const { onPick } = setup();
     await userEvent.click(screen.getByRole('button', { name: 'Ben D.' }));
```

Apply this patch to `src/member/MemberSheets.test.tsx`:

```diff
diff --git a/src/member/MemberSheets.test.tsx b/src/member/MemberSheets.test.tsx
index 130325c..2473990 100644
--- a/src/member/MemberSheets.test.tsx
+++ b/src/member/MemberSheets.test.tsx
@@ -1,4 +1,4 @@
-import { act, render, screen } from '@testing-library/react';
+import { act, fireEvent, render, screen } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
 import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
 import type { ActionResult } from './useMemberPage';
@@ -134,6 +134,16 @@ describe('the two sheets', () => {
     expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
   });
 
+  it('ignores a second send while the first is still out', async () => {
+    const onSubmit = vi.fn(() => new Promise<ActionResult>(() => undefined));
+    render(<JoinSheet onSubmit={onSubmit} onClose={vi.fn()} />);
+    await user().type(screen.getByLabelText('Your name'), 'Mika');
+    const form = screen.getByLabelText('Your name').closest('form')!;
+    fireEvent.submit(form);
+    fireEvent.submit(form);
+    expect(onSubmit).toHaveBeenCalledTimes(1);
+  });
+
   it('stays disabled after a success, so a name is not sent twice', async () => {
     const onSubmit = vi.fn(async () => OK);
     render(<FriendSheet onSubmit={onSubmit} onClose={vi.fn()} />);
```

- [ ] **Step 2: Run them, then the whole project**

Run: `npx vitest run src/main.test.ts src/member/MemberAnswer.test.tsx src/member/MemberPage.test.tsx src/member/MemberPicker.test.tsx src/member/MemberSheets.test.tsx`

Expected: it passes. Test Files `5 passed (5)`, Tests `101 passed (101)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 2209 tests across 155 files.

- [ ] **Step 3: Commit**

```bash
git add src/main.test.ts src/member/MemberAnswer.test.tsx src/member/MemberPage.test.tsx src/member/MemberPicker.test.tsx src/member/MemberSheets.test.tsx
git commit -m "Cover a gap found by the mutation check"
```

---

### Task 11: Hide the time and place on a cancelled week

Found by looking at the screenshots: on a cancelled week the header still said "Tue 10 Nov, 7 to 9 pm, Sample Hall", which reads as if the session is on, and the date repeated below. The header now leaves that line out while the week is cancelled.

**Files:**
- Modify: `src/member/MemberPage.tsx`
- Modify: `src/member/MemberPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Apply this patch to `src/member/MemberPage.test.tsx`:

```diff
diff --git a/src/member/MemberPage.test.tsx b/src/member/MemberPage.test.tsx
index ca435c6..ba5fc77 100644
--- a/src/member/MemberPage.test.tsx
+++ b/src/member/MemberPage.test.tsx
@@ -132,6 +132,17 @@ describe('the screens', () => {
     expect(screen.queryByRole('button')).toBeNull();
     expect(screen.getByRole('heading', { level: 1, name: 'Tuesday open play' })).toBeInTheDocument();
   });
+
+  it('does not say when and where the session is while it is cancelled, but does when it is on', async () => {
+    const cancelled = render(<MemberPage code={CODE} remote={memoryRemote(sample({ cancelled: { reason: null } }))} />);
+    await screen.findByRole('heading', { name: 'No play this Tuesday' });
+    expect(screen.queryByText('Tue 10 Nov, 7 to 9 pm, Sample Hall')).toBeNull();
+    // The date is still there, once, in the notice.
+    expect(screen.getAllByText('Tue 10 Nov')).toHaveLength(1);
+    cancelled.unmount();
+    render(<MemberPage code={CODE} remote={memoryRemote()} />);
+    expect(await screen.findByText('Tue 10 Nov, 7 to 9 pm, Sample Hall')).toBeInTheDocument();
+  });
 });
 
 describe('the last list', () => {
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/member/MemberPage.test.tsx`

Expected: it fails. Test Files `1 failed (1)`, Tests `1 failed | 22 passed (23)`.

- [ ] **Step 3: Write the code**

Apply this patch to `src/member/MemberPage.tsx`:

```diff
diff --git a/src/member/MemberPage.tsx b/src/member/MemberPage.tsx
index 17a95d8..6e974db 100644
--- a/src/member/MemberPage.tsx
+++ b/src/member/MemberPage.tsx
@@ -77,7 +77,7 @@ export function MemberPage({ code, remote }: { code: string; remote: MemberRemot
       <header className="member-head">
         <span className="member-brand">PIKL</span>
         {view && <h1 className="member-title">{view.title}</h1>}
-        {view && <p className="member-when">{whenLine(view)}</p>}
+        {view && !view.cancelled && <p className="member-when">{whenLine(view)}</p>}
         {stale && <p className="member-stale">Updated {localClock(stale.at)}</p>}
         {stale?.offline && <p className="member-stale">Offline, showing the last list</p>}
       </header>
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/member/MemberPage.test.tsx`

Expected: it passes. Test Files `1 passed (1)`, Tests `23 passed (23)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 2210 tests across 155 files.

- [ ] **Step 5: Commit**

```bash
git add src/member/MemberPage.test.tsx src/member/MemberPage.tsx
git commit -m "Hide the time and place on a cancelled week"
```

---

### Task 12: Break it on purpose, then check it for real

The tests are only worth trusting if they fail when the code is wrong. This script makes 201 deliberate breaks (118 to the data layer, 83 to the screens), one at a time, runs the test files that should catch each, and puts the file back. Every break must make a test fail.

**Files:** none changed (the script restores every file).

- [ ] **Step 1: Save the script**

Save this outside the project, so a break can never be committed by accident.

Create `/tmp/mutate-member.py`:

```python
#!/usr/bin/env python3
"""Breaks the attendance member page code on purpose, one change at a time. Every break must make a listed test fail."""
import subprocess, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
# (part, file, old text, new text, test files that must fail)
BREAKS = [
 ('A', 'src/sync/attendance/links.ts', '}/#/j/${code}`;', '}/j/${code}`;', ['src/sync/attendance/links.test.ts', 'src/ui/AttendanceCard.test.tsx']),
 ('A', 'src/sync/attendance/links.ts', "origin.replace(/\\/+$/, '')", 'origin', ['src/sync/attendance/links.test.ts']),
 ('A', 'src/member/route.ts', 'const JOIN = /^#', 'const JOIN = /#', ['src/member/route.test.ts']),
 ('A', 'src/member/route.ts', '([A-Za-z0-9_-]+)$/;', '([A-Za-z0-9_-]+)/;', ['src/member/route.test.ts']),
 ('A', 'src/member/route.ts', '([A-Za-z0-9_-]+)$/;', '([A-Za-z0-9_-]*)$/;', ['src/member/route.test.ts']),
 ('A', 'src/member/route.ts', '[A-Za-z0-9_-]', '[A-Za-z0-9-]', ['src/member/route.test.ts']),
 ('A', 'src/member/route.ts', '!== previous;', '=== previous;', ['src/member/route.test.ts']),
 ('A', 'src/member/route.ts', '?.[1] ?? null', "?.[1] ?? ''", ['src/member/route.test.ts']),
 ('A', 'src/member/client.ts', 'persistSession: false', 'persistSession: true', ['src/member/client.test.ts']),
 ('A', 'src/member/client.ts', 'autoRefreshToken: false', 'autoRefreshToken: true', ['src/member/client.test.ts']),
 ('A', 'src/member/client.ts', 'detectSessionInUrl: false', 'detectSessionInUrl: true', ['src/member/client.test.ts']),
 ('A', 'src/member/client.ts', '} else if (isSecretKey(key)) {', '} else if (false) {', ['src/member/client.test.ts']),
 ('A', 'src/member/client.ts', 'if (!url || !key) {', 'if (!url && !key) {', ['src/member/client.test.ts']),
 ('A', 'src/member/client.ts', 'VITE_SUPABASE_URL?.trim()', 'VITE_SUPABASE_URL', ['src/member/client.test.ts']),
 ('A', 'src/member/client.ts', '  if (client !== undefined) return client;\n', '', ['src/member/client.test.ts']),
 ('A', 'src/member/remote.ts', "'bad_name', 'too_many'];", "'bad_name'];", ['src/member/remote.test.ts', 'src/member/remote.wire.test.ts']),
 ('A', 'src/member/remote.ts', "error.code === 'P0001' && ", '', ['src/member/remote.wire.test.ts']),
 ('A', 'src/member/remote.ts', 'code === 0 || ', '', ['src/member/remote.wire.test.ts']),
 ('A', 'src/member/remote.ts', 'navigator.onLine === false', 'navigator.onLine === true', ['src/member/remote.wire.test.ts']),
 ('A', 'src/member/remote.ts', 'failed to fetch|network|load failed|fetch failed', 'failed to fetch|load failed|fetch failed', ['src/member/remote.wire.test.ts']),
 ('A', 'src/member/remote.ts', "client.rpc('attendance_view'", "client.rpc('attendance_views'", ['src/member/remote.wire.test.ts']),
 ('A', 'src/member/remote.ts', 'p_late: late }', 'p_late: false }', ['src/member/remote.wire.test.ts']),
 ('A', 'src/member/remote.ts', 'p_brought_by: broughtBy }', 'p_brought_by: null }', ['src/member/remote.wire.test.ts']),
 ('A', 'src/member/remote.ts', 'p_status: status,', "p_status: 'in',", ['src/member/remote.wire.test.ts']),
 ('A', 'src/member/remote.ts', 'return (data as AttendanceViewData | null) ?? null;', 'return data as AttendanceViewData | null;', ['src/member/remote.wire.test.ts']),
 ('A', 'src/member/remote.ts', 'if (error) throw memberFailure(error, status);\n      return (data', 'if (error) return null;\n      return (data', ['src/member/remote.wire.test.ts']),
 ('A', 'src/member/remote.ts', '      if (res.error) throw memberFailure(res.error, res.status);\n', '', ['src/member/remote.wire.test.ts']),
 ('A', 'src/member/remote.ts', "new MemberError(offline ? 'offline' : 'server')", "new MemberError(offline ? 'server' : 'offline')", ['src/member/remote.test.ts', 'src/member/remote.wire.test.ts']),
 ('A', 'src/member/remote.ts', "error.name === 'MemberError' && ", '', ['src/member/remote.wire.test.ts']),
 ('A', 'src/member/remote.ts', 'const code = status ?? error.status;', 'const code = error.status;', ['src/member/remote.wire.test.ts']),
 ('A', 'src/member/fakeRemote.ts', "run(db, 'anon', text, params)", "run(db, { user: '00000000-0000-4000-8000-00000000000a' }, text, params)", ['src/member/fakeRemote.test.ts']),
 ('A', 'src/member/fakeRemote.ts', "    if (flags.offline) throw new MemberError('offline');\n", '', ['src/member/remote.test.ts']),
 ('A', 'src/member/fakeRemote.ts', '    flags.calls.push(call);\n', '', ['src/member/remote.test.ts']),
 ('A', 'src/member/fakeRemote.ts', '[code, playerId, status, late]', '[code, playerId, status, false]', ['src/member/remote.test.ts']),
 ('A', 'src/member/fakeRemote.ts', '[code, name, broughtBy]', '[code, name, null]', ['src/member/remote.test.ts']),
 ('A', 'src/member/identity.ts', 'const MAX_CODES = 20;', 'const MAX_CODES = 21;', ['src/member/identity.test.ts']),
 ('A', 'src/member/identity.ts', '  delete identity.picks[code];\n  identity.picks[code] = playerId;', '  identity.picks[code] = playerId;', ['src/member/identity.test.ts']),
 ('A', 'src/member/identity.ts', 'entry[1].length <= 64', 'entry[1].length <= 65', ['src/member/identity.test.ts']),
 ('A', 'src/member/identity.ts', ').version !== 1', ').version !== 2', ['src/member/identity.test.ts', 'src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/identity.ts', '  if (!(code in identity.picks)) return;\n', '', ['src/member/identity.test.ts']),
 ('A', 'src/member/identity.ts', 'kept.slice(-MAX_CODES)', 'kept.slice(0, MAX_CODES)', ['src/member/identity.test.ts']),
 ('A', 'src/member/identity.ts', "entry[1] !== '' && ", '', ['src/member/identity.test.ts']),
 ('A', 'src/member/identity.ts', 'const CODE = /^[A-Za-z0-9_-]+$/;', 'const CODE = /^[A-Za-z0-9_-]*$/;', ['src/member/identity.test.ts']),
 ('A', 'src/member/identity.ts', 'Object.entries(identity.picks).slice(-MAX_CODES)', 'Object.entries(identity.picks).slice(0, MAX_CODES)', ['src/member/identity.test.ts']),
 ('A', 'src/member/cache.ts', 'const MAX_CODES = 5;', 'const MAX_CODES = 6;', ['src/member/cache.test.ts']),
 ('A', 'src/member/cache.ts', ' || !isNumber(entry.at)', '', ['src/member/cache.test.ts']),
 ('A', 'src/member/cache.ts', "const STATUSES = ['in', 'maybe', 'out'];", "const STATUSES = ['in', 'maybe'];", ['src/member/cache.test.ts']),
 ('A', 'src/member/cache.ts', ' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(play_date)', '', ['src/member/cache.test.ts']),
 ('A', 'src/member/cache.ts', '|| !isNumber(weekday) ', '', ['src/member/cache.test.ts']),
 ('A', 'src/member/cache.ts', 'isStringOrNull(cancelled.reason)', 'true', ['src/member/cache.test.ts']),
 ('A', 'src/member/cache.ts', ' || !isNumber(friends)', '', ['src/member/cache.test.ts']),
 ('A', 'src/member/cache.ts', '  delete data.entries[code];\n  data.entries[code] = { view, at };', '  data.entries[code] = { view, at };', ['src/member/cache.test.ts']),
 ('A', 'src/member/cache.ts', 'data.version !== 1', 'data.version !== 2', ['src/member/cache.test.ts', 'src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/cache.ts', 'const CODE = /^[A-Za-z0-9_-]+$/;', 'const CODE = /^[A-Za-z0-9_-]*$/;', ['src/member/cache.test.ts']),
 ('A', 'src/member/cache.ts', "players: (players as AttendanceViewData['players']).map((p) => ({\n      id: p.id,\n      first_name: p.first_name,", "players: (players as AttendanceViewData['players']).map((p) => ({\n      id: p.id,\n      ...p,\n      first_name: p.first_name,", ['src/member/cache.test.ts']),
 ('A', 'src/member/format.ts', 'm === 0 ? `${h % 12 || 12}`', 'm === 0 ? `${h % 12}`', ['src/member/format.test.ts']),
 ('A', 'src/member/format.ts', "h % 24 < 12 ? 'am' : 'pm'", "h % 24 <= 12 ? 'am' : 'pm'", ['src/member/format.test.ts']),
 ('A', 'src/member/format.ts', 'd.getUTCDate() + 7)', 'd.getUTCDate() + 6)', ['src/member/format.test.ts']),
 ('A', 'src/member/format.ts', "String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate())", "String(d.getUTCMonth()).padStart(2, '0')}-${String(d.getUTCDate())", ['src/member/format.test.ts']),
 ('A', 'src/member/format.ts', 'WEEKDAYS[d.getUTCDay()]', 'WEEKDAYS[(d.getUTCDay() + 1) % 7]', ['src/member/format.test.ts']),
 ('A', 'src/member/format.ts', 'view.venue?.trim() || null', 'view.venue || null', ['src/member/format.test.ts']),
 ('A', 'src/member/format.ts', ' You can change this any time.', '', ['src/member/format.test.ts']),
 ('A', 'src/member/format.ts', '> 4 * view.courts', '>= 4 * view.courts', ['src/member/format.test.ts']),
 ('A', 'src/member/format.ts', "a.status === 'in' && ids", "a.status !== 'out' && ids", ['src/member/format.test.ts']),
 ('A', 'src/member/format.ts', ' && ids.has(a.player_id)', '', ['src/member/format.test.ts']),
 ('A', 'src/member/format.ts', '.length + view.friends;', '.length;', ['src/member/format.test.ts']),
 ('A', 'src/member/format.ts', "courts === 1 ? 'court' : 'courts'", "false ? 'court' : 'courts'", ['src/member/format.test.ts']),
 ('A', 'src/member/format.ts', 'a.suffix === b.suffix ?', 'a.suffix !== b.suffix ?', ['src/member/format.test.ts']),
 ('A', 'src/member/format.ts', 'Number(m[2]) - 1', 'Number(m[2])', ['src/member/format.test.ts']),
 ('A', 'src/member/format.ts', "padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;", "padStart(2, '0')}-${String(d.getUTCDate())}`;", ['src/member/format.test.ts']),
 ('A', 'src/member/ics.ts', ".replace(/;/g, '\\\\;')", '', ['src/member/ics.test.ts']),
 ('A', 'src/member/ics.ts', ".replace(/,/g, '\\\\,')", '', ['src/member/ics.test.ts']),
 ('A', 'src/member/ics.ts', "s.replace(/\\\\/g, '\\\\\\\\')", 's', ['src/member/ics.test.ts']),
 ('A', 'src/member/ics.ts', ".replace(/\\r\\n|\\r|\\n/g, '\\\\n')", ".replace(/\\n/g, '\\\\n')", ['src/member/ics.test.ts']),
 ('A', 'src/member/ics.ts', 'size + n > 75', 'size + n > 76', ['src/member/ics.test.ts']),
 ('A', 'src/member/ics.ts', '      size = 1;\n', '      size = 0;\n', ['src/member/ics.test.ts']),
 ('A', 'src/member/ics.ts', "lines.map(fold).join('\\r\\n') + '\\r\\n'", "lines.map(fold).join('\\r\\n')", ['src/member/ics.test.ts']),
 ('A', 'src/member/ics.ts', 'view.start_min + 120', 'view.start_min + 60', ['src/member/ics.test.ts']),
 ('A', 'src/member/ics.ts', 'view.end_min > view.start_min ? view.end_min : view.end_min + 1440', 'view.end_min', ['src/member/ics.test.ts']),
 ('A', 'src/member/ics.ts', '`DTSTART;VALUE=DATE:', '`DTSTART:', ['src/member/ics.test.ts']),
 ('A', 'src/member/ics.ts', 'next.getUTCDate() + 1)', 'next.getUTCDate() + 0)', ['src/member/ics.test.ts']),
 ('A', 'src/member/ics.ts', '`UID:${view.play_date}-${base}@piklmatch`', '`UID:${base}@piklmatch`', ['src/member/ics.test.ts']),
 ('A', 'src/member/ics.ts', "|| 'open-play'", "|| 'event'", ['src/member/ics.test.ts']),
 ('A', 'src/member/ics.ts', 'const venue = view.venue?.trim();', 'const venue = view.venue;', ['src/member/ics.test.ts']),
 ('A', 'src/member/ics.ts', '${clock(new Date(now))}Z`', '${clock(new Date(now))}`', ['src/member/ics.test.ts']),
 ('A', 'src/member/ics.ts', "'VERSION:2.0'", "'VERSION:1.0'", ['src/member/ics.test.ts']),
 ('A', 'src/member/ics.ts', 'pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`', 'pad(d.getUTCMonth())}${pad(d.getUTCDate())}`', ['src/member/ics.test.ts']),
 ('A', 'src/member/ics.ts', 'view.start_min === null) {', 'view.start_min === null && view.end_min === null) {', ['src/member/ics.test.ts']),
 ('A', 'src/member/ics.ts', 'name: `${base}-${view.play_date}.ics`', 'name: `${base}.ics`', ['src/member/ics.test.ts']),
 ('A', 'src/member/useMemberPage.ts', 'const POLL_MS = 30_000;', 'const POLL_MS = 31_000;', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', "document.visibilityState === 'visible' && ref", "document.visibilityState !== 'visible' && ref", ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', " && ref.current.phase !== 'notfound'", '', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', 'const data = await remote.view(code);\n      if (mine !== latest.current) return;', 'const data = await remote.view(code);', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', '} catch (error) {\n      if (mine !== latest.current) return;\n      const reason = reasonOf(error);', '} catch (error) {\n      const reason = reasonOf(error);', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', '      latest.current += 1;\n', '', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', '      clearInterval(timer);\n', '', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', "      document.removeEventListener('visibilitychange', onVisible);\n", '', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', '      writeCached(code, data, fetchedAt.current);\n', '', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', '      if (gone) forgetPick(code);\n', '', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', "const isLate = status === 'in' && late;", 'const isLate = late;', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', '!view || view.cancelled || busy', '!view || busy', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', "    if (!ref.current.view) update({ phase: 'loading', error: null });", "    update({ phase: 'loading', error: null });", ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', '...view.answers.filter((a) => a.player_id !== playerId), ', '...view.answers, ', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', "offline: reason === 'offline' }, error: reason", 'offline: false }, error: reason', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', "if (reason === 'unknown_link') update({ phase: 'notfound', view: null, stale: null, error: null });\n      else if (ref", "if (false) update({ phase: 'notfound', view: null, stale: null, error: null });\n      else if (ref", ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', "  if (reason === 'offline') return OFFLINE;\n", '', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', '        forgetPick(code);\n        update({ me: null });', '        update({ me: null });', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', 'clean.length > 40', 'clean.length > 41', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', 'const clean = name.trim();', 'const clean = name;', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', 'submitName(name, me, FRIEND_ADDED)', 'submitName(name, null, FRIEND_ADDED)', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', '      savePick(code, playerId);\n', '', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', '      if (!ref.current.view?.players.some((p) => p.id === playerId)) return;\n', '', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', 'stale: { at: cached.at, offline: false } }', 'stale: null }', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', '      update({ message: done });\n', '', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', '      if (ref.current.view) update({ view: withAnswer(ref.current.view, me, status, isLate) });\n', '', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', "if (reason === 'unknown_link') update({ phase: 'notfound', view: null, stale: null, error: null });\n      else if (reason === 'cancelled')", "if (false) update({ phase: 'notfound', view: null, stale: null, error: null });\n      else if (reason === 'cancelled')", ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', 'me: gone ? null : me }', 'me }', ['src/member/useMemberPage.test.tsx']),
 ('A', 'src/member/useMemberPage.ts', "if (!data) {\n        update({ phase: 'notfound'", "if (false) {\n        update({ phase: 'notfound'", ['src/member/useMemberPage.test.tsx']),
 ('B', 'src/member/MemberTile.tsx', 'className={`member-tile member-tile-${size}`}', 'className={`member-tile member-tile-md`}', ['src/member/MemberTile.test.tsx']),
 ('B', 'src/member/MemberTile.tsx', 'aria-hidden="true"', 'aria-hidden="false"', ['src/member/MemberPage.test.tsx', 'src/member/MemberPicker.test.tsx', 'src/member/MemberTile.test.tsx']),
 ('B', 'src/member/MemberTile.tsx', "'--h': nameHue(name) }", "'--h': nameHue(name) + 1 }", ['src/member/MemberTile.test.tsx']),
 ('B', 'src/member/MemberTile.tsx', "size = 'md'", "size = 'sm'", ['src/member/MemberTile.test.tsx']),
 ('B', 'src/styles/app.css', 'background: hsl(var(--h) 42% 32%);', 'background: hsl(var(--h) 42% 52%);', ['src/ui/memberCss.test.ts']),
 ('B', 'src/styles/app.css', '.member-chip {\n  min-height: 44px;', '.member-chip {\n  min-height: 40px;', ['src/ui/memberCss.test.ts']),
 ('B', 'src/styles/app.css', '  color: var(--ink);\n  font-size: 16px;\n}\n\n.member-grid,', '  color: var(--ink);\n  font-size: 15px;\n}\n\n.member-grid,', ['src/ui/memberCss.test.ts']),
 ('B', 'src/styles/app.css', '.member-input {\n  width: 100%;\n  min-height: 44px;', '.member-input {\n  width: 100%;\n  min-height: 40px;', ['src/ui/memberCss.test.ts']),
 ('B', 'src/styles/app.css', '.member-pick {\n  width: 100%;', '.member-pick {\n  width: auto;', ['src/ui/memberCss.test.ts']),
 ('B', 'src/styles/app.css', '  color: #fff;\n  font-weight: 700;\n  line-height: 1;', '  color: #eee;\n  font-weight: 700;\n  line-height: 1;', ['src/ui/memberCss.test.ts']),
 ('B', 'src/styles/app.css', 'background: var(--accent);\n  color: var(--accent-ink);\n}\n\n.member-answer:disabled', 'background: var(--ink);\n  color: var(--accent-ink);\n}\n\n.member-answer:disabled', ['src/ui/memberCss.test.ts']),
 ('B', 'src/styles/app.css', ".member-message[role='alert'] {\n  color: var(--danger);", ".member-message[role='alert'] {\n  color: red;", ['src/ui/memberCss.test.ts']),
 ('B', 'src/styles/app.css', '.member-brand {\n  font-size: 13px;', '.member-brand {\n  color: #123456;\n  font-size: 13px;', ['src/ui/memberCss.test.ts']),
 ('B', 'src/styles/app.css', '/* Member page */\n/* What a club', '/* Members */\n/* What a club', ['src/ui/attendanceCss.test.ts', 'src/ui/cssBalance.test.ts', 'src/ui/memberCss.test.ts']),
 ('B', 'src/styles/app.css', '.member-tile-sm {\n  width: 38px;', '.member-tile-sm {\n  width: 36px;', ['src/ui/memberCss.test.ts']),
 ('B', 'src/styles/app.css', '  line-height: 1.15;\n  overflow-wrap: anywhere;', '  line-height: 1.15;\n  overflow-wrap: normal;', ['src/ui/memberCss.test.ts']),
 ('B', 'src/styles/app.css', '.member {\n  max-width: 480px;', '.member {\n  max-width: 600px;', ['src/ui/memberCss.test.ts']),
 ('B', 'src/styles/app.css', '.member-note {\n  color: var(--muted);\n  font-size: 14px;\n}', '.member-note {\n  color: var(--muted);\n  font-size: 14px;\n', ['src/ui/cssBalance.test.ts']),
 ('B', 'src/member/MemberPicker.tsx', 'names[p.id].toLowerCase().includes(needle)', 'names[p.id].includes(needle)', ['src/member/MemberPicker.test.tsx']),
 ('B', 'src/member/MemberPicker.tsx', 'query.trim().toLowerCase()', 'query.toLowerCase()', ['src/member/MemberPicker.test.tsx']),
 ('B', 'src/member/MemberPicker.tsx', 'onClick={() => onPick(p.id)}', 'onClick={() => onPick(names[p.id])}', ['src/member/MemberPage.test.tsx', 'src/member/MemberPicker.test.tsx']),
 ('B', 'src/member/MemberPicker.tsx', 'players.length === 0 ?', 'players.length === 1 ?', ['src/member/MemberPicker.test.tsx']),
 ('B', 'src/member/MemberPicker.tsx', '<p className="member-note">No match.</p>', '<p className="member-note">No matches.</p>', ['src/member/MemberPicker.test.tsx']),
 ('B', 'src/member/MemberPicker.tsx', '{asking && <JoinSheet', '{false && <JoinSheet', ['src/member/MemberPage.test.tsx', 'src/member/MemberPicker.test.tsx']),
 ('B', 'src/member/MemberPicker.tsx', '<MemberTile name={names[p.id]} />', '<MemberTile name={p.first_name} />', ['src/member/MemberPicker.test.tsx']),
 ('B', 'src/member/MemberPicker.tsx', 'First names only. No account.', 'First names only.', ['src/member/MemberPicker.test.tsx']),
 ('B', 'src/member/MemberAnswer.tsx', 'aria-pressed={mine?.status === s}', 'aria-pressed={mine?.status !== s}', ['src/member/MemberAnswer.test.tsx', 'src/member/MemberPage.test.tsx']),
 ('B', 'src/member/MemberAnswer.tsx', 'disabled={busy}\n            // Tapping', 'disabled={false}\n            // Tapping', ['src/member/MemberAnswer.test.tsx']),
 ('B', 'src/member/MemberAnswer.tsx', "onAnswer('in', !lateOn)", "onAnswer('in', true)", ['src/member/MemberAnswer.test.tsx']),
 ('B', 'src/member/MemberAnswer.tsx', 'inPeople.slice(0, FACES)', 'inPeople.slice(0, FACES + 1)', ['src/member/MemberAnswer.test.tsx']),
 ('B', 'src/member/MemberAnswer.tsx', 'const FACES = 12;', 'const FACES = 10;', ['src/member/MemberAnswer.test.tsx']),
 ('B', 'src/member/MemberAnswer.tsx', '{maybe > 0 &&', '{maybe >= 0 &&', ['src/member/MemberAnswer.test.tsx']),
 ('B', 'src/member/MemberAnswer.tsx', '{view.friends > 0 &&', '{view.friends >= 0 &&', ['src/member/MemberAnswer.test.tsx']),
 ('B', 'src/member/MemberAnswer.tsx', "{view.friends === 1 ? 'friend' : 'friends'}", "{view.friends === 1 ? 'friends' : 'friends'}", ['src/member/MemberAnswer.test.tsx']),
 ('B', 'src/member/MemberAnswer.tsx', "role={message.ok ? 'status' : 'alert'}", "role={message.ok ? 'alert' : 'status'}", ['src/member/MemberAnswer.test.tsx', 'src/member/MemberPage.test.tsx']),
 ('B', 'src/member/MemberAnswer.tsx', 'Not {first}?', 'Not you?', ['src/member/MemberAnswer.test.tsx', 'src/member/MemberPage.test.tsx']),
 ('B', 'src/member/MemberAnswer.tsx', "filter((s) => s === 'maybe')", "filter((s) => s === 'in')", ['src/member/MemberAnswer.test.tsx', 'src/member/MemberPage.test.tsx']),
 ('B', 'src/member/MemberAnswer.tsx', "status.get(p.id) === 'in')", "status.get(p.id) !== 'out')", ['src/member/MemberAnswer.test.tsx', 'src/member/MemberPage.test.tsx']),
 ('B', 'src/member/MemberAnswer.tsx', 'view.answers.filter((a) => onRoster.has(a.player_id))', 'view.answers.filter(() => true)', ['src/member/MemberAnswer.test.tsx']),
 ('B', 'src/member/MemberAnswer.tsx', 'downloadFile(file.name, file.text)', 'downloadFile(file.text, file.name)', ['src/member/MemberAnswer.test.tsx']),
 ('B', 'src/member/MemberAnswer.tsx', '{friend && <FriendSheet', '{!friend && <FriendSheet', ['src/member/MemberAnswer.test.tsx', 'src/member/MemberPage.test.tsx']),
 ('B', 'src/member/MemberAnswer.tsx', 'Hi {first}</h2>', 'Hello {first}</h2>', ['src/member/MemberAnswer.test.tsx', 'src/member/MemberPage.test.tsx']),
 ('B', 'src/member/MemberAnswer.tsx', "(s === 'in' ? onAnswer('in', lateOn) : onAnswer(s))", '(onAnswer(s))', ['src/member/MemberAnswer.test.tsx']),
 ('B', 'src/member/MemberAnswer.tsx', "inPeople.length === 1 ? '1 person'", "inPeople.length === 2 ? '1 person'", ['src/member/MemberAnswer.test.tsx']),
 ('B', 'src/member/MemberCancelled.tsx', 'nextWeek(view.play_date)', 'view.play_date', ['src/member/MemberCancelled.test.tsx', 'src/member/MemberPage.test.tsx']),
 ('B', 'src/member/MemberCancelled.tsx', "timeZone: 'UTC'", "timeZone: 'Pacific/Pago_Pago'", ['src/member/MemberCancelled.test.tsx', 'src/member/MemberPage.test.tsx']),
 ('B', 'src/member/MemberCancelled.tsx', '{reason && <p', '{true && <p', ['src/member/MemberCancelled.test.tsx']),
 ('B', 'src/member/MemberCancelled.tsx', 'view.cancelled?.reason?.trim()', 'view.cancelled?.reason', ['src/member/MemberCancelled.test.tsx', 'src/member/MemberRoot.test.tsx']),
 ('B', 'src/member/MemberSheets.tsx', 'const SHOW_MS = 1500;', 'const SHOW_MS = 15000;', ['src/member/MemberSheets.test.tsx']),
 ('B', 'src/member/MemberSheets.tsx', 'maxLength={40}', 'maxLength={41}', ['src/member/MemberSheets.test.tsx']),
 ('B', 'src/member/MemberSheets.tsx', 'clean.length < 1 ||', 'clean.length < 0 ||', ['src/member/MemberSheets.test.tsx']),
 ('B', 'src/member/MemberSheets.tsx', "role={shown.ok ? 'status' : 'alert'}", "role={shown.ok ? 'alert' : 'status'}", ['src/member/MemberPage.test.tsx', 'src/member/MemberSheets.test.tsx']),
 ('B', 'src/member/MemberSheets.tsx', "if (result.message === '') closeRef.current();", "if (result.message === '') void 0;", ['src/member/MemberSheets.test.tsx']),
 ('B', 'src/member/MemberSheets.tsx', 'if (pending) return;', '', ['src/member/MemberSheets.test.tsx']),
 ('B', 'src/member/MemberSheets.tsx', '    setPending(false);\n    // A failure', '    // A failure', ['src/member/MemberSheets.test.tsx']),
 ('B', 'src/member/MemberSheets.tsx', 'await onSubmit(clean)', 'await onSubmit(name)', ['src/member/MemberSheets.test.tsx']),
 ('B', 'src/member/MemberSheets.tsx', 'if (timer.current) clearTimeout(timer.current);', '', ['src/member/MemberSheets.test.tsx']),
 ('B', 'src/member/MemberSheets.tsx', 'title="Bring a friend"', 'title="Bring friend"', ['src/member/MemberAnswer.test.tsx', 'src/member/MemberSheets.test.tsx']),
 ('B', 'src/member/MemberPage.tsx', 'ok: page.message === good', 'ok: true', ['src/member/MemberPage.test.tsx']),
 ('B', 'src/member/MemberPage.tsx', "{error === 'offline' &&", "{error !== 'offline' &&", ['src/member/MemberPage.test.tsx']),
 ('B', 'src/member/MemberPage.tsx', '{stale?.offline &&', '{stale &&', ['src/member/MemberPage.test.tsx']),
 ('B', 'src/member/MemberPage.tsx', 'd.getHours() * 60 + d.getMinutes()', 'd.getHours() * 60', ['src/member/MemberPage.test.tsx']),
 ('B', 'src/member/MemberPage.tsx', '} else if (view.cancelled) {', '} else if (!view.cancelled) {', ['src/member/MemberPage.test.tsx', 'src/member/MemberRoot.test.tsx']),
 ('B', 'src/member/MemberPage.tsx', '} else if (!me) {', '} else if (me) {', ['src/member/MemberPage.test.tsx', 'src/member/MemberRoot.test.tsx']),
 ('B', 'src/member/MemberPage.tsx', 'if (title) document.title = title;', "if (title) document.title = 'PIKLMatch';", ['src/member/MemberPage.test.tsx']),
 ('B', 'src/member/MemberPage.tsx', '<span className="member-brand">PIKL</span>', '<span className="member-brand">PIKLMatch</span>', ['src/member/MemberPage.test.tsx']),
 ('B', 'src/member/MemberPage.tsx', 'onClick={page.retry}', 'onClick={() => undefined}', ['src/member/MemberPage.test.tsx']),
 ('B', 'src/member/MemberPage.tsx', 'This link cannot be opened in this build.', 'This link cannot be opened.', ['src/member/MemberPage.test.tsx', 'src/member/MemberRoot.test.tsx']),
 ('B', 'src/member/MemberPage.tsx', 'if (result.ok) setGood(result.message);', 'setGood(result.message);', ['src/member/MemberPage.test.tsx']),
 ('B', 'src/member/MemberRoot.tsx', 'remote === undefined ? defaultRemote() : remote', 'defaultRemote()', ['src/member/MemberRoot.test.tsx']),
 ('B', 'src/member/MemberRoot.tsx', 'onClick={() => window.location.reload()}', 'onClick={() => undefined}', ['src/member/MemberRoot.test.tsx']),
 ('B', 'src/member/MemberRoot.tsx', 'return { failed: true };', 'return { failed: false };', ['src/member/MemberRoot.test.tsx']),
 ('B', 'src/chooseRoot.ts', "return code ? { kind: 'member', code } : { kind: 'app' };", "return code ? { kind: 'app' } : { kind: 'member', code: '' };", ['src/chooseRoot.test.ts']),
 ('B', 'src/chooseRoot.ts', 'if (joinChanged(code, win.location.hash)) reload();', 'if (!joinChanged(code, win.location.hash)) reload();', ['src/chooseRoot.test.ts']),
 ('B', 'src/chooseRoot.ts', "win.addEventListener('hashchange'", "win.addEventListener('popstate'", ['src/chooseRoot.test.ts']),
 ('B', 'src/main.tsx', 'chooseRoot(location.hash)', "chooseRoot('')", ['src/main.test.ts']),
 ('B', 'src/main.tsx', "choice.kind === 'member' ? <MemberRoot code={choice.code} /> : <App />", "choice.kind === 'member' ? <App /> : <MemberRoot code='' />", ['src/main.test.ts']),
 ('B', 'src/main.tsx', 'window, () => location.reload());', 'window, () => undefined);', ['src/main.test.ts']),
 ('B', 'src/member/download.ts', "type: 'text/calendar;charset=utf-8'", "type: 'text/plain'", ['src/member/download.test.ts']),
 ('B', 'src/member/download.ts', 'link.download = name;', "link.download = '';", ['src/member/download.test.ts']),
 ('B', 'src/member/download.ts', 'URL.revokeObjectURL(url)', "URL.revokeObjectURL('x')", ['src/member/download.test.ts']),
 ('B', 'src/member/download.ts', '  link.remove();\n', '', ['src/member/download.test.ts']),
 ('B', 'src/member/MemberPage.tsx', '{view && !view.cancelled && <p className="member-when">{whenLine(view)}</p>}', '{view && <p className="member-when">{whenLine(view)}</p>}', ['src/member/MemberPage.test.tsx']),
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

Run: `python3 /tmp/mutate-member.py .`

Expected, last line: `201 of 201 killed; survived: []; entries that did not match exactly once: []`

If a break survives, a test is missing: add the test, do not change the break. Afterwards run `git status --short` and expect nothing, because the script restores every file.

- [ ] **Step 3: Check it for real, on the real project**

The tests ran on an in-memory Postgres and a stub of the network. The real path has not run until a link is opened on a real phone. After this ships:

1. On the organizer's phone: Settings, "Attendance link (preview)" on, sign in, Create link, Share (or copy). The link looks like `https://piklmatch.vercel.app/#/j/` and a random code.
2. Open that link on a second phone, or in a private tab. Expect the list of first names. Tap a name, then In. Expect "You're in for ..." and the organizer's card count to go up within a minute.
3. Try Maybe, Out, "I'll arrive late", Bring a friend (the organizer card shows "1 friend" and "1 new name to review"), Ask to join, Add to calendar (the file should open in the calendar app), "Not Ana?" under your name, using your own name (the picker returns).
4. On the organizer's phone: Cancel this week with a reason. Expect the member page to show "No play this ..." and the next session date within a minute. Undo it.
5. Reset link. Expect the old link to say "This link is not working. Ask your organizer for the new one."
6. Turn on airplane mode on the member phone. Expect the last list with "Updated ..." and "Offline, showing the last list".
7. Do not send the link to the club until this is done. The preview switch stays on until you decide.

Seen in the dev check (390 by 844 and 320 by 568, light and dark, 24 states, with an in-memory remote): no sideways scroll, nothing outside the screen, no tap target under 44 px, no field under 16 px, no console errors, no request to Supabase. Not seen: a real phone, the Safari download of the calendar file, or the real network path.

- [ ] **Step 4: Nothing is pushed by this plan**

Shipping is a fast-forward of production after the owner says so. The plan changes no database, so there is no migration to apply.

---

## Self-review

- **Spec coverage.** Screens 1 (who are you), 2 (answers) and 6 (cancelled) of the sketch are built, with "Not Ana?", bring a friend, ask to join, the late chip, the busy line, the confirmation naming the date, Maybe as a count and Add to calendar. Audit findings P1, P2, P3, P4, P5 (the cancelled state), P7 and the member side of O4 are covered.
- **Not built, on purpose.** Screen 5 ("after play starts": the database has no started state, so answers stay open until the date rolls); the optional "answer by" note (needs a database column); photos (the photo bucket is private, so the page shows initials); the live "find my name" view; marking the organizer In. Removing the preview switch and fixing the short-phone clipping of the slot card come after the real check.
- **Placeholders.** None. Every file is complete and every step has its command and expected result.
- **Names.** Types, hook fields and component props match across tasks because every task is a proven commit.
- **Known limits.** The view the database returns includes every member's answer, Out included, with the player list. The page never shows them, but anyone who calls the function directly with the link's code can read them. That is the same information the group chat list shows today. A one-line main-entry test (`main.test.ts`) checks wiring by reading the source, not by running it. The calendar file is tested against the format, not against Apple, Google or Outlook. Polling and visibility are tested with fake timers, not a real clock. The real network path from the page has not run.
