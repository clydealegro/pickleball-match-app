// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { USER_A, USER_B, createDb, run } from './harness';

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec('truncate storage.objects');
});

const put = (caller: Parameters<typeof run>[1], bucket: string, path: string) =>
  run(db, caller, 'insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, path]);
const names = async (caller: Parameters<typeof run>[1]) =>
  (await run(db, caller, 'select name from storage.objects order by name')).rows.map((r) => (r as { name: string }).name);

describe('player-photos bucket', () => {
  it('is private, small and JPEG only', async () => {
    const { rows } = await db.query('select public, file_size_limit, allowed_mime_types from storage.buckets where id = $1', [
      'player-photos',
    ]);
    expect(rows).toEqual([{ public: false, file_size_limit: 204800, allowed_mime_types: ['image/jpeg'] }]);
  });

  it('lets an organizer add a file under their own id', async () => {
    await put({ user: USER_A }, 'player-photos', `${USER_A}/player-1/1.jpg`);
    expect(await names({ user: USER_A })).toEqual([`${USER_A}/player-1/1.jpg`]);
  });

  it('does not let an organizer add a file under someone else\'s id, or outside any id folder', async () => {
    await expect(put({ user: USER_A }, 'player-photos', `${USER_B}/player-1/1.jpg`)).rejects.toThrow(/row-level security/i);
    await expect(put({ user: USER_A }, 'player-photos', 'loose.jpg')).rejects.toThrow(/row-level security/i);
  });

  it('does not let an organizer use the policies for a different bucket', async () => {
    await db.exec("insert into storage.buckets (id, name) values ('other', 'other')");
    await expect(put({ user: USER_A }, 'other', `${USER_A}/player-1/1.jpg`)).rejects.toThrow(/row-level security/i);
  });

  it('shows each organizer only their own files', async () => {
    await put({ user: USER_A }, 'player-photos', `${USER_A}/p/1.jpg`);
    await put({ user: USER_B }, 'player-photos', `${USER_B}/p/1.jpg`);
    expect(await names({ user: USER_A })).toEqual([`${USER_A}/p/1.jpg`]);
    expect(await names({ user: USER_B })).toEqual([`${USER_B}/p/1.jpg`]);
  });

  it('lets an organizer replace and delete their own files, and no one else\'s', async () => {
    await put({ user: USER_A }, 'player-photos', `${USER_A}/p/1.jpg`);
    await put({ user: USER_B }, 'player-photos', `${USER_B}/p/1.jpg`);

    const updateOwn = await run(db, { user: USER_A }, "update storage.objects set name = $1 where name = $2", [`${USER_A}/p/2.jpg`, `${USER_A}/p/1.jpg`]);
    expect(updateOwn.affectedRows).toBe(1);
    const updateOther = await run(db, { user: USER_A }, "update storage.objects set name = 'x' where name = $1", [`${USER_B}/p/1.jpg`]);
    expect(updateOther.affectedRows).toBe(0);
    await expect(
      run(db, { user: USER_A }, 'update storage.objects set name = $1 where name = $2', [`${USER_B}/stolen.jpg`, `${USER_A}/p/2.jpg`]),
    ).rejects.toThrow(/row-level security/i);

    const deleteOther = await run(db, { user: USER_A }, 'delete from storage.objects where name = $1', [`${USER_B}/p/1.jpg`]);
    expect(deleteOther.affectedRows).toBe(0);
    const deleteOwn = await run(db, { user: USER_A }, 'delete from storage.objects where name = $1', [`${USER_A}/p/2.jpg`]);
    expect(deleteOwn.affectedRows).toBe(1);
    expect(await names({ user: USER_B })).toEqual([`${USER_B}/p/1.jpg`]);
  });

  it('gives a signed-out visitor nothing', async () => {
    await put({ user: USER_A }, 'player-photos', `${USER_A}/p/1.jpg`);
    expect(await names('anon')).toEqual([]);
    await expect(put('anon', 'player-photos', `${USER_A}/p/2.jpg`)).rejects.toThrow(/row-level security/i);
  });
});
