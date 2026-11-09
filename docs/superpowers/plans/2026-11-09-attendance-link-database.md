# Attendance link, Plan 1 of 4: the database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the attendance link a home in the database: a link per weekly slot with a random code, members' answers, names waiting for the organizer, cancellations, and three locked-down functions a visitor with the code can call.

**Architecture:** One migration adds four tables (closed to anonymous visitors, each organizer sees only their own rows) and six functions, and widens the existing purge so "Delete all my data" removes attendance data too. Three functions are public and narrow: view, answer and add a guest, each taking the code. One lets an organizer reset a code, one makes the random code, and one works out which date a link is about, in the link's own time zone. The tests run on the in-memory Postgres the project already uses (PGlite), in `src/sync/db/`.

**Tech Stack:** Postgres (Supabase), PGlite, Vitest. No new dependencies, and no change to the app screens.

Design and audit: `docs/superpowers/specs/2026-11-09-attendance-link.md`. Pictures: `docs/superpowers/sketches/attendance-v2.png`.

**Where this fits.** Plan 1 of 4: the database (this plan), the organizer side, the public page, the session flow.
Nothing in the app changes after this plan. It is built and proven first so the other plans stand on it.

**Before you start.** Work from a clean checkout of production (`origin/claude/pickleball-matchmaking-app-i4baca`, commit `57ce997` or later). Baseline: 1476 tests across 119 files, `npx tsc --noEmit` clean. After this plan: 1523 tests across 121 files. Node modules are already installed. Staging is by file name, never `git add -A`.

**Two rules that matter here.**
- Visitors get no access to any table. Only the three public functions, and only with a code.
- The public view never returns a full name, an owner id or an email.

## File structure

| File | Job |
|---|---|
| `supabase/migrations/20261109120000_attendance_links.sql` | The four tables, their rules and grants, six functions, and the wider purge (`delete_my_players`) |
| `src/sync/db/attendance.test.ts` | Behaviour: codes, who can touch what, what the page shows, which date, answering, friends and new names |
| `src/sync/db/attendanceGrants.test.ts` | The same rules with no default grants, so a forgotten `grant` shows up |
| four existing test files | One line each: `truncate public.players` becomes `truncate public.players cascade`, because answers now reference players |

---

### Task 1: The tests first

**Files:**
- Modify: `src/sync/engine.test.ts`, `src/sync/db/players.test.ts`, `src/sync/dataActions.test.ts`, `src/sync/db/purge.test.ts`
- Create: `src/sync/db/attendance.test.ts`, `src/sync/db/attendanceGrants.test.ts`

- [ ] **Step 1: Let the existing roster tests truncate with cascade**

Postgres refuses `truncate public.players` once another table points at it, and the new tables will. Run:

```bash
perl -pi -e "s/truncate public\.players'/truncate public.players cascade'/" src/sync/engine.test.ts src/sync/db/players.test.ts src/sync/dataActions.test.ts src/sync/db/purge.test.ts
git diff --stat
```

Expected: 4 files changed, 4 insertions, 4 deletions.

- [ ] **Step 2: Write the failing tests**

Create `src/sync/db/attendance.test.ts`:

