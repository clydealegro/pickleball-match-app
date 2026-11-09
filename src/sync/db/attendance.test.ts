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
