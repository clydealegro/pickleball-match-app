// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A } from '../sync/db/harness';

const callers: unknown[] = [];
vi.mock('../sync/db/harness', async (importOriginal) => {
  const real = await importOriginal<typeof import('../sync/db/harness')>();
  return {
    ...real,
    run: (db: PGlite, caller: Parameters<typeof real.run>[1], sql: string, params?: unknown[]) => {
      callers.push(caller);
      return real.run(db, caller, sql, params);
    },
  };
});

const { createDb } = await import('../sync/db/harness');
const { fakeMemberRemote } = await import('./fakeRemote');

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
  await db.exec(`insert into public.attendance_links (owner_id, slot_id, code, title, weekday) values ('${USER_A}', 'tue', 'abcdef0123456789abcdef01', 'Tuesday open play', 2)`);
});
afterAll(async () => {
  await db.close();
});

describe('fakeMemberRemote', () => {
  it('runs every call as the anonymous role', async () => {
    const remote = fakeMemberRemote(db);
    await remote.view('abcdef0123456789abcdef01');
    await remote.answer('abcdef0123456789abcdef01', '99999999-9999-4999-8999-999999999999', 'in', false).catch(() => undefined);
    await remote.addGuest('abcdef0123456789abcdef01', 'Zed', null);
    expect(callers).toEqual(['anon', 'anon', 'anon']);
  });
});