```typescript
// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { USER_A, USER_B, createDb, run } from './harness';

const ANA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const CY = '33333333-3333-4333-8333-333333333333';
const ZED = '99999999-9999-4999-8999-999999999999';

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => {
  await db.close();
});

/** Two organizers. A has Ana Reyes, Ben Cruz (removed) and Cy. B has Zed. A has one Tuesday link. */
beforeEach(async () => {
  await db.exec('truncate public.players, public.attendance_links cascade');
  await db.exec(`
    insert into public.players (owner_id, id, name, photo_version, photo_seq, deleted_at) values
      ('${USER_A}', '${ANA}', 'Ana Reyes', 2, 3, null),
      ('${USER_A}', '${BEN}', 'Ben Cruz', 0, 0, now()),
      ('${USER_A}', '${CY}', 'Cy', 0, 0, null),
      ('${USER_B}', '${ZED}', 'Zed Zane', 0, 0, null);
    insert into public.attendance_links (owner_id, slot_id, title, weekday, start_min, end_min, venue, courts) values
      ('${USER_A}', 'tue', 'Tuesday open play', 2, 1140, 1260, 'Sample Hall', 3);
  `);
});

async function codeOfTue(): Promise<string> {
  return ((await db.query<{ code: string }>("select code from public.attendance_links where slot_id = 'tue'")).rows[0]).code;
}

type View = {
  title: string; weekday: number; venue: string | null; start_min: number | null; end_min: number | null; courts: number | null;
  play_date: string; cancelled: { reason: string | null } | null;
  players: { id: string; first_name: string; last_initial: string | null; has_photo: boolean; photo_seq: number }[];
  answers: { player_id: string; status: string; late: boolean }[];
  friends: number;
};
async function view(code: string, caller: 'anon' | { user: string } = 'anon'): Promise<View | null> {
  const r = await run(db, caller, 'select public.attendance_view($1) as v', [code]);
  return (r.rows[0] as { v: View | null }).v;
}
const answer = (code: string, player: string, status: string, late = false) =>
  run(db, 'anon', 'select public.attendance_answer($1, $2, $3, $4) as r', [code, player, status, late]);
const addGuest = (code: string, name: string, by: string | null = null) =>
  run(db, 'anon', 'select public.attendance_add_guest($1, $2, $3) as r', [code, name, by]);
const playDate = async (weekday: number, closed: string | null, tz: string, endMin: number | null, now: string) =>
  (await db.query<{ d: string }>(
    "select to_char(public.attendance_play_date($1::smallint, $2::date, $3, $4::integer, $5::timestamptz), 'YYYY-MM-DD Dy') as d",
    [weekday, closed, tz, endMin, now],
  )).rows[0].d;

describe('the link and its code', () => {
  it('gives each link a random 24 character code, different every time', async () => {
    const a = await codeOfTue();
    expect(a).toMatch(/^[0-9a-f]{24}$/);
    await run(db, { user: USER_A }, "insert into public.attendance_links (slot_id, title, weekday) values ('wed', 'Wednesday', 3)");
    const b = ((await db.query<{ code: string }>("select code from public.attendance_links where slot_id = 'wed'")).rows[0]).code;
    expect(b).toMatch(/^[0-9a-f]{24}$/);
    expect(b).not.toBe(a);
  });

  it('fills in the owner from the signed-in organizer', async () => {
    await run(db, { user: USER_B }, "insert into public.attendance_links (slot_id, title, weekday) values ('tue', 'B Tuesday', 2)");
    const rows = (await db.query<{ owner_id: string }>("select owner_id from public.attendance_links where title = 'B Tuesday'")).rows;
    expect(rows).toEqual([{ owner_id: USER_B }]);
  });

  it('refuses a bad slot id, weekday, title, courts or short code', async () => {
    const insert = (cols: string, vals: string) => run(db, { user: USER_A }, `insert into public.attendance_links (${cols}) values (${vals})`);
    await expect(insert('slot_id, title, weekday', "'Bad Id', 'x', 2")).rejects.toThrow(/check constraint/i);
    await expect(insert('slot_id, title, weekday', "'a', 'x', 7")).rejects.toThrow(/check constraint/i);
    await expect(insert('slot_id, title, weekday', "'b', '  ', 2")).rejects.toThrow(/check constraint/i);
    await expect(insert('slot_id, title, weekday, courts', "'c', 'x', 2, 13")).rejects.toThrow(/check constraint/i);
    await expect(insert('slot_id, title, weekday, code', "'d', 'x', 2, 'short'")).rejects.toThrow(/check constraint/i);
  });

  it('never lets two links share a code', async () => {
    const code = await codeOfTue();
    await expect(
      run(db, { user: USER_B }, "insert into public.attendance_links (slot_id, title, weekday, code) values ('tue', 'B', 2, $1)", [code]),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('resets the code, keeps the answers and stops the old code working', async () => {
    const old = await codeOfTue();
    await answer(old, ANA, 'in');
    const fresh = (await run(db, { user: USER_A }, "select public.reset_attendance_link('tue') as c")).rows[0] as { c: string };
    expect(fresh.c).toMatch(/^[0-9a-f]{24}$/);
    expect(fresh.c).not.toBe(old);
    expect(await view(old)).toBeNull();
    expect((await view(fresh.c))?.answers).toEqual([{ player_id: ANA, status: 'in', late: false }]);
  });

  it('does not let one organizer reset another organizer\'s link', async () => {
    const before = await codeOfTue();
    const r = await run(db, { user: USER_B }, "select public.reset_attendance_link('tue') as c");
    expect((r.rows[0] as { c: string | null }).c).toBeNull();
    expect(await codeOfTue()).toBe(before);
  });
});

describe('who can touch what', () => {
  it('shuts anonymous visitors out of every table', async () => {
    for (const t of ['attendance_links', 'attendance_answers', 'attendance_guests', 'attendance_cancellations']) {
      await expect(run(db, 'anon', `select * from public.${t}`)).rejects.toThrow(/permission denied/i);
      await expect(run(db, 'anon', `delete from public.${t}`)).rejects.toThrow(/permission denied/i);
    }
    await expect(run(db, 'anon', "insert into public.attendance_links (owner_id, slot_id, title, weekday) values ($1, 'x', 'x', 1)", [USER_A])).rejects.toThrow(/permission denied/i);
  });

  it('keeps the organizer functions away from anonymous visitors', async () => {
    await expect(run(db, 'anon', "select public.reset_attendance_link('tue')")).rejects.toThrow(/permission denied/i);
    await expect(run(db, 'anon', 'select public.new_attendance_code()')).rejects.toThrow(/permission denied/i);
    await expect(
      run(db, 'anon', "select public.attendance_play_date(2::smallint, null, 'UTC', null, now())"),
    ).rejects.toThrow(/permission denied/i);
  });

  it('has the database itself refuse a long waiting name, not only the function', async () => {
    await expect(
      db.query("insert into public.attendance_guests (owner_id, slot_id, play_date, name) values ($1, 'tue', '2026-11-10', $2)", [USER_A, 'x'.repeat(41)]),
    ).rejects.toThrow(/check constraint/i);
  });

  it('gives anonymous visitors the right to run only the three public functions', async () => {
    const can = async (fn: string) =>
      ((await db.query<{ ok: boolean }>("select has_function_privilege('anon', $1, 'execute') as ok", [fn])).rows[0]).ok;
    expect(await can('public.attendance_view(text)')).toBe(true);
    expect(await can('public.attendance_answer(text, uuid, text, boolean)')).toBe(true);
    expect(await can('public.attendance_add_guest(text, text, uuid)')).toBe(true);
    expect(await can('public.reset_attendance_link(text)')).toBe(false);
    expect(await can('public.new_attendance_code()')).toBe(false);
    expect(await can('public.attendance_play_date(smallint, date, text, integer, timestamptz)')).toBe(false);
  });

  it('hides one organizer\'s rows from another', async () => {
    const code = await codeOfTue();
    await answer(code, ANA, 'in');
    await addGuest(code, 'Mika');
    await run(db, { user: USER_A }, "insert into public.attendance_cancellations (slot_id, play_date) values ('tue', '2026-11-10')");
    for (const t of ['attendance_links', 'attendance_answers', 'attendance_guests', 'attendance_cancellations']) {
      expect((await run(db, { user: USER_B }, `select * from public.${t}`)).rows).toEqual([]);
      expect((await run(db, { user: USER_A }, `select * from public.${t}`)).rows.length).toBeGreaterThan(0);
    }
  });

  it('does not let an organizer write answers, cancellations or links for someone else', async () => {
    await expect(
      run(db, { user: USER_B }, "insert into public.attendance_answers (owner_id, slot_id, play_date, player_id, status) values ($1, 'tue', '2026-11-10', $2, 'in')", [USER_A, ANA]),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      run(db, { user: USER_B }, "insert into public.attendance_cancellations (owner_id, slot_id, play_date) values ($1, 'tue', '2026-11-10')", [USER_A]),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      run(db, { user: USER_B }, "insert into public.attendance_links (owner_id, slot_id, title, weekday) values ($1, 'zz', 'x', 1)", [USER_A]),
    ).rejects.toThrow(/row-level security/i);
  });

  it('gives no one the right to hard-delete links, answers or guests', async () => {
    for (const t of ['attendance_links', 'attendance_answers', 'attendance_guests']) {
      await expect(run(db, { user: USER_A }, `delete from public.${t}`)).rejects.toThrow(/permission denied/i);
    }
  });

  it('lets an organizer mark themselves in and decide on a waiting name', async () => {
    const code = await codeOfTue();
    await run(db, { user: USER_A }, "insert into public.attendance_answers (slot_id, play_date, player_id, status) values ('tue', '2026-11-10', $1, 'in')", [CY]);
    await addGuest(code, 'Mika');
    await run(db, { user: USER_A }, "update public.attendance_guests set state = 'dismissed'");
    expect((await db.query("select state from public.attendance_guests")).rows).toEqual([{ state: 'dismissed' }]);
  });

  it('refuses an answer that is late but not In', async () => {
    await expect(
      run(db, { user: USER_A }, "insert into public.attendance_answers (slot_id, play_date, player_id, status, late) values ('tue', '2026-11-10', $1, 'maybe', true)", [CY]),
    ).rejects.toThrow(/check constraint/i);
  });

  it('removes every attendance row of the caller when the roster is purged, and only theirs', async () => {
    const code = await codeOfTue();
    await answer(code, ANA, 'in');
    await addGuest(code, 'Rico', ANA);
    await addGuest(code, 'Mika');
    await run(db, { user: USER_A }, "insert into public.attendance_cancellations (slot_id, play_date) values ('tue', '2026-11-10')");
    await run(db, { user: USER_B }, "insert into public.attendance_links (slot_id, title, weekday) values ('sat', 'B Saturday', 6)");
    const result = await run(db, { user: USER_A }, 'select public.delete_my_players() as removed');
    expect(result.rows).toEqual([{ removed: 3 }]);
    for (const t of ['attendance_answers', 'attendance_guests', 'attendance_cancellations']) {
      expect((await db.query(`select * from public.${t}`)).rows).toEqual([]);
    }
    expect((await db.query<{ owner_id: string }>('select owner_id from public.attendance_links')).rows).toEqual([{ owner_id: USER_B }]);
    expect((await db.query('select id from public.players')).rows).toEqual([{ id: ZED }]);
  });
});

describe('what the public page can see', () => {
  it('says nothing for a code that does not exist', async () => {
    expect(await view('0'.repeat(24))).toBeNull();
    expect(await view('')).toBeNull();
  });

  it('shows the session details', async () => {
    const v = await view(await codeOfTue());
    expect(v).toMatchObject({ title: 'Tuesday open play', weekday: 2, venue: 'Sample Hall', start_min: 1140, end_min: 1260, courts: 3, cancelled: null, friends: 0 });
  });

  it('lists only this organizer\'s players who are not removed, A to Z, with first names and an initial', async () => {
    const v = await view(await codeOfTue());
    expect(v?.players).toEqual([
      { id: ANA, first_name: 'Ana', last_initial: 'R', has_photo: true, photo_seq: 3 },
      { id: CY, first_name: 'Cy', last_initial: null, has_photo: false, photo_seq: 0 },
    ]);
  });

  it('never exposes a full name, an owner id or another organizer\'s data', async () => {
    const code = await codeOfTue();
    await answer(code, ANA, 'in');
    const text = JSON.stringify(await view(code));
    expect(text).not.toContain('Reyes');
    expect(text).not.toContain('Cruz');
    expect(text).not.toContain('Zed');
    expect(text).not.toContain(USER_A);
    expect(text).not.toContain(USER_B);
    expect(text).not.toContain(code);
  });

  it('can be read by a signed-in user too', async () => {
    expect((await view(await codeOfTue(), { user: USER_B }))?.title).toBe('Tuesday open play');
  });
});

describe('which date a link is about (Tuesday link, ends 9 pm, Manila time)', () => {
  const MNL = 'Asia/Manila';
  it('is the coming Tuesday from earlier in the week', async () => {
    expect(await playDate(2, null, MNL, 1260, '2026-11-09T02:00:00Z')).toBe('2026-11-10 Tue'); // Mon 10:00
    expect(await playDate(2, null, MNL, 1260, '2026-11-11T02:00:00Z')).toBe('2026-11-17 Tue'); // Wed 10:00
    expect(await playDate(2, null, MNL, 1260, '2026-11-15T02:00:00Z')).toBe('2026-11-17 Tue'); // Sun 10:00
  });
  it('is today until the planned end, then next week', async () => {
    expect(await playDate(2, null, MNL, 1260, '2026-11-10T02:00:00Z')).toBe('2026-11-10 Tue'); // Tue 10:00
    expect(await playDate(2, null, MNL, 1260, '2026-11-10T12:59:00Z')).toBe('2026-11-10 Tue'); // Tue 20:59
    expect(await playDate(2, null, MNL, 1260, '2026-11-10T13:00:00Z')).toBe('2026-11-17 Tue'); // Tue 21:00
    expect(await playDate(2, null, MNL, 1260, '2026-11-10T13:30:00Z')).toBe('2026-11-17 Tue'); // Tue 21:30
  });
  it('stays on today all day when no end time is set', async () => {
    expect(await playDate(2, null, MNL, null, '2026-11-10T15:30:00Z')).toBe('2026-11-10 Tue'); // Tue 23:30
    expect(await playDate(2, null, MNL, null, '2026-11-10T16:00:00Z')).toBe('2026-11-17 Tue'); // Wed 00:00
  });
  it('uses the link\'s own time zone, not the server\'s', async () => {
    // Tue 14:00 UTC is Tue 22:00 in Manila (over) but still Tue 14:00 in UTC (not over).
    expect(await playDate(2, null, MNL, 1260, '2026-11-10T14:00:00Z')).toBe('2026-11-17 Tue');
    expect(await playDate(2, null, 'UTC', 1260, '2026-11-10T14:00:00Z')).toBe('2026-11-10 Tue');
  });
  it('skips a date the organizer has finished', async () => {
    expect(await playDate(2, '2026-11-10', MNL, 1260, '2026-11-10T02:00:00Z')).toBe('2026-11-17 Tue');
    expect(await playDate(2, '2026-11-03', MNL, 1260, '2026-11-10T02:00:00Z')).toBe('2026-11-10 Tue');
  });
  it('works for any weekday, Sunday included', async () => {
    expect(await playDate(0, null, MNL, null, '2026-11-09T02:00:00Z')).toBe('2026-11-15 Sun');
    expect(await playDate(6, null, MNL, null, '2026-11-09T02:00:00Z')).toBe('2026-11-14 Sat');
  });
});

describe('answering', () => {
  it('records an answer for the link\'s date', async () => {
    const code = await codeOfTue();
    const r = (await answer(code, ANA, 'in')).rows[0] as { r: { play_date: string; status: string; late: boolean } };
    expect(r.r).toMatchObject({ status: 'in', late: false });
    const stored = (await db.query<{ play_date: string }>("select to_char(play_date, 'YYYY-MM-DD') as play_date from public.attendance_answers")).rows;
    expect(stored).toEqual([{ play_date: r.r.play_date }]);
    expect((await view(code))?.answers).toEqual([{ player_id: ANA, status: 'in', late: false }]);
  });

  it('replaces an answer when the member changes their mind, leaving one row', async () => {
    const code = await codeOfTue();
    await answer(code, ANA, 'in');
    await answer(code, ANA, 'maybe');
    await answer(code, ANA, 'out');
    const rows = (await db.query('select status from public.attendance_answers')).rows;
    expect(rows).toEqual([{ status: 'out' }]);
  });

  it('keeps "late" only for In', async () => {
    const code = await codeOfTue();
    await answer(code, ANA, 'in', true);
    expect((await view(code))?.answers[0]).toMatchObject({ status: 'in', late: true });
    await answer(code, ANA, 'out', true);
    expect((await view(code))?.answers[0]).toMatchObject({ status: 'out', late: false });
    await answer(code, ANA, 'in', false);
    expect((await view(code))?.answers[0]).toMatchObject({ status: 'in', late: false });
  });

  it('turns away a bad status, an unknown link, an unknown, removed or foreign player', async () => {
    const code = await codeOfTue();
    await expect(answer(code, ANA, 'yes')).rejects.toThrow(/bad_status/);
    await expect(run(db, 'anon', 'select public.attendance_answer($1, $2, null, false)', [code, ANA])).rejects.toThrow(/bad_status/);
    await expect(answer('0'.repeat(24), ANA, 'in')).rejects.toThrow(/unknown_link/);
    await expect(answer(code, '44444444-4444-4444-8444-444444444444', 'in')).rejects.toThrow(/unknown_player/);
    await expect(answer(code, BEN, 'in')).rejects.toThrow(/unknown_player/);
    await expect(answer(code, ZED, 'in')).rejects.toThrow(/unknown_player/);
    expect((await db.query('select * from public.attendance_answers')).rows).toEqual([]);
  });

  it('is closed for a cancelled date and open again once the cancellation is undone', async () => {
    const code = await codeOfTue();
    const date = (await view(code))!.play_date;
    await run(db, { user: USER_A }, "insert into public.attendance_cancellations (slot_id, play_date, reason) values ('tue', $1, 'Venue closed')", [date]);
    expect((await view(code))?.cancelled).toEqual({ reason: 'Venue closed' });
    await expect(answer(code, ANA, 'in')).rejects.toThrow(/cancelled/);
    await run(db, { user: USER_A }, "delete from public.attendance_cancellations where slot_id = 'tue'");
    expect((await view(code))?.cancelled).toBeNull();
    await answer(code, ANA, 'in');
    expect((await view(code))?.answers).toHaveLength(1);
  });

  it('refuses a cancellation reason over 140 characters', async () => {
    await expect(
      run(db, { user: USER_A }, "insert into public.attendance_cancellations (slot_id, play_date, reason) values ('tue', '2026-11-10', $1)", ['x'.repeat(141)]),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe('friends and new names', () => {
  it('stores a new name waiting for the organizer, trimmed', async () => {
    const code = await codeOfTue();
    await addGuest(code, '  Mika  ');
    const rows = (await run(db, { user: USER_A }, 'select name, brought_by, state from public.attendance_guests')).rows;
    expect(rows).toEqual([{ name: 'Mika', brought_by: null, state: 'pending' }]);
    expect((await view(code))?.friends).toBe(0);
  });

  it('counts a friend someone brings, and stops counting once the organizer dismisses them', async () => {
    const code = await codeOfTue();
    await addGuest(code, 'Rico', ANA);
    expect((await view(code))?.friends).toBe(1);
    await run(db, { user: USER_A }, "update public.attendance_guests set state = 'dismissed'");
    expect((await view(code))?.friends).toBe(0);
  });

  it('turns away an empty name, a name over 40 characters, an unknown link or an unknown sponsor', async () => {
    const code = await codeOfTue();
    await expect(addGuest(code, '   ')).rejects.toThrow(/bad_name/);
    await expect(run(db, 'anon', 'select public.attendance_add_guest($1, null, null)', [code])).rejects.toThrow(/bad_name/);
    await expect(addGuest(code, 'x'.repeat(41))).rejects.toThrow(/bad_name/);
    await expect(addGuest('0'.repeat(24), 'Mika')).rejects.toThrow(/unknown_link/);
    await expect(addGuest(code, 'Rico', BEN)).rejects.toThrow(/unknown_player/);
    await expect(addGuest(code, 'Rico', ZED)).rejects.toThrow(/unknown_player/);
    expect((await db.query('select * from public.attendance_guests')).rows).toEqual([]);
  });

  it('allows 40 characters and stops at 20 waiting names per date', async () => {
    const code = await codeOfTue();
    await addGuest(code, 'x'.repeat(40));
    for (let i = 1; i < 20; i++) await addGuest(code, `Guest ${i}`);
    await expect(addGuest(code, 'One too many')).rejects.toThrow(/too_many/);
    await run(db, { user: USER_A }, "update public.attendance_guests set state = 'dismissed' where name = 'Guest 1'");
    await addGuest(code, 'Fits now');
  });

  it('is closed for a cancelled date', async () => {
    const code = await codeOfTue();
    const date = (await view(code))!.play_date;
    await run(db, { user: USER_A }, "insert into public.attendance_cancellations (slot_id, play_date) values ('tue', $1)", [date]);
    await expect(addGuest(code, 'Mika')).rejects.toThrow(/cancelled/);
  });
});

describe('only the link\'s current date counts', () => {
  it('ignores answers, friends and cancellations from another date', async () => {
    const code = await codeOfTue();
    const date = (await view(code))!.play_date;
    await db.exec(`
      insert into public.attendance_answers (owner_id, slot_id, play_date, player_id, status)
        values ('${USER_A}', 'tue', '${date}'::date - 7, '${ANA}', 'in');
      insert into public.attendance_guests (owner_id, slot_id, play_date, name, brought_by)
        values ('${USER_A}', 'tue', '${date}'::date - 7, 'Rico', '${ANA}');
      insert into public.attendance_cancellations (owner_id, slot_id, play_date, reason)
        values ('${USER_A}', 'tue', '${date}'::date - 7, 'Last week');
    `);
    const v = await view(code);
    expect(v?.answers).toEqual([]);
    expect(v?.friends).toBe(0);
    expect(v?.cancelled).toBeNull();
    await answer(code, ANA, 'in');
  });

  it('keeps one link\'s answers away from another link of the same organizer', async () => {
    // Same weekday, so both links are about the same date and only the slot keeps the answers apart.
    await run(db, { user: USER_A }, "insert into public.attendance_links (slot_id, title, weekday) values ('tue-late', 'Late Tuesday', 2)");
    const late = ((await db.query<{ code: string }>("select code from public.attendance_links where slot_id = 'tue-late'")).rows[0]).code;
    await answer(await codeOfTue(), ANA, 'in');
    expect((await view(late))?.answers).toEqual([]);
  });

  it('does not let another organizer undo a cancellation', async () => {
    await run(db, { user: USER_A }, "insert into public.attendance_cancellations (slot_id, play_date) values ('tue', '2026-11-10')");
    await run(db, { user: USER_B }, 'delete from public.attendance_cancellations');
    expect((await db.query('select * from public.attendance_cancellations')).rows).toHaveLength(1);
  });

  it('does not let another organizer change a waiting name or an answer', async () => {
    const code = await codeOfTue();
    await answer(code, ANA, 'in');
    await addGuest(code, 'Mika');
    await run(db, { user: USER_B }, "update public.attendance_guests set state = 'dismissed'");
    await run(db, { user: USER_B }, "update public.attendance_answers set status = 'out'");
    expect((await db.query('select state from public.attendance_guests')).rows).toEqual([{ state: 'pending' }]);
    expect((await db.query('select status from public.attendance_answers')).rows).toEqual([{ status: 'in' }]);
  });

  it('moves the answer\'s updated time forward when it changes', async () => {
    const code = await codeOfTue();
    await answer(code, ANA, 'in');
    const first = (await db.query<{ t: string }>('select updated_at::text as t from public.attendance_answers')).rows[0].t;
    await new Promise((resolve) => setTimeout(resolve, 15)); // the test database's clock only ticks in milliseconds
    await answer(code, ANA, 'out');
    const second = (await db.query<{ t: string }>('select updated_at::text as t from public.attendance_answers')).rows[0].t;
    expect(second > first).toBe(true);
  });
});
```

