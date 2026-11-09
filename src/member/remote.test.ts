// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { USER_A, createDb } from '../sync/db/harness';
import { fakeMemberRemote, type MemberFlags } from './fakeRemote';
import { isMemberError, type MemberRemote } from './remote';

const ANA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const BEN2 = '33333333-3333-4333-8333-333333333333';
const GONE = '44444444-4444-4444-8444-444444444444';
const CODE = 'abcdef0123456789abcdef01';

let db: PGlite;
let flags: MemberFlags;
let remote: MemberRemote;

beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec('truncate public.players, public.attendance_links cascade');
  await db.exec(`
    insert into public.players (owner_id, id, name) values
      ('${USER_A}', '${ANA}', 'Ana Reyes'),
      ('${USER_A}', '${BEN}', 'Ben Cruz'),
      ('${USER_A}', '${BEN2}', 'Ben Dela Rosa');
    insert into public.players (owner_id, id, name, deleted_at) values ('${USER_A}', '${GONE}', 'Gone Person', now());
    insert into public.attendance_links (owner_id, slot_id, code, title, weekday, start_min, end_min, venue, courts, timezone)
      values ('${USER_A}', 'tue', '${CODE}', 'Tuesday open play', extract(dow from (now() at time zone 'UTC'))::int, 1140, null, 'Sample Hall', 3, 'UTC');
  `);
  flags = { offline: false, calls: [] };
  remote = fakeMemberRemote(db, flags);
});

const reasonOf = async (p: Promise<unknown>) => {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  return isMemberError(error) ? error.reason : `not a MemberError: ${String(error)}`;
};
const answers = async () =>
  (await db.query<{ player_id: string; status: string; late: boolean }>(
    'select player_id, status, late from public.attendance_answers order by player_id',
  )).rows;
const guests = async () =>
  (await db.query<{ name: string; brought_by: string | null }>('select name, brought_by from public.attendance_guests order by created_at, name')).rows;
const cancelToday = async (reason: string | null) => {
  const date = (await remote.view(CODE))!.play_date;
  await db.query('insert into public.attendance_cancellations (owner_id, slot_id, play_date, reason) values ($1, $2, $3::date, $4)', [
    USER_A,
    'tue',
    date,
    reason,
  ]);
};

