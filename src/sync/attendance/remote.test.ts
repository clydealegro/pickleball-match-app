// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { USER_A, USER_B, createDb, run } from '../db/harness';
import { isRemoteError } from '../remote';
import { fakeAttendanceRemote, type FakeFlags } from './fakeRemote';
import { linkRow } from './links';
import type { AttendanceRemote } from './remote';

const ANA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';

let db: PGlite;
let flags: FakeFlags;
let a: AttendanceRemote;
let b: AttendanceRemote;

beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec('truncate public.players, public.attendance_links cascade');
  await db.exec(`
    insert into public.players (owner_id, id, name) values ('${USER_A}', '${ANA}', 'Ana Reyes'), ('${USER_A}', '${BEN}', 'Ben Cruz')
  `);
  flags = { offline: false, calls: [] };
  a = fakeAttendanceRemote(db, USER_A, flags);
  b = fakeAttendanceRemote(db, USER_B);
});

const tue = linkRow({ id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Sample Hall', courts: 3 }, 'Asia/Manila');
const row = async (user: string, slot = 'tue') =>
  (await db.query<Record<string, unknown>>(
    'select code, title, venue, courts, closed_through::text as closed_through from public.attendance_links where owner_id = $1 and slot_id = $2',
    [user, slot],
  )).rows[0];
const cancellations = async () =>
  (await db.query<{ slot_id: string; play_date: string; reason: string | null; owner_id: string }>(
    'select owner_id, slot_id, play_date::text as play_date, reason from public.attendance_cancellations order by owner_id, slot_id, play_date',
  )).rows;
const answerAs = (code: string, player: string, status: string) =>
  run(db, 'anon', 'select public.attendance_answer($1, $2, $3, false)', [code, player, status]);
const guest = (code: string, name: string, by: string | null = null) =>
  run(db, 'anon', 'select public.attendance_add_guest($1, $2, $3)', [code, name, by]);

describe('the link', () => {
  it('is created, and found again with its code and no closed date', async () => {
    expect(await a.getLink('tue')).toBeNull();
    await a.upsertLink(tue);
    const link = await a.getLink('tue');
    expect(link?.code).toMatch(/^[0-9a-f]{24}$/);
    expect(link?.closedThrough).toBeNull();
  });

  it('is updated without changing its code or closed date', async () => {
    await a.upsertLink(tue);
    const before = await a.getLink('tue');
    await a.closeThrough('tue', '2026-11-10');
    await a.upsertLink({ ...tue, venue: 'New Hall', courts: 5, title: 'Tuesday open play' });
    const after = await a.getLink('tue');
    expect(after).toEqual({ code: before!.code, closedThrough: '2026-11-10' });
    expect(await row(USER_A)).toMatchObject({ venue: 'New Hall', courts: 5 });
  });

  it('clears a time that was removed from the slot', async () => {
    await a.upsertLink(tue);
    await a.upsertLink({ ...tue, start_min: null, end_min: null, venue: null, courts: null });
    const { rows } = await db.query('select start_min, end_min, venue, courts from public.attendance_links');
    expect(rows).toEqual([{ start_min: null, end_min: null, venue: null, courts: null }]);
  });

  it('gets a new code from resetLink, and the old code stops working', async () => {
    await a.upsertLink(tue);
    const old = (await a.getLink('tue'))!.code;
    const fresh = await a.resetLink('tue');
    expect(fresh).toMatch(/^[0-9a-f]{24}$/);
    expect(fresh).not.toBe(old);
    expect((await a.getLink('tue'))!.code).toBe(fresh);
    expect(await a.view(old)).toBeNull();
    expect(await a.view(fresh!)).not.toBeNull();
  });

  it('gives null from resetLink when there is no link', async () => {
    expect(await a.resetLink('tue')).toBeNull();
  });
});

describe('another organizer', () => {
  it('cannot see, reset, close or cancel the first organizer link', async () => {
    await a.upsertLink(tue);
    const code = (await a.getLink('tue'))!.code;
    expect(await b.getLink('tue')).toBeNull();
    expect(await b.resetLink('tue')).toBeNull();
    await b.closeThrough('tue', '2030-01-01');
    await expect(b.cancel('tue', '2026-11-10', 'x')).rejects.toMatchObject({ kind: 'server' });
    expect(await row(USER_A)).toMatchObject({ code, closed_through: null });
    expect(await cancellations()).toEqual([]);
  });

  it('writing the same slot id makes their own link and leaves the first alone', async () => {
    await a.upsertLink(tue);
    await b.upsertLink({ ...tue, venue: 'B Hall' });
    expect((await row(USER_A))!.venue).toBe('Sample Hall');
    expect((await row(USER_B))!.venue).toBe('B Hall');
    expect((await b.getLink('tue'))!.code).not.toBe((await a.getLink('tue'))!.code);
  });

  it('cannot undo the first organizer cancellation', async () => {
    await a.upsertLink(tue);
    await a.cancel('tue', '2026-11-10', 'Rain');
    await b.undoCancel('tue', '2026-11-10');
    expect(await cancellations()).toHaveLength(1);
  });
});

describe('cancel and undo', () => {
  it('records a reason, and a second cancel replaces it', async () => {
    await a.upsertLink(tue);
    await a.cancel('tue', '2026-11-10', 'Rain');
    expect(await cancellations()).toEqual([{ owner_id: USER_A, slot_id: 'tue', play_date: '2026-11-10', reason: 'Rain' }]);
    await a.cancel('tue', '2026-11-10', 'Court closed');
    expect(await cancellations()).toEqual([{ owner_id: USER_A, slot_id: 'tue', play_date: '2026-11-10', reason: 'Court closed' }]);
  });

  it('stores no reason as null, and keeps other dates', async () => {
    await a.upsertLink(tue);
    await a.cancel('tue', '2026-11-10', '');
    await a.cancel('tue', '2026-11-17', 'Holiday');
    expect((await cancellations()).map((c) => [c.play_date, c.reason])).toEqual([
      ['2026-11-10', null],
      ['2026-11-17', 'Holiday'],
    ]);
  });

  it('refuses a reason over 140 characters', async () => {
    await a.upsertLink(tue);
    await expect(a.cancel('tue', '2026-11-10', 'x'.repeat(141))).rejects.toMatchObject({ kind: 'server' });
  });

  it('undo removes only that date', async () => {
    await a.upsertLink(tue);
    await a.cancel('tue', '2026-11-10', 'Rain');
    await a.cancel('tue', '2026-11-17', null);
    await a.undoCancel('tue', '2026-11-10');
    expect((await cancellations()).map((c) => c.play_date)).toEqual(['2026-11-17']);
  });

  it('shows in the view for the date, and members then see it cancelled', async () => {
    await a.upsertLink(tue);
    const code = (await a.getLink('tue'))!.code;
    const date = (await a.view(code))!.play_date;
    await a.cancel('tue', date, 'Rain');
    expect((await a.view(code))!.cancelled).toEqual({ reason: 'Rain' });
    await a.undoCancel('tue', date);
    expect((await a.view(code))!.cancelled).toBeNull();
  });
});

describe('closeThrough', () => {
  it('moves forward only', async () => {
    await a.upsertLink(tue);
    await a.closeThrough('tue', '2026-11-10');
    expect((await row(USER_A))!.closed_through).toBe('2026-11-10');
    await a.closeThrough('tue', '2026-11-03');
    expect((await row(USER_A))!.closed_through).toBe('2026-11-10');
    await a.closeThrough('tue', '2026-11-10');
    expect((await row(USER_A))!.closed_through).toBe('2026-11-10');
    await a.closeThrough('tue', '2026-11-17');
    expect((await row(USER_A))!.closed_through).toBe('2026-11-17');
  });

  it('does nothing for a slot with no link', async () => {
    await expect(a.closeThrough('wed', '2026-11-10')).resolves.toBeUndefined();
  });
});

describe('view and waiting names', () => {
  it('shows the organizer the roster, the answers and the friends count', async () => {
    await a.upsertLink(tue);
    const code = (await a.getLink('tue'))!.code;
    await answerAs(code, ANA, 'in');
    await answerAs(code, BEN, 'maybe');
    await guest(code, 'Zed Zane', ANA);
    const v = await a.view(code);
    expect(v).toMatchObject({ title: 'Tuesday open play', weekday: 2, venue: 'Sample Hall', courts: 3, friends: 1 });
    expect(v!.players.map((p) => p.first_name)).toEqual(['Ana', 'Ben']);
    expect(v!.answers.map((x) => [x.player_id, x.status]).sort()).toEqual([[ANA, 'in'], [BEN, 'maybe']]);
  });

  it('returns null for an unknown code', async () => {
    expect(await a.view('0'.repeat(24))).toBeNull();
  });

  it('lists only pending names for the date, with who brought them', async () => {
    await a.upsertLink(tue);
    const code = (await a.getLink('tue'))!.code;
    const date = (await a.view(code))!.play_date;
    await guest(code, 'Newbie');
    await guest(code, 'Friend', ANA);
    await guest(code, 'Done');
    await run(db, { user: USER_A }, "update public.attendance_guests set state = 'added' where name = 'Done'");
    await run(db, { user: USER_A }, "update public.attendance_guests set state = 'dismissed' where name = 'Friend'");
    await guest(code, 'Friend2', BEN);
    const list = await a.listWaiting('tue', date);
    expect(list.map((g) => [g.name, g.broughtBy]).sort()).toEqual([['Friend2', BEN], ['Newbie', null]]);
    expect(list[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await a.listWaiting('tue', '2020-01-07')).toEqual([]);
  });

  it('does not list another organizer waiting names', async () => {
    await a.upsertLink(tue);
    const code = (await a.getLink('tue'))!.code;
    const date = (await a.view(code))!.play_date;
    await guest(code, 'Newbie');
    expect(await b.listWaiting('tue', date)).toEqual([]);
  });
});

describe('the in-memory remote itself', () => {
  it('fails with an offline error and changes nothing while offline', async () => {
    flags.offline = true;
    const error = await a.upsertLink(tue).catch((e: unknown) => e);
    expect(isRemoteError(error) && error.kind).toBe('offline');
    flags.offline = false;
    expect(await a.getLink('tue')).toBeNull();
  });

  it('logs each call by name', async () => {
    await a.upsertLink(tue);
    await a.getLink('tue');
    await a.cancel('tue', '2026-11-10', null);
    await a.undoCancel('tue', '2026-11-10');
    await a.closeThrough('tue', '2026-11-10');
    await a.resetLink('tue');
    await a.listWaiting('tue', '2026-11-10');
    await a.view('abc');
    expect(flags.calls).toEqual([
      'upsertLink:tue',
      'getLink:tue',
      'cancel:tue:2026-11-10',
      'undoCancel:tue:2026-11-10',
      'closeThrough:tue:2026-11-10',
      'resetLink:tue',
      'listWaiting:tue:2026-11-10',
      'view',
    ]);
  });
});