Create `src/sync/db/attendanceGrants.test.ts`:

```typescript
// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USER_A, createDb, run } from './harness';

// Same idea as grants.test.ts: no default grants, so only the migration's own explicit grants count.
let db: PGlite;
beforeAll(async () => {
  db = await createDb({ defaultGrants: false });
  await db.exec(`
    insert into public.players (owner_id, id, name) values ('${USER_A}', '11111111-1111-4111-8111-111111111111', 'Ana Reyes');
    insert into public.attendance_links (owner_id, slot_id, title, weekday) values ('${USER_A}', 'tue', 'Tuesday', 2);
  `);
});
afterAll(async () => {
  await db.close();
});

describe('attendance grants (no default grants)', () => {
  it('lets a signed-in organizer make a link, with the code filled in', async () => {
    await run(db, { user: USER_A }, "insert into public.attendance_links (slot_id, title, weekday) values ('wed', 'Wednesday', 3)");
    const rows = (await run(db, { user: USER_A }, "select length(code) as n from public.attendance_links where slot_id = 'wed'")).rows;
    expect(rows).toEqual([{ n: 24 }]);
  });

  it('lets a signed-in organizer reset a link and manage their answers, names and cancellations', async () => {
    expect(((await run(db, { user: USER_A }, "select public.reset_attendance_link('tue') as c")).rows[0] as { c: string }).c).toHaveLength(24);
    await run(db, { user: USER_A }, "insert into public.attendance_answers (slot_id, play_date, player_id, status) values ('tue', '2026-11-10', '11111111-1111-4111-8111-111111111111', 'in')");
    await run(db, { user: USER_A }, "insert into public.attendance_cancellations (slot_id, play_date) values ('tue', '2026-11-10')");
    await run(db, { user: USER_A }, "delete from public.attendance_cancellations");
    expect((await run(db, { user: USER_A }, 'select * from public.attendance_guests')).rows).toEqual([]);
  });

  it('lets a visitor with the code read the page, answer, and ask to join', async () => {
    const code = ((await db.query<{ code: string }>("select code from public.attendance_links where slot_id = 'tue'")).rows[0]).code;
    const v = (await run(db, 'anon', 'select public.attendance_view($1) as v', [code])).rows[0] as { v: { title: string } };
    expect(v.v.title).toBe('Tuesday');
    await run(db, 'anon', "select public.attendance_answer($1, '11111111-1111-4111-8111-111111111111', 'in', false)", [code]);
    await run(db, 'anon', "select public.attendance_add_guest($1, 'Mika', null)", [code]);
    expect((await db.query('select * from public.attendance_answers')).rows.length).toBeGreaterThan(0);
  });

  it('still gives a visitor no table and no organizer function', async () => {
    await expect(run(db, 'anon', 'select * from public.attendance_links')).rejects.toThrow(/permission denied/i);
    await expect(run(db, 'anon', "select public.reset_attendance_link('tue')")).rejects.toThrow(/permission denied/i);
    await expect(run(db, 'anon', 'select public.new_attendance_code()')).rejects.toThrow(/permission denied/i);
    await expect(
      run(db, { user: USER_A }, "select public.attendance_play_date(2::smallint, null, 'UTC', null, now())"),
    ).rejects.toThrow(/permission denied/i);
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run src/sync/db/attendance.test.ts src/sync/db/attendanceGrants.test.ts`

