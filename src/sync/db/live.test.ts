// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { USER_A, USER_B, createDb, run } from './harness';

const ANA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const THUMB = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD';

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => {
  await db.close();
});

/** Organizer A has a Tuesday link. Organizer B has a Tuesday link of their own. */
beforeEach(async () => {
  await db.exec('truncate public.live_boards, public.live_photos, public.attendance_links cascade');
  await db.exec(`
    insert into public.attendance_links (owner_id, slot_id, title, weekday) values
      ('${USER_A}', 'tue', 'Tuesday', 2), ('${USER_B}', 'tue', 'Tuesday B', 2);
  `);
});

const code = async (owner: string) =>
  ((await db.query<{ code: string }>("select code from public.attendance_links where slot_id = 'tue' and owner_id = $1", [owner])).rows[0]).code;

const SNAP = { name: 'Tuesday', courts: [{ n: 1, status: 'playing' }], waiting: ['p1'] };
const publish = (owner: string, over: { snapshot?: unknown; version?: number; active?: boolean; paused?: boolean; photos?: boolean } = {}) =>
  run(
    db,
    { user: owner },
    `insert into public.live_boards (slot_id, session_id, snapshot, version, active, paused, show_photos)
     values ('tue', 's1', $1::jsonb, $2, $3, $4, $5)
     on conflict (owner_id, slot_id) do update set snapshot = excluded.snapshot, version = excluded.version,
       active = excluded.active, paused = excluded.paused, show_photos = excluded.show_photos`,
    [JSON.stringify(over.snapshot ?? SNAP), over.version ?? 1, over.active ?? true, over.paused ?? false, over.photos ?? true],
  );
const addPhoto = (owner: string, id: string, seq: number, data = THUMB) =>
  run(db, { user: owner }, "insert into public.live_photos (slot_id, roster_id, photo_seq, data) values ('tue', $1, $2, $3)", [id, seq, data]);
const view = async (c: string, since: number | null = null) =>
  ((await run(db, 'anon', 'select public.live_view($1, $2) as v', [c, since])).rows[0] as { v: Record<string, unknown> | null }).v;
const photos = async (c: string, have: string[] = []) =>
  ((await run(db, 'anon', 'select public.live_photos($1, $2::text[]) as p', [c, have])).rows[0] as { p: { id: string; seq: number; data: string }[] }).p;

describe('live_view', () => {
  it('is null for an unknown code', async () => {
    expect(await view('0'.repeat(24))).toBeNull();
  });

  it('is idle while nothing is published', async () => {
    expect(await view(await code(USER_A))).toEqual({ state: 'idle' });
  });

  it('gives the board, with its version, to anyone who has the code', async () => {
    await publish(USER_A, { version: 7 });
    expect(await view(await code(USER_A))).toEqual({ state: 'live', version: 7, age_s: expect.any(Number), show_photos: true, board: SNAP });
  });

  it('answers with a few bytes when the visitor already has the version', async () => {
    await publish(USER_A, { version: 7 });
    expect(await view(await code(USER_A), 7)).toEqual({ state: 'live', version: 7, age_s: expect.any(Number), unchanged: true });
    expect((await view(await code(USER_A), 6))?.board).toEqual(SNAP);
  });

  it('says paused without the board when the organizer paused sharing', async () => {
    await publish(USER_A, { paused: true });
    expect(await view(await code(USER_A))).toEqual({ state: 'paused', version: 1, age_s: expect.any(Number) });
  });

  it('is idle once the session is over, and after 12 hours without a write', async () => {
    await publish(USER_A, { active: false });
    expect(await view(await code(USER_A))).toEqual({ state: 'idle' });
    await publish(USER_A, { active: true });
    await db.exec("alter table public.live_boards disable trigger live_boards_touch; update public.live_boards set updated_at = now() - interval '13 hours'; alter table public.live_boards enable trigger live_boards_touch;");
    expect(await view(await code(USER_A))).toEqual({ state: 'idle' });
  });

  it('shows one organizer\'s board only for that organizer\'s code', async () => {
    await publish(USER_A);
    expect(await view(await code(USER_B))).toEqual({ state: 'idle' });
  });

  it('reports how long ago the board was written, which a heartbeat resets', async () => {
    await publish(USER_A);
    await db.exec("alter table public.live_boards disable trigger live_boards_touch; update public.live_boards set updated_at = now() - interval '90 seconds'; alter table public.live_boards enable trigger live_boards_touch;");
    expect(((await view(await code(USER_A))) as { age_s: number }).age_s).toBeGreaterThanOrEqual(90);
    await run(db, { user: USER_A }, "update public.live_boards set version = version where slot_id = 'tue'");
    expect(((await view(await code(USER_A))) as { age_s: number }).age_s).toBeLessThan(5);
  });
});

