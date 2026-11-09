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