Expected: both files fail. 43 tests fail with `relation "public.attendance_links" does not exist`, and the 4 grants tests are skipped because their setup failed.

---

### Task 2: The migration

**Files:**
- Create: `supabase/migrations/20261109120000_attendance_links.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261109120000_attendance_links.sql`:

```sql
-- Attendance link: one permanent link per weekly slot. Members open it without an account, say In, Maybe or Out,
-- and the organizer sees the answers. Anyone with the link can read first names and answer, and nothing else:
-- the tables below are closed to anonymous visitors, and three locked-down functions are the only way in.
-- The link carries a random code, so it cannot be guessed, and "Reset link" makes a new one.

-- A random 24 character code (96 bits). gen_random_uuid() is cryptographically random; only the first 12 characters
-- of each uuid are used, which skips the fixed version digit.
create function public.new_attendance_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
      || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
$$;

-- Used as a column default, so it runs with the signed-in organizer's rights.
revoke execute on function public.new_attendance_code() from public, anon;
grant execute on function public.new_attendance_code() to authenticated;

create table public.attendance_links (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The device's slot id, such as 'tue'. Slots are still saved on the device; this is a copy of what the link shows.
  slot_id text not null check (slot_id ~ '^[a-z0-9-]{1,40}$'),
  code text not null default public.new_attendance_code() check (length(code) >= 16),
  title text not null check (btrim(title) <> '' and length(title) <= 60),
  -- 0 is Sunday, 6 is Saturday, the same as the app.
  weekday smallint not null check (weekday between 0 and 6),
  start_min integer check (start_min between 0 and 1439),
  end_min integer check (end_min between 0 and 1439),
  venue text check (length(venue) <= 40),
  courts smallint check (courts between 1 and 12),
  timezone text not null default 'Asia/Manila' check (timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$'),
  -- Set when the organizer finishes a session: the link then shows the next date after it.
  closed_through date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, slot_id),
  unique (code)
);

create table public.attendance_answers (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slot_id text not null,
  play_date date not null,
  player_id uuid not null,
  status text not null check (status in ('in', 'maybe', 'out')),
  late boolean not null default false check (not late or status = 'in'),
  updated_at timestamptz not null default now(),
  primary key (owner_id, slot_id, play_date, player_id),
  foreign key (owner_id, slot_id) references public.attendance_links (owner_id, slot_id) on delete cascade,
  -- Purging the roster (delete_my_players) removes the answers too.
  foreign key (owner_id, player_id) references public.players (owner_id, id) on delete cascade
);

-- A name nobody has approved yet: a new member asking to join, or a friend a member is bringing.
-- Nothing here touches the roster until the organizer acts.
create table public.attendance_guests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slot_id text not null,
  play_date date not null,
  name text not null check (btrim(name) <> '' and length(name) <= 40),
  -- Set for a friend someone is bringing, empty for a new member asking to join.
  brought_by uuid,
  state text not null default 'pending' check (state in ('pending', 'play_tonight', 'added', 'dismissed')),
  created_at timestamptz not null default now(),
  foreign key (owner_id, slot_id) references public.attendance_links (owner_id, slot_id) on delete cascade,
  foreign key (owner_id, brought_by) references public.players (owner_id, id) on delete cascade
);

create index attendance_guests_by_date on public.attendance_guests (owner_id, slot_id, play_date);

create table public.attendance_cancellations (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slot_id text not null,
  play_date date not null,
  reason text check (length(reason) <= 140),
  created_at timestamptz not null default now(),
  primary key (owner_id, slot_id, play_date),
  foreign key (owner_id, slot_id) references public.attendance_links (owner_id, slot_id) on delete cascade
);

create trigger attendance_links_set_updated_at
  before insert or update on public.attendance_links
  for each row execute function public.set_updated_at();

create trigger attendance_answers_set_updated_at
  before insert or update on public.attendance_answers
  for each row execute function public.set_updated_at();

alter table public.attendance_links enable row level security;
alter table public.attendance_answers enable row level security;
alter table public.attendance_guests enable row level security;
alter table public.attendance_cancellations enable row level security;

-- Each organizer sees and changes only their own rows.
create policy attendance_links_select_own on public.attendance_links
  for select to authenticated using (owner_id = (select auth.uid()));
create policy attendance_links_insert_own on public.attendance_links
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy attendance_links_update_own on public.attendance_links
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy attendance_answers_select_own on public.attendance_answers
  for select to authenticated using (owner_id = (select auth.uid()));
create policy attendance_answers_insert_own on public.attendance_answers
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy attendance_answers_update_own on public.attendance_answers
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy attendance_guests_select_own on public.attendance_guests
  for select to authenticated using (owner_id = (select auth.uid()));
create policy attendance_guests_update_own on public.attendance_guests
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy attendance_cancellations_select_own on public.attendance_cancellations
  for select to authenticated using (owner_id = (select auth.uid()));
create policy attendance_cancellations_insert_own on public.attendance_cancellations
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy attendance_cancellations_delete_own on public.attendance_cancellations
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Take back Supabase's default grants and give only what is needed. Anonymous visitors get no table access at all.
revoke all on public.attendance_links, public.attendance_answers, public.attendance_guests, public.attendance_cancellations
  from anon, authenticated;
grant select, insert, update on public.attendance_links to authenticated;
grant select, insert, update on public.attendance_answers to authenticated;
grant select, update on public.attendance_guests to authenticated;
grant select, insert, delete on public.attendance_cancellations to authenticated;

-- The date a link is about: the first date on the slot's weekday that is not over yet.
-- It is today until the planned end time passes (in the link's own time zone), and it skips any date the organizer
-- has already closed. Called only by the functions below.
create function public.attendance_play_date(
  p_weekday smallint, p_closed_through date, p_tz text, p_end_min integer, p_now timestamptz
)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  local_now timestamp := p_now at time zone p_tz;
  first_day date := local_now::date;
begin
  if p_end_min is not null
     and (extract(hour from local_now)::integer * 60 + extract(minute from local_now)::integer) >= p_end_min then
    first_day := first_day + 1;
  end if;
  if p_closed_through is not null and p_closed_through >= first_day then
    first_day := p_closed_through + 1;
  end if;
  return first_day + ((p_weekday - extract(dow from first_day)::integer + 7) % 7);
end;
$$;

revoke execute on function public.attendance_play_date(smallint, date, text, integer, timestamptz)
  from public, anon, authenticated;

-- What the public page shows. First names and a last initial only, never a full name, an owner id or an email.
create function public.attendance_view(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.attendance_links;
  the_date date;
begin
  select * into l from public.attendance_links where code = p_code;
  if not found then
    return null;
  end if;
  the_date := public.attendance_play_date(l.weekday, l.closed_through, l.timezone, l.end_min, now());
  return jsonb_build_object(
    'title', l.title,
    'weekday', l.weekday,
    'venue', l.venue,
    'start_min', l.start_min,
    'end_min', l.end_min,
    'courts', l.courts,
    'play_date', the_date,
    'cancelled', (
      select jsonb_build_object('reason', c.reason)
      from public.attendance_cancellations c
      where c.owner_id = l.owner_id and c.slot_id = l.slot_id and c.play_date = the_date
    ),
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'first_name', split_part(btrim(p.name), ' ', 1),
        'last_initial', nullif(upper(left(btrim(substr(btrim(p.name), length(split_part(btrim(p.name), ' ', 1)) + 1)), 1)), ''),
        'has_photo', p.photo_version > 0,
        'photo_seq', p.photo_seq
      ) order by lower(p.name)), '[]'::jsonb)
      from public.players p
      where p.owner_id = l.owner_id and p.deleted_at is null
    ),
    'answers', (
      select coalesce(jsonb_agg(jsonb_build_object('player_id', a.player_id, 'status', a.status, 'late', a.late)), '[]'::jsonb)
      from public.attendance_answers a
      where a.owner_id = l.owner_id and a.slot_id = l.slot_id and a.play_date = the_date
    ),
    'friends', (
      select count(*)
      from public.attendance_guests g
      where g.owner_id = l.owner_id and g.slot_id = l.slot_id and g.play_date = the_date
        and g.brought_by is not null and g.state <> 'dismissed'
    )
  );
end;
$$;

-- Records one member's answer for the link's current date. Changing your mind replaces the answer.
create function public.attendance_answer(p_code text, p_player_id uuid, p_status text, p_late boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  l public.attendance_links;
  the_date date;
  is_late boolean := coalesce(p_late, false) and p_status = 'in';
begin
  if p_status is null or p_status not in ('in', 'maybe', 'out') then
    raise exception 'bad_status';
  end if;
  select * into l from public.attendance_links where code = p_code;
  if not found then
    raise exception 'unknown_link';
  end if;
  the_date := public.attendance_play_date(l.weekday, l.closed_through, l.timezone, l.end_min, now());
  if exists (
    select 1 from public.attendance_cancellations c
    where c.owner_id = l.owner_id and c.slot_id = l.slot_id and c.play_date = the_date
  ) then
    raise exception 'cancelled';
  end if;
  if not exists (
    select 1 from public.players p
    where p.owner_id = l.owner_id and p.id = p_player_id and p.deleted_at is null
  ) then
    raise exception 'unknown_player';
  end if;
  insert into public.attendance_answers (owner_id, slot_id, play_date, player_id, status, late)
  values (l.owner_id, l.slot_id, the_date, p_player_id, p_status, is_late)
  on conflict (owner_id, slot_id, play_date, player_id)
  do update set status = excluded.status, late = excluded.late;
  return jsonb_build_object('play_date', the_date, 'status', p_status, 'late', is_late);
end;
$$;

-- A new member asking to join, or a friend a member brings. It waits for the organizer; at most 20 wait per date.
create function public.attendance_add_guest(p_code text, p_name text, p_brought_by uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  l public.attendance_links;
  the_date date;
  clean text := btrim(coalesce(p_name, ''));
  new_id uuid;
begin
  if clean = '' or length(clean) > 40 then
    raise exception 'bad_name';
  end if;
  select * into l from public.attendance_links where code = p_code;
  if not found then
    raise exception 'unknown_link';
  end if;
  the_date := public.attendance_play_date(l.weekday, l.closed_through, l.timezone, l.end_min, now());
  if exists (
    select 1 from public.attendance_cancellations c
    where c.owner_id = l.owner_id and c.slot_id = l.slot_id and c.play_date = the_date
  ) then
    raise exception 'cancelled';
  end if;
  if p_brought_by is not null and not exists (
    select 1 from public.players p
    where p.owner_id = l.owner_id and p.id = p_brought_by and p.deleted_at is null
  ) then
    raise exception 'unknown_player';
  end if;
  if (
    select count(*) from public.attendance_guests g
    where g.owner_id = l.owner_id and g.slot_id = l.slot_id and g.play_date = the_date and g.state = 'pending'
  ) >= 20 then
    raise exception 'too_many';
  end if;
  insert into public.attendance_guests (owner_id, slot_id, play_date, name, brought_by)
  values (l.owner_id, l.slot_id, the_date, clean, p_brought_by)
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'play_date', the_date);
end;
$$;

revoke execute on function public.attendance_view(text) from public;
revoke execute on function public.attendance_answer(text, uuid, text, boolean) from public;
revoke execute on function public.attendance_add_guest(text, text, uuid) from public;
grant execute on function public.attendance_view(text) to anon, authenticated;
grant execute on function public.attendance_answer(text, uuid, text, boolean) to anon, authenticated;
grant execute on function public.attendance_add_guest(text, text, uuid) to anon, authenticated;

-- "Reset link": a new code for one of the caller's own slots. The old code stops working at once; answers are kept.
-- It runs with the caller's rights, so the row-level rules decide whose slot it is.
create function public.reset_attendance_link(p_slot_id text)
returns text
language sql
volatile
set search_path = ''
as $$
  update public.attendance_links
  set code = public.new_attendance_code()
  where slot_id = p_slot_id
  returning code;
$$;

revoke execute on function public.reset_attendance_link(text) from public, anon;
grant execute on function public.reset_attendance_link(text) to authenticated;

-- "Delete all my data" must reach the attendance data too. A name waiting to join has no player to cascade from, and
-- organizers cannot delete links themselves, so the existing purge now removes the caller's links as well.
-- Deleting a link removes its answers, waiting names and cancellations. It returns the same count as before: players.
create or replace function public.delete_my_players()
returns integer
language sql
security definer
set search_path = ''
as $$
  with dropped_links as (
    delete from public.attendance_links
    where owner_id = (select auth.uid())
    returning 1
  ),
  gone as (
    delete from public.players
    where owner_id = (select auth.uid())
    returning 1
  )
  select count(*)::integer from gone;
$$;
```

