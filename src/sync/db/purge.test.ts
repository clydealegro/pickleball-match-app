// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { USER_A, USER_B, createDb, run } from './harness';

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
  await db.exec('truncate public.players');
});

const insert = (user: string, id: string, name: string) =>
  run(db, { user }, 'insert into public.players (id, name) values ($1, $2)', [id, name]);

describe('delete_my_players()', () => {
  it('deletes every one of the caller\'s rows, soft-deleted ones too, and returns how many', async () => {
    await insert(USER_A, ANN, 'Ann');
    await insert(USER_A, BEN, 'Ben');
    await run(db, { user: USER_A }, 'update public.players set deleted_at = now() where id = $1', [BEN]);

    const result = await run(db, { user: USER_A }, 'select public.delete_my_players() as removed');
    expect(result.rows).toEqual([{ removed: 2 }]);
    expect((await db.query('select count(*)::int as n from public.players')).rows).toEqual([{ n: 0 }]);
  });

  it('leaves other organizers\' rows alone', async () => {
    await insert(USER_A, ANN, 'Ann');
    await insert(USER_B, CY, 'Cy');
    await run(db, { user: USER_A }, 'select public.delete_my_players()');
    expect((await db.query('select name from public.players')).rows).toEqual([{ name: 'Cy' }]);
  });

  it('works when there is nothing to delete', async () => {
    const result = await run(db, { user: USER_A }, 'select public.delete_my_players() as removed');
    expect(result.rows).toEqual([{ removed: 0 }]);
  });

  it('cannot be called by someone who is not signed in', async () => {
    await expect(run(db, 'anon', 'select public.delete_my_players()')).rejects.toThrow(/permission denied/i);
  });

  it('is not callable by default: only signed-in users hold execute', async () => {
    const { rows } = await db.query<{ grantee: string }>(
      `select distinct grantee from information_schema.routine_privileges
       where routine_schema = 'public' and routine_name = 'delete_my_players' and privilege_type = 'EXECUTE'
       order by grantee`,
    );
    const grantees = rows.map((r) => r.grantee);
    expect(grantees).toContain('authenticated');
    expect(grantees).not.toContain('anon');
    expect(grantees).not.toContain('PUBLIC');
  });
});
