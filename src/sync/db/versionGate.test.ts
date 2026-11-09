// @vitest-environment node
import { it, expect, describe, beforeAll, beforeEach, afterAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, run, USER_A } from './harness';

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const header = (db: Awaited<ReturnType<typeof createDb>>, value: string | null) =>
  db.query("select set_config('request.headers', $1, false)", [value === null ? '' : JSON.stringify({ 'x-pikl-sync-version': value })]);

// One database for the whole file: building a PGlite database and applying every migration is the slow part, and the
// full suite already runs many in parallel.
let shared: PGlite;
beforeAll(async () => { shared = await createDb(); }, 60_000);
afterAll(async () => { await shared.close(); });
beforeEach(async () => {
  await shared.exec('truncate public.players cascade; delete from storage.objects; delete from storage.buckets where id = \'other\'; drop policy if exists other_insert on storage.objects;');
});

async function seeded() {
  const db = shared;
  await db.query("select set_config('request.headers', $1, false)", [JSON.stringify({ 'x-pikl-sync-version': '2' })]);
  await run(db, { user: USER_A }, `insert into public.players(id,name) values ('${ID1}','Ann')`);
  await run(db, { user: USER_A }, "insert into storage.objects(bucket_id,name) values ('player-photos',$1)", [USER_A + '/player/revision.jpg']);
  return db;
}

describe('sync version gate', () => {
  // Every header state that must count as a legacy or incompatible client.
  for (const [label, value] of [['no header', null], ['empty headers object', '{}'], ['version 1', '1'], ['version 3', '3']] as const) {
    it(`blocks writes, photo mutations and purge with ${label}`, async () => {
      const db = await seeded();
      try {
        if (value === '{}') await db.query("select set_config('request.headers', '{}', false)");
        else await header(db, value);
        expect((await run(db, { user: USER_A }, 'select name from public.players')).rows).toHaveLength(1);
        await expect(run(db, { user: USER_A }, `insert into public.players(id,name) values ('${ID2}','Ben')`)).rejects.toThrow();
        // The path the old engine used: an upsert, which must fail through the INSERT check.
        await expect(run(db, { user: USER_A }, `insert into public.players(id,name) values ('${ID1}','Wrong') on conflict (owner_id,id) do update set name = excluded.name`)).rejects.toThrow();
        await run(db, { user: USER_A }, "update public.players set name='Wrong'");
        await expect(run(db, { user: USER_A }, "insert into storage.objects(bucket_id,name) values ('player-photos',$1)", [USER_A + '/player/new.jpg'])).rejects.toThrow();
        await run(db, { user: USER_A }, "update storage.objects set name = name || 'x'");
        await run(db, { user: USER_A }, 'delete from storage.objects');
        expect((await db.query('select name from public.players')).rows).toEqual([{ name: 'Ann' }]);
        expect((await db.query('select name from storage.objects')).rows).toEqual([{ name: USER_A + '/player/revision.jpg' }]);
        await expect(run(db, { user: USER_A }, 'select public.delete_my_players()')).rejects.toThrow(/Update the app/);
      } finally { /* shared db closed in afterAll */ }
    });
  }

  it('allows the current client to upsert, add and remove photos, and purge', async () => {
    const db = await seeded();
    try {
      await header(db, '2');
      await run(db, { user: USER_A }, `insert into public.players(id,name) values ('${ID1}','Renamed') on conflict (owner_id,id) do update set name = excluded.name`);
      await run(db, { user: USER_A }, "insert into storage.objects(bucket_id,name) values ('player-photos',$1)", [USER_A + '/player/new.jpg']);
      await run(db, { user: USER_A }, "delete from storage.objects where name like '%revision.jpg'");
      expect((await db.query('select name from public.players')).rows).toEqual([{ name: 'Renamed' }]);
      expect((await db.query('select name from storage.objects')).rows).toEqual([{ name: USER_A + '/player/new.jpg' }]);
      expect((await run(db, { user: USER_A }, 'select public.delete_my_players() as n')).rows).toEqual([{ n: 1 }]);
    } finally { /* shared db closed in afterAll */ }
  });

  it('does not gate other storage buckets', async () => {
    const db = await seeded();
    try {
      await header(db, null);
      await db.query("insert into storage.buckets(id,name) values ('other','other')");
      // Give the other bucket its own permissive insert policy, as a future bucket would have. With no version header,
      // writes there must still pass: the gate is scoped to player-photos only.
      await db.query("create policy other_insert on storage.objects for insert to authenticated with check (bucket_id = 'other')");
      await run(db, { user: USER_A }, "insert into storage.objects(bucket_id,name) values ('other',$1)", [USER_A + '/x.jpg']);
      expect((await db.query("select count(*)::int as n from storage.objects where bucket_id = 'other'")).rows).toEqual([{ n: 1 }]);
    } finally { /* shared db closed in afterAll */ }
  });
});