describe('live_photos', () => {
  beforeEach(async () => {
    await publish(USER_A);
    await addPhoto(USER_A, ANA, 3);
    await addPhoto(USER_A, BEN, 1);
  });

  it('gives every face for a code', async () => {
    const got = await photos(await code(USER_A));
    expect(got.map((p) => [p.id, p.seq]).sort()).toEqual([[ANA, 3], [BEN, 1]]);
    expect(got[0].data).toBe(THUMB);
  });

  it('leaves out the faces the visitor already has, and sends a face again when its version changed', async () => {
    expect((await photos(await code(USER_A), [`${ANA}:3`])).map((p) => p.id)).toEqual([BEN]);
    expect((await photos(await code(USER_A), [`${ANA}:2`, `${BEN}:1`])).map((p) => p.id)).toEqual([ANA]);
    expect(await photos(await code(USER_A), [`${ANA}:3`, `${BEN}:1`])).toEqual([]);
  });

  it('is empty when photos are off, paused, over, or the code is unknown', async () => {
    const c = await code(USER_A);
    await publish(USER_A, { photos: false });
    expect(await photos(c)).toEqual([]);
    await publish(USER_A, { paused: true });
    expect(await photos(c)).toEqual([]);
    await publish(USER_A, { active: false });
    expect(await photos(c)).toEqual([]);
    expect(await photos('0'.repeat(24))).toEqual([]);
  });

  it('does not give one organizer\'s faces to another organizer\'s code', async () => {
    expect(await photos(await code(USER_B))).toEqual([]);
  });

  it('goes when the board row goes', async () => {
    await run(db, { user: USER_A }, "delete from public.live_boards where slot_id = 'tue'");
    expect((await db.query('select * from public.live_photos')).rows).toEqual([]);
  });
});

describe('what is allowed to be written', () => {
  it('keeps the tables closed to visitors', async () => {
    await publish(USER_A);
    await expect(run(db, 'anon', 'select * from public.live_boards')).rejects.toThrow();
    await expect(run(db, 'anon', 'select * from public.live_photos')).rejects.toThrow();
    await expect(run(db, 'anon', "insert into public.live_boards (owner_id, slot_id, session_id, snapshot, version) values ('" + USER_A + "', 'tue', 'x', '{}', 1)")).rejects.toThrow();
  });

  it('lets an organizer see and change only their own board', async () => {
    await publish(USER_A);
    expect((await run(db, { user: USER_B }, 'select * from public.live_boards')).rows).toEqual([]);
    await run(db, { user: USER_B }, "update public.live_boards set paused = true");
    expect(((await db.query<{ paused: boolean }>("select paused from public.live_boards where owner_id = $1", [USER_A])).rows[0]).paused).toBe(false);
  });

  it('only allows a board on a slot that has a link', async () => {
    await expect(
      run(db, { user: USER_A }, "insert into public.live_boards (slot_id, session_id, snapshot, version) values ('nope', 's', '{}', 1)"),
    ).rejects.toThrow();
  });

  it('refuses a snapshot that is too big or carries a private field', async () => {
    await expect(publish(USER_A, { snapshot: { pad: 'x'.repeat(25000) } })).rejects.toThrow();
    for (const key of ['rating', 'partnerCounts', 'opponentCounts', 'history', 'score', 'winner']) {
      await expect(publish(USER_A, { snapshot: { players: { p1: { [key]: 1 } } } })).rejects.toThrow();
    }
    await publish(USER_A, { snapshot: { name: 'rating is a word in a value' } });
  });

  it('refuses a photo that is not a small JPEG data URI', async () => {
    await publish(USER_A);
    await expect(addPhoto(USER_A, ANA, 1, 'data:image/png;base64,AAAA')).rejects.toThrow();
    await expect(addPhoto(USER_A, ANA, 1, 'https://example.com/a.jpg')).rejects.toThrow();
    await expect(addPhoto(USER_A, ANA, 1, 'data:image/jpeg;base64,' + 'A'.repeat(17000))).rejects.toThrow();
  });

  it('refuses a photo for another organizer\'s board', async () => {
    await publish(USER_A);
    await expect(addPhoto(USER_B, ANA, 1)).rejects.toThrow();
  });

  it('touches the time on every write', async () => {
    await publish(USER_A);
    await db.exec("alter table public.live_boards disable trigger live_boards_touch; update public.live_boards set updated_at = now() - interval '1 hour'; alter table public.live_boards enable trigger live_boards_touch;");
    await run(db, { user: USER_A }, "update public.live_boards set version = version + 1");
    const age = ((await db.query<{ s: number }>("select extract(epoch from now() - updated_at)::int as s from public.live_boards")).rows[0]).s;
    expect(age).toBeLessThan(5);
  });
});