- [ ] **Step 2: Run the new tests, then the whole project**

Run: `npx vitest run src/sync/db/attendance.test.ts src/sync/db/attendanceGrants.test.ts`

Expected: 47 tests pass (43 and 4).

Then run `npx tsc --noEmit`, `npx vitest run` and `npm run build`.

Expected: the typecheck is clean, the suite shows 1523 tests across 121 files, and the build finishes.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261109120000_attendance_links.sql src/sync/db/attendance.test.ts src/sync/db/attendanceGrants.test.ts src/sync/engine.test.ts src/sync/db/players.test.ts src/sync/dataActions.test.ts src/sync/db/purge.test.ts
git commit -m "Add the attendance link database: links, answers, waiting names, cancellations"
```

---

### Task 3: Break it on purpose

The tests are only worth trusting if they fail when the migration is wrong. This script makes 70 deliberate breaks to the
migration, one at a time, runs the two test files after each, and puts the file back. Every break must make a test fail.

**Files:** none changed (the script restores the migration after each break).

- [ ] **Step 1: Save the script**

Save this outside the project, so a break can never be committed by accident.

Create `/tmp/mutate-attendance.py`:

```python
#!/usr/bin/env python3
"""Breaks the attendance migration on purpose, one change at a time. Every break must make a test fail."""
import os, subprocess, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
MIG = os.path.join(ROOT, 'supabase/migrations/20261109120000_attendance_links.sql')
TESTS = ['src/sync/db/attendance.test.ts', 'src/sync/db/attendanceGrants.test.ts']
original = open(MIG).read()

