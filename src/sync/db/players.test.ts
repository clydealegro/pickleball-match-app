// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { USER_A, USER_B, createDb, run, type Caller } from './harness';

const ANN = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const CY = '33333333-3333-4333-8333-333333333333';

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec('truncate public.players cascade');
});

/** Inserts a player as `caller`; `extra` adds numeric columns such as photo_version. */
function insertPlayer(caller: Caller, id: string, name: string, extra: Record<string, number> = {}) {
  const columns = ['id', 'name', ...Object.keys(extra)];
  const params = [id, name, ...Object.values(extra)];
  const marks = params.map((_, i) => `$${i + 1}`).join(', ');
  return run(db, caller, `insert into public.players (${columns.join(', ')}) values (${marks})`, params);
}

describe('players table', () => {
  it('fills in the owner from the signed-in user', async () => {
    await insertPlayer({ user: USER_A }, ANN, 'Ann');
    const rows = (await run(db, { user: USER_A }, 'select owner_id, name, photo_version, photo_seq from public.players')).rows;
    expect(rows).toEqual([{ owner_id: USER_A, name: 'Ann', photo_version: 0, photo_seq: 0 }]);
  });

  it('turns away someone who is not signed in', async () => {
    await expect(insertPlayer('anon', ANN, 'Ann')).rejects.toThrow(/permission denied/i);
    await expect(run(db, 'anon', 'select * from public.players')).rejects.toThrow(/permission denied/i);
  });

  it('does not let an organizer write a row for someone else', async () => {
    await expect(
      run(db, { user: USER_A }, 'insert into public.players (owner_id, id, name) values ($1, $2, $3)', [USER_B, ANN, 'Ann']),
    ).rejects.toThrow(/row-level security/i);
  });

  it('shows each organizer only their own rows', async () => {
    await insertPlayer({ user: USER_A }, ANN, 'Ann');
    await insertPlayer({ user: USER_B }, BEN, 'Ben');
    const a = await run(db, { user: USER_A }, 'select name from public.players');
    const b = await run(db, { user: USER_B }, 'select name from public.players');
    expect(a.rows).toEqual([{ name: 'Ann' }]);
    expect(b.rows).toEqual([{ name: 'Ben' }]);
  });

  it('does not let an organizer change someone else\'s row', async () => {
    await insertPlayer({ user: USER_A }, ANN, 'Ann');
    const result = await run(db, { user: USER_B }, "update public.players set name = 'Hacked' where id = $1", [ANN]);
    expect(result.affectedRows).toBe(0);
    const still = await db.query<{ name: string }>('select name from public.players where id = $1', [ANN]);
    expect(still.rows[0].name).toBe('Ann');
  });

  it('does not let an organizer hand their row to someone else, however the update is written', async () => {
    await insertPlayer({ user: USER_A }, ANN, 'Ann');
    // With a WHERE on a column, the select policy also checks the new row. Without one, only the update policy does.
    const attempts: Array<[string, unknown[]]> = [
      ['update public.players set owner_id = $1 where id = $2', [USER_B, ANN]],
      ['update public.players set owner_id = $1', [USER_B]],
    ];
    for (const [sql, params] of attempts) {
      await expect(run(db, { user: USER_A }, sql, params)).rejects.toThrow(/row-level security/i);
    }
  });

  it('has no hard delete for organizers', async () => {
    await insertPlayer({ user: USER_A }, ANN, 'Ann');
    await expect(run(db, { user: USER_A }, 'delete from public.players where id = $1', [ANN])).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('keeps a player after a soft delete, so the deletion can sync', async () => {
    await insertPlayer({ user: USER_A }, ANN, 'Ann');
    await run(db, { user: USER_A }, 'update public.players set deleted_at = now() where id = $1', [ANN]);
    const rows = (await run(db, { user: USER_A }, 'select deleted_at is not null as deleted from public.players')).rows;
    expect(rows).toEqual([{ deleted: true }]);
  });

  it('sets updated_at from the server on insert and on every update, whatever the client sends', async () => {
    await run(db, { user: USER_A }, "insert into public.players (id, name, updated_at) values ($1, 'Ann', '2000-01-01')", [ANN]);
    const first = (await db.query<{ updated_at: Date }>('select updated_at from public.players')).rows[0].updated_at;
    expect(first.getFullYear()).toBeGreaterThan(2020);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await run(db, { user: USER_A }, "update public.players set name = 'Annie', updated_at = '2001-01-01' where id = $1", [ANN]);
    const second = (await db.query<{ updated_at: Date }>('select updated_at from public.players')).rows[0].updated_at;
    expect(second.getTime()).toBeGreaterThan(first.getTime());
    expect(second.getFullYear()).toBeGreaterThan(2020);
  });

  it('stamps each row with the time it was written, even inside one long transaction', async () => {
    await db.transaction(async (tx) => {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USER_A, role: 'authenticated' })]);
      await tx.query("insert into public.players (id, name) values ($1, 'Ann')", [ANN]);
      await tx.query('select pg_sleep(0.05)');
      await tx.query("insert into public.players (id, name) values ($1, 'Ben')", [BEN]);
    });
    const { rows } = await db.query<{ name: string; updated_at: Date }>('select name, updated_at from public.players order by name');
    const [ann, ben] = rows;
    expect(ben.updated_at.getTime()).toBeGreaterThan(ann.updated_at.getTime());
  });

  it('keeps names unique per organizer, ignoring case and spaces, among players who are not deleted', async () => {
    await insertPlayer({ user: USER_A }, ANN, 'Ann');
    await expect(insertPlayer({ user: USER_A }, BEN, '  ANN ')).rejects.toThrow(/duplicate key/i);
    // another organizer may use the same name
    await insertPlayer({ user: USER_B }, BEN, 'Ann');
    // a deleted name can be used again
    await run(db, { user: USER_A }, 'update public.players set deleted_at = now() where id = $1', [ANN]);
    await insertPlayer({ user: USER_A }, CY, 'Ann');
  });

  it('rejects an empty name and a negative photo count', async () => {
    await expect(insertPlayer({ user: USER_A }, ANN, '   ')).rejects.toThrow(/check constraint/i);
    await expect(insertPlayer({ user: USER_A }, ANN, 'Ann', { photo_version: -1 })).rejects.toThrow(/check constraint/i);
    await expect(insertPlayer({ user: USER_A }, ANN, 'Ann', { photo_seq: -1 })).rejects.toThrow(/check constraint/i);
  });

  it('supports the upsert the sync will use (insert, then update on conflict)', async () => {
    const upsert = `insert into public.players (id, name, photo_version, photo_seq) values ($1, $2, $3, $4)
      on conflict (owner_id, id) do update set name = excluded.name, photo_version = excluded.photo_version, photo_seq = excluded.photo_seq`;
    await run(db, { user: USER_A }, upsert, [ANN, 'Ann', 0, 0]);
    await run(db, { user: USER_A }, upsert, [ANN, 'Annie', 1, 1]);
    const rows = (await run(db, { user: USER_A }, 'select name, photo_version, photo_seq from public.players')).rows;
    expect(rows).toEqual([{ name: 'Annie', photo_version: 1, photo_seq: 1 }]);
  });
});
