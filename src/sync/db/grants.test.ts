// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USER_A, createDb, run } from './harness';

// New Supabase projects are moving to opt-in grants: nothing is granted to the API roles unless a migration says so.
// The other database tests run with the old broad defaults. These run without them, so only the migrations' own
// explicit grants count, and a forgotten `grant` shows up here.
let db: PGlite;
beforeAll(async () => {
  db = await createDb({ defaultGrants: false });
});
afterAll(async () => {
  await db.close();
});

describe('explicit grants (no default grants)', () => {
  it('lets a signed-in organizer read, add and change their own players', async () => {
    await run(db, { user: USER_A }, "insert into public.players (id, name) values ('11111111-1111-4111-8111-111111111111', 'Ann')");
    await run(db, { user: USER_A }, "update public.players set name = 'Annie'");
    const rows = (await run(db, { user: USER_A }, 'select name from public.players')).rows;
    expect(rows).toEqual([{ name: 'Annie' }]);
  });

  it('lets a signed-in organizer run the purge', async () => {
    const result = await run(db, { user: USER_A }, 'select public.delete_my_players() as removed');
    expect(result.rows).toEqual([{ removed: 1 }]);
  });

  it('still gives a signed-out visitor nothing', async () => {
    await expect(run(db, 'anon', 'select * from public.players')).rejects.toThrow(/permission denied/i);
    await expect(run(db, 'anon', 'select public.delete_my_players()')).rejects.toThrow(/permission denied/i);
  });

  it('gives no one the right to hard-delete', async () => {
    await expect(run(db, { user: USER_A }, 'delete from public.players')).rejects.toThrow(/permission denied/i);
  });
});