BREAKS = [
 ('code is shorter', "substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)\n      ||", "substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)\n      ||"),
 ('short codes allowed', "check (length(code) >= 16)", "check (length(code) >= 1)"),
 ('slot id unchecked', "check (slot_id ~ '^[a-z0-9-]{1,40}$')", ""),
 ('weekday 7 allowed', "check (weekday between 0 and 6)", "check (weekday between 0 and 7)"),
 ('blank title allowed', "check (btrim(title) <> '' and length(title) <= 60)", "check (true)"),
 ('courts 99 allowed', "check (courts between 1 and 12)", "check (courts between 1 and 99)"),
 ('codes not unique', "  unique (code)\n", ""),
 ('late without In allowed', "check (not late or status = 'in')", "check (true)"),
 ('maybe not an answer', "status text not null check (status in ('in', 'maybe', 'out')),\n  late", "status text not null check (status in ('in', 'out')),\n  late"),
 ('end boundary off by one', ">= p_end_min then", "> p_end_min then"),
 ('after the end stays today', "    first_day := first_day + 1;\n  end if;\n  if p_closed", "    first_day := first_day;\n  end if;\n  if p_closed"),
 ('closed date not skipped', "p_closed_through >= first_day then", "p_closed_through > first_day then"),
 ('closed date skips nothing', "first_day := p_closed_through + 1;", "first_day := p_closed_through;"),
 ('server time zone used', "p_now at time zone p_tz", "p_now at time zone 'UTC'"),
 ('week length wrong', "+ 7) % 7);", "+ 7) % 6);"),
 ('negative gap not wrapped', "- extract(dow from first_day)::integer + 7) % 7", "- extract(dow from first_day)::integer) % 7"),
 ('removed players listed', "where p.owner_id = l.owner_id and p.deleted_at is null\n    ),", "where p.owner_id = l.owner_id\n    ),"),
 ('other organizers players listed', "where p.owner_id = l.owner_id and p.deleted_at is null\n    ),", "where p.deleted_at is null\n    ),"),
 ('answers from any date', "and a.play_date = the_date\n    ),", "\n    ),"),
 ('answers from any link', "where a.owner_id = l.owner_id and a.slot_id = l.slot_id and a.play_date = the_date", "where a.owner_id = l.owner_id and a.play_date = the_date"),
 ('full last name shown', "+ 1)), 1)), '')", "+ 1)), 99)), '')"),
 ('full name exposed', "'id', p.id,", "'id', p.id, 'name', p.name,"),
 ('owner id exposed', "'title', l.title,", "'title', l.title, 'owner', l.owner_id,"),
 ('cancellation of any date shown', "c.slot_id = l.slot_id and c.play_date = the_date\n    ),\n    'players'", "c.slot_id = l.slot_id\n    ),\n    'players'"),
 ('friends from any date', "where g.owner_id = l.owner_id and g.slot_id = l.slot_id and g.play_date = the_date\n        and g.brought_by", "where g.owner_id = l.owner_id and g.slot_id = l.slot_id\n        and g.brought_by"),
 ('new names counted as friends', "and g.brought_by is not null and g.state <> 'dismissed'", "and g.state <> 'dismissed'"),
 ('dismissed friends counted', "and g.brought_by is not null and g.state <> 'dismissed'", "and g.brought_by is not null"),
 ('answer ignores cancellation', "    raise exception 'cancelled';\n  end if;\n  if not exists (\n    select 1 from public.players p\n    where p.owner_id = l.owner_id and p.id = p_player_id and p.deleted_at is null", "    null;\n  end if;\n  if not exists (\n    select 1 from public.players p\n    where p.owner_id = l.owner_id and p.id = p_player_id and p.deleted_at is null"),
 ('answer accepts foreign player', "where p.owner_id = l.owner_id and p.id = p_player_id and p.deleted_at is null", "where p.id = p_player_id and p.deleted_at is null"),
 ('answer accepts removed player', "where p.owner_id = l.owner_id and p.id = p_player_id and p.deleted_at is null", "where p.owner_id = l.owner_id and p.id = p_player_id"),
 ('late kept without In', "coalesce(p_late, false) and p_status = 'in';", "coalesce(p_late, false);"),
 ('answer never replaced', "do update set status = excluded.status, late = excluded.late;", "do nothing;"),
 ('answer status unchecked', "if p_status is null or p_status not in ('in', 'maybe', 'out') then", "if false then"),
 ('waiting names uncapped', ") >= 20 then", ") >= 21 then"),
 ('long names allowed', "length(clean) > 40 then", "length(clean) > 41 then"),
 ('empty names allowed', "if clean = '' or length(clean) > 40 then", "if length(clean) > 40 then"),
 ('sponsor not checked', "if p_brought_by is not null and not exists (", "if false and not exists ("),
 ('dismissed names fill the cap', "and g.state = 'pending'\n  ) >= 20", "\n  ) >= 20"),
 ('guest ignores cancellation', "    raise exception 'cancelled';\n  end if;\n  if p_brought_by", "    null;\n  end if;\n  if p_brought_by"),
 ('view runs with caller rights', "stable\nsecurity definer\nset search_path = ''\nas $$\ndeclare\n  l public.attendance_links;\n  the_date date;\nbegin\n  select * into l from public.attendance_links where code = p_code;\n  if not found then\n    return null;", "stable\nset search_path = ''\nas $$\ndeclare\n  l public.attendance_links;\n  the_date date;\nbegin\n  select * into l from public.attendance_links where code = p_code;\n  if not found then\n    return null;"),
 ('answer not granted to visitors', "grant execute on function public.attendance_answer(text, uuid, text, boolean) to anon, authenticated;", ""),
 ('view not granted to visitors', "grant execute on function public.attendance_view(text) to anon, authenticated;", ""),
 ('add guest not granted to visitors', "grant execute on function public.attendance_add_guest(text, text, uuid) to anon, authenticated;", ""),
 ('date helper open to visitors', "revoke execute on function public.attendance_play_date(smallint, date, text, integer, timestamptz)\n  from public, anon, authenticated;", ""),
 ('reset open to visitors', "revoke execute on function public.reset_attendance_link(text) from public, anon;", "revoke execute on function public.reset_attendance_link(text) from public;"),
 ('reset not granted to organizers', "grant execute on function public.reset_attendance_link(text) to authenticated;", ""),
 ('code maker open to visitors', "revoke execute on function public.new_attendance_code() from public, anon;", "revoke execute on function public.new_attendance_code() from public;"),
 ('code maker not granted to organizers', "grant execute on function public.new_attendance_code() to authenticated;", ""),
 ('reset ignores the owner rule', "language sql\nvolatile\nset search_path = ''\nas $$\n  update public.attendance_links", "language sql\nvolatile\nsecurity definer\nset search_path = ''\nas $$\n  update public.attendance_links"),
 ('answers visible to everyone', "create policy attendance_answers_select_own on public.attendance_answers\n  for select to authenticated using (owner_id = (select auth.uid()));", "create policy attendance_answers_select_own on public.attendance_answers\n  for select to authenticated using (true);"),
 ('links visible to everyone', "create policy attendance_links_select_own on public.attendance_links\n  for select to authenticated using (owner_id = (select auth.uid()));", "create policy attendance_links_select_own on public.attendance_links\n  for select to authenticated using (true);"),
 ('guests visible to everyone', "create policy attendance_guests_select_own on public.attendance_guests\n  for select to authenticated using (owner_id = (select auth.uid()));", "create policy attendance_guests_select_own on public.attendance_guests\n  for select to authenticated using (true);"),
 ('cancellations visible to everyone', "create policy attendance_cancellations_select_own on public.attendance_cancellations\n  for select to authenticated using (owner_id = (select auth.uid()));", "create policy attendance_cancellations_select_own on public.attendance_cancellations\n  for select to authenticated using (true);"),
 ('anyone may write answers', "create policy attendance_answers_insert_own on public.attendance_answers\n  for insert to authenticated with check (owner_id = (select auth.uid()));", "create policy attendance_answers_insert_own on public.attendance_answers\n  for insert to authenticated with check (true);"),
 ('anyone may cancel', "create policy attendance_cancellations_insert_own on public.attendance_cancellations\n  for insert to authenticated with check (owner_id = (select auth.uid()));", "create policy attendance_cancellations_insert_own on public.attendance_cancellations\n  for insert to authenticated with check (true);"),
 ('anyone may make links', "create policy attendance_links_insert_own on public.attendance_links\n  for insert to authenticated with check (owner_id = (select auth.uid()));", "create policy attendance_links_insert_own on public.attendance_links\n  for insert to authenticated with check (true);"),
 ('anyone may undo a cancellation', "create policy attendance_cancellations_delete_own on public.attendance_cancellations\n  for delete to authenticated using (owner_id = (select auth.uid()));", "create policy attendance_cancellations_delete_own on public.attendance_cancellations\n  for delete to authenticated using (true);"),
 ('anyone may change guests', "create policy attendance_guests_update_own on public.attendance_guests\n  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));", "create policy attendance_guests_update_own on public.attendance_guests\n  for update to authenticated using (true) with check (true);"),
 ('anyone may change answers', "create policy attendance_answers_update_own on public.attendance_answers\n  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));", "create policy attendance_answers_update_own on public.attendance_answers\n  for update to authenticated using (true) with check (true);"),
 ('organizers may hard-delete answers', "grant select, insert, update on public.attendance_answers to authenticated;", "grant select, insert, update, delete on public.attendance_answers to authenticated;"),
 ('organizers may hard-delete links', "grant select, insert, update on public.attendance_links to authenticated;", "grant select, insert, update, delete on public.attendance_links to authenticated;"),
 ('organizers may hard-delete guests', "grant select, update on public.attendance_guests to authenticated;", "grant select, update, delete on public.attendance_guests to authenticated;"),
 ('visitors may read links', "grant select, insert, update on public.attendance_links to authenticated;", "grant select, insert, update on public.attendance_links to authenticated;\ngrant select on public.attendance_links to anon;"),
 ('purge leaves answers behind', "foreign key (owner_id, player_id) references public.players (owner_id, id) on delete cascade", "foreign key (owner_id, player_id) references public.players (owner_id, id)"),
 ('purge leaves guests behind', "foreign key (owner_id, brought_by) references public.players (owner_id, id) on delete cascade", "foreign key (owner_id, brought_by) references public.players (owner_id, id)"),
 ('answer time never updated', "create trigger attendance_answers_set_updated_at\n  before insert or update", "create trigger attendance_answers_set_updated_at\n  before insert"),
 ('purge keeps links', "delete from public.attendance_links\n    where owner_id = (select auth.uid())\n    returning 1\n  ),\n  gone as (", "delete from public.attendance_links\n    where false\n    returning 1\n  ),\n  gone as ("),
 ('purge deletes everyone\'s links', "delete from public.attendance_links\n    where owner_id = (select auth.uid())\n    returning 1\n  ),\n  gone as (", "delete from public.attendance_links\n    where true\n    returning 1\n  ),\n  gone as ("),
 ('reason length unchecked', "reason text check (length(reason) <= 140)", "reason text"),
 ('guest name length unchecked', "name text not null check (btrim(name) <> '' and length(name) <= 40),", "name text not null,"),
]

