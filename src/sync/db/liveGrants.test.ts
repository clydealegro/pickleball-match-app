// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USER_A, createDb, run } from './harness';

// Same idea as grants.test.ts: no default grants, so only the migration's own explicit grants count.
let db: PGlite;
beforeAll(async () => {
  db = await createDb({ defaultGrants: false });
  await db.exec(`insert into public.attendance_links (owner_id, slot_id, title, weekday) values ('${USER_A}', 'tue', 'Tuesday', 2)`);
});
afterAll(async () => {
  await db.close();
});

describe('live board grants (no default grants)', () => {
  it('lets a signed-in organizer publish a board and its faces, and take them down', async () => {
    await run(db, { user: USER_A }, `insert into public.live_boards (slot_id, session_id, snapshot, version) values ('tue', 's', '{"a":1}', 1)`);
    await run(db, { user: USER_A }, `insert into public.live_photos (slot_id, roster_id, photo_seq, data) values ('tue', '11111111-1111-4111-8111-111111111111', 1, 'data:image/jpeg;base64,AAAA')`);
    await run(db, { user: USER_A }, "update public.live_boards set paused = true");
    await run(db, { user: USER_A }, 'delete from public.live_photos');
    expect((await run(db, { user: USER_A }, 'select * from public.live_photos')).rows).toEqual([]);
  });

  it('lets a visitor with the code read the board and faces, and nothing else', async () => {
    const code = ((await db.query<{ code: string }>("select code from public.attendance_links where slot_id = 'tue'")).rows[0]).code;
    await run(db, { user: USER_A }, "update public.live_boards set paused = false");
    const v = (await run(db, 'anon', 'select public.live_view($1) as v', [code])).rows[0] as { v: { state: string } };
    expect(v.v.state).toBe('live');
    expect((await run(db, 'anon', 'select public.live_photos($1) as p', [code])).rows).toHaveLength(1);
    await expect(run(db, 'anon', 'select * from public.live_boards')).rejects.toThrow();
  });
});
