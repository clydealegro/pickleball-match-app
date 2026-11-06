// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import script from '../../../supabase/tests/real-project-check.sql?raw';
import { createDb } from './harness';

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => {
  await db.close();
});

describe('supabase/tests/real-project-check.sql', () => {
  it('passes on the migrations and leaves nothing behind', async () => {
    await db.exec(script);
    expect((await db.query('select count(*)::int as n from public.players')).rows).toEqual([{ n: 0 }]);
    expect((await db.query('select count(*)::int as n from storage.objects')).rows).toEqual([{ n: 0 }]);
    expect((await db.query('select count(*)::int as n from auth.users where id in ($1, $2)', ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2'])).rows).toEqual([{ n: 0 }]);
  });

  it('stops with a message when a rule is broken', async () => {
    const broken = await createDb();
    await broken.exec('alter table public.players disable row level security');
    await expect(broken.exec(script)).rejects.toThrow(/can see Alice|changed Alice|wrote a player row/i);
    await broken.close();
  });
});