killed, survived, broken = 0, [], []
try:
    for name, old, new in BREAKS:
        if original.count(old) != 1:
            broken.append((name, original.count(old)))
            continue
        open(MIG, 'w').write(original.replace(old, new))
        r = subprocess.run(['npx', 'vitest', 'run'] + TESTS, cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0:
            killed += 1
            print('killed  ', name, flush=True)
        else:
            survived.append(name)
            print('SURVIVED', name, flush=True)
finally:
    open(MIG, 'w').write(original)

print(f'\n{killed} of {len(BREAKS)} killed; survived: {survived}; entries that did not match exactly once: {broken}')
sys.exit(1 if survived or broken else 0)
```

- [ ] **Step 2: Run it**

Run: `python3 /tmp/mutate-attendance.py .`

Expected, last line: `70 of 70 killed; survived: []; entries that did not match exactly once: []`

If a break survives, the tests are missing a check: add the test, do not change the break. Then run `git status --short` and expect nothing to be listed, because the script restores the migration.

---

### Task 4: Apply it to the real project (needs the owner's yes)

This changes the live Supabase project `pikl` (ref `jukjgwabutqetiwjnube`, ap-southeast-1). Do not start it without the owner saying yes in the conversation. The in-memory tests are stand-ins for Supabase, so this step is what proves the real thing.

- [ ] **Step 1: Apply the migration**

Apply `supabase/migrations/20261109120000_attendance_links.sql` to the project, with the Supabase tool or the dashboard SQL editor. Expected: it runs with no error.

- [ ] **Step 2: Read the security advisor**

Run the security advisor for the project. Expected: the three public functions (`attendance_view`, `attendance_answer`, `attendance_add_guest`) appear as callable by signed-out users. That is the intent. No table should appear as open to anonymous visitors, and nothing else should be new.

- [ ] **Step 3: Check the rules with a made-up link**

In the SQL editor, run each statement as written and compare:

```sql
-- 1. A visitor cannot read a table.
set role anon;
select * from public.attendance_links;  -- expected: permission denied
reset role;

-- 2. A visitor can call the public function, and an unknown code returns nothing.
set role anon;
select public.attendance_view('000000000000000000000000');  -- expected: null
reset role;

-- 3. A visitor cannot call the organizer function.
set role anon;
select public.reset_attendance_link('tue');  -- expected: permission denied
reset role;
```

- [ ] **Step 4: Note it**

Add one line to `docs/superpowers/HANDOFF.md` saying the migration is applied, with the date and what was checked. Commit that line on its own.

---

## Self-review

- **Spec coverage.** Decisions 1 to 5 and 7, audit findings O2, O4, O5, O6 and P2 (the data side) are covered by the tables and functions. Screens, the organizer client, the public page and the session flow are Plans 2 to 4.
- **Placeholders.** None. Every file is complete.
- **Names.** The function and column names in the tests match the migration, because both come from the same proven commit.
- **Known limits.** The tests run on an in-memory Postgres. Task 4 is the only step that touches the real project, and it waits for the owner.