describe('view', () => {
  it('shows the link, the roster with first names and last initials, and no answers yet', async () => {
    const v = await remote.view(CODE);
    expect(v).toMatchObject({
      title: 'Tuesday open play',
      venue: 'Sample Hall',
      start_min: 1140,
      end_min: null,
      courts: 3,
      cancelled: null,
      answers: [],
      friends: 0,
    });
    expect(v!.play_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(v!.players.map((p) => [p.first_name, p.last_initial])).toEqual([
      ['Ana', 'R'],
      ['Ben', 'C'],
      ['Ben', 'D'],
    ]);
  });

  it('leaves out a removed player', async () => {
    const v = await remote.view(CODE);
    expect(v!.players.map((p) => p.id)).not.toContain(GONE);
  });

  it('is null for an unknown code', async () => {
    expect(await remote.view('0'.repeat(24))).toBeNull();
  });

  it('never carries a full name, an owner id or an email', async () => {
    await remote.answer(CODE, ANA, 'in', false);
    const text = JSON.stringify(await remote.view(CODE));
    expect(text).not.toContain('Reyes');
    expect(text).not.toContain('Cruz');
    expect(text).not.toContain('Dela Rosa');
    expect(text).not.toContain(USER_A);
    expect(text).not.toMatch(/owner|email|@/i);
    const [player] = (await remote.view(CODE))!.players;
    expect(Object.keys(player).sort()).toEqual(['first_name', 'has_photo', 'id', 'last_initial', 'photo_seq']);
  });

  it('carries each answer as a player id and a status, so a member can find their own', async () => {
    await remote.answer(CODE, BEN, 'out', false);
    const v = await remote.view(CODE);
    expect(v!.answers).toEqual([{ player_id: BEN, status: 'out', late: false }]);
    expect(Object.keys(v!.answers[0]).sort()).toEqual(['late', 'player_id', 'status']);
  });

  it('shows the cancellation with its reason', async () => {
    await cancelToday('Rain');
    expect((await remote.view(CODE))!.cancelled).toEqual({ reason: 'Rain' });
  });
});

describe('answer', () => {
  it.each(['in', 'maybe', 'out'] as const)('records %s', async (status) => {
    await remote.answer(CODE, ANA, status, false);
    expect(await answers()).toEqual([{ player_id: ANA, status, late: false }]);
    expect((await remote.view(CODE))!.answers).toEqual([{ player_id: ANA, status, late: false }]);
  });

  it('keeps late with In', async () => {
    await remote.answer(CODE, ANA, 'in', true);
    expect(await answers()).toEqual([{ player_id: ANA, status: 'in', late: true }]);
  });

  it('drops late for Maybe and Out', async () => {
    await remote.answer(CODE, ANA, 'maybe', true);
    expect((await answers())[0].late).toBe(false);
    await remote.answer(CODE, ANA, 'out', true);
    expect((await answers())[0].late).toBe(false);
  });

  it('replaces the earlier answer when a member changes their mind', async () => {
    await remote.answer(CODE, ANA, 'in', true);
    await remote.answer(CODE, ANA, 'maybe', false);
    await remote.answer(CODE, ANA, 'out', false);
    expect(await answers()).toEqual([{ player_id: ANA, status: 'out', late: false }]);
  });

  it('keeps one answer for each member', async () => {
    await remote.answer(CODE, ANA, 'in', false);
    await remote.answer(CODE, BEN, 'maybe', false);
    expect(await answers()).toHaveLength(2);
  });

  it('refuses a status it does not know as bad_status', async () => {
    expect(await reasonOf(remote.answer(CODE, ANA, 'yes' as never, false))).toBe('bad_status');
    expect(await answers()).toEqual([]);
  });

  it('refuses an unknown code as unknown_link', async () => {
    expect(await reasonOf(remote.answer('0'.repeat(24), ANA, 'in', false))).toBe('unknown_link');
  });

  it('refuses a cancelled date as cancelled', async () => {
    await cancelToday(null);
    expect(await reasonOf(remote.answer(CODE, ANA, 'in', false))).toBe('cancelled');
    expect(await answers()).toEqual([]);
  });

  it('refuses a removed player and a stranger as unknown_player', async () => {
    expect(await reasonOf(remote.answer(CODE, GONE, 'in', false))).toBe('unknown_player');
    expect(await reasonOf(remote.answer(CODE, '99999999-9999-4999-8999-999999999999', 'in', false))).toBe('unknown_player');
    expect(await answers()).toEqual([]);
  });

  it('refuses a player id that is not an id as a server error', async () => {
    expect(await reasonOf(remote.answer(CODE, 'not-a-uuid', 'in', false))).toBe('server');
  });
});

describe('addGuest', () => {
  it('adds a friend for the member who brought them, and counts it in the view', async () => {
    await remote.addGuest(CODE, '  Zed Zane ', ANA);
    expect(await guests()).toEqual([{ name: 'Zed Zane', brought_by: ANA }]);
    expect((await remote.view(CODE))!.friends).toBe(1);
  });

  it('adds a new member asking to join with no one bringing them, and does not count it as a friend', async () => {
    await remote.addGuest(CODE, 'Newbie', null);
    expect(await guests()).toEqual([{ name: 'Newbie', brought_by: null }]);
    expect((await remote.view(CODE))!.friends).toBe(0);
  });

  it('accepts 40 characters', async () => {
    await remote.addGuest(CODE, 'x'.repeat(40), null);
    expect(await guests()).toHaveLength(1);
  });

  it('refuses an empty name, a blank name and 41 characters as bad_name', async () => {
    expect(await reasonOf(remote.addGuest(CODE, '', null))).toBe('bad_name');
    expect(await reasonOf(remote.addGuest(CODE, '   ', null))).toBe('bad_name');
    expect(await reasonOf(remote.addGuest(CODE, 'x'.repeat(41), null))).toBe('bad_name');
    expect(await guests()).toEqual([]);
  });

  it('refuses an unknown code as unknown_link', async () => {
    expect(await reasonOf(remote.addGuest('0'.repeat(24), 'Zed', null))).toBe('unknown_link');
  });

  it('refuses a cancelled date as cancelled', async () => {
    await cancelToday('Rain');
    expect(await reasonOf(remote.addGuest(CODE, 'Zed', null))).toBe('cancelled');
  });

  it('refuses a removed or foreign member as the one who brought them, as unknown_player', async () => {
    expect(await reasonOf(remote.addGuest(CODE, 'Zed', GONE))).toBe('unknown_player');
    expect(await reasonOf(remote.addGuest(CODE, 'Zed', '99999999-9999-4999-8999-999999999999'))).toBe('unknown_player');
  });

  it('keeps at most 20 waiting names for the date, then says too_many', async () => {
    for (let i = 0; i < 20; i += 1) await remote.addGuest(CODE, `Guest ${i}`, null);
    expect(await reasonOf(remote.addGuest(CODE, 'One more', ANA))).toBe('too_many');
    expect(await guests()).toHaveLength(20);
  });
});

describe('the anonymous role', () => {
  it('cannot read the tables, only call the three functions', async () => {
    await expect(db.exec('set role anon; select * from public.attendance_links')).rejects.toThrow();
    await db.exec('reset role');
  });
});

describe('offline and the log', () => {
  it('fails every call as offline while the switch is on, and does not touch the database', async () => {
    flags.offline = true;
    expect(await reasonOf(remote.view(CODE))).toBe('offline');
    expect(await reasonOf(remote.answer(CODE, ANA, 'in', false))).toBe('offline');
    expect(await reasonOf(remote.addGuest(CODE, 'Zed', null))).toBe('offline');
    flags.offline = false;
    expect(await answers()).toEqual([]);
    expect(await guests()).toEqual([]);
  });

  it('logs what it was asked, in order', async () => {
    await remote.view(CODE);
    await remote.answer(CODE, ANA, 'in', true);
    await remote.addGuest(CODE, 'Zed', ANA);
    expect(flags.calls).toEqual([`view:${CODE}`, `answer:${CODE}:${ANA}:in:true`, `addGuest:${CODE}:Zed:${ANA}`]);
  });

  it('logs a call that fails offline too', async () => {
    flags.offline = true;
    await remote.view(CODE).catch(() => undefined);
    expect(flags.calls).toEqual([`view:${CODE}`]);
  });
});
