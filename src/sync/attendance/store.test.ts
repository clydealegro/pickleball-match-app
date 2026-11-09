import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newTestSession } from '../../engine/testing';
import type { Session } from '../../engine';
import type { Slot } from '../../store/slots';
import { USER_A, USER_B, createDb, run } from '../db/harness';
import { RemoteError } from '../remote';
import { fakeAttendanceRemote, type FakeFlags } from './fakeRemote';
import type { AttendanceRemote } from './remote';
import { ATTENDANCE_KEY, parseAttendanceCache, resetAttendanceDeps, setAttendanceDeps, useAttendanceStore } from './store';

const ANA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const BEN2 = '33333333-3333-4333-8333-333333333333';
const TUE: Slot = { id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Hall', courts: 3 };
const THU: Slot = { id: 'thu', weekday: 4 };
const OFFLINE = 'No connection. Try again when you are online.';

let db: PGlite;
let flags: FakeFlags;
let now: number;
let zone: string;
let signedIn: string | null;
/** Wraps the real in-memory remote so a test can make single methods fail. */
let override: Partial<AttendanceRemote>;

beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec('truncate public.players, public.attendance_links cascade');
  await db.exec(`insert into public.players (owner_id, id, name) values
    ('${USER_A}', '${ANA}', 'Ana Reyes'), ('${USER_A}', '${BEN}', 'Ben Cruz')`);
  localStorage.clear();
  flags = { offline: false, calls: [] };
  now = Date.UTC(2026, 10, 9, 8, 0);
  zone = 'Asia/Manila';
  signedIn = USER_A;
  override = {};
  useAttendanceStore.getState().clear();
  setAttendanceDeps({
    server: () => {
      if (!signedIn) return null;
      const real = fakeAttendanceRemote(db, signedIn, flags);
      return { remote: { ...real, ...override }, userId: signedIn };
    },
    now: () => now,
    timezone: () => zone,
  });
});
afterEach(() => {
  resetAttendanceDeps();
  vi.restoreAllMocks();
});

const state = () => useAttendanceStore.getState();
const codeOf = async (slot = 'tue') =>
  (await db.query<{ code: string }>('select code from public.attendance_links where slot_id = $1', [slot])).rows[0]?.code;
const answerAs = (code: string, player: string, status: string, late = false) =>
  run(db, 'anon', 'select public.attendance_answer($1, $2, $3, $4)', [code, player, status, late]);
const guest = (code: string, name: string, by: string | null = null) =>
  run(db, 'anon', 'select public.attendance_add_guest($1, $2, $3)', [code, name, by]);
const closedThrough = async (slot = 'tue') =>
  (await db.query<{ d: string | null }>('select closed_through::text as d from public.attendance_links where slot_id = $1', [slot])).rows[0]?.d;
const cancellationRows = async () =>
  (await db.query<{ play_date: string; reason: string | null }>(
    'select play_date::text as play_date, reason from public.attendance_cancellations order by play_date',
  )).rows;
const sessionFrom = (slotId: string | undefined, createdAt: number): Session => ({
  ...newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }),
  createdAt,
  ...(slotId ? { slotId } : {}),
});
const cached = () => JSON.parse(localStorage.getItem(ATTENDANCE_KEY) ?? 'null');

describe('creating the link', () => {
  it('writes the link from the slot, remembers its code and loads the first summary', async () => {
    expect(await state().ensureLink(TUE)).toEqual({ ok: true });
    const code = await codeOf();
    expect(code).toMatch(/^[0-9a-f]{24}$/);
    expect(state().links).toEqual({ tue: { code } });
    expect(state().summaries.tue).toMatchObject({ slotId: 'tue', code, counts: { in: 0, maybe: 0, out: 0, late: 0 }, fetchedAt: now });
    expect(state().ownerId).toBe(USER_A);
    expect(state().busy.tue).toBeFalsy();
    const row = (await db.query('select title, weekday, start_min, end_min, venue, courts, timezone from public.attendance_links')).rows[0];
    expect(row).toEqual({ title: 'Tuesday open play', weekday: 2, start_min: 1140, end_min: 1260, venue: 'Hall', courts: 3, timezone: 'Asia/Manila' });
  });

  it('uses the device time zone when it is usable, and Asia/Manila when it is not', async () => {
    zone = 'Australia/Sydney';
    await state().ensureLink(TUE);
    expect((await db.query('select timezone from public.attendance_links')).rows[0]).toEqual({ timezone: 'Australia/Sydney' });
    await state().ensureLink(THU);
    zone = 'not a zone';
    await state().ensureLink({ ...THU, id: 'thu2' });
    expect((await db.query("select timezone from public.attendance_links where slot_id = 'thu2'")).rows[0]).toEqual({ timezone: 'Asia/Manila' });
  });

  it('is safe to press twice: one link, same code', async () => {
    await state().ensureLink(TUE);
    const code = await codeOf();
    await state().ensureLink(TUE);
    expect(await codeOf()).toBe(code);
    expect((await db.query('select count(*)::int as n from public.attendance_links')).rows[0]).toEqual({ n: 1 });
  });

  it('shows busy while it works', async () => {
    const seen: boolean[] = [];
    const unsubscribe = useAttendanceStore.subscribe((s) => seen.push(Boolean(s.busy.tue)));
    await state().ensureLink(TUE);
    unsubscribe();
    expect(seen).toContain(true);
    expect(seen.at(-1)).toBe(false);
  });
});

describe('refresh', () => {
  async function withAnswers() {
    await state().ensureLink(TUE);
    const code = (await codeOf())!;
    await answerAs(code, ANA, 'in', true);
    await answerAs(code, BEN, 'maybe');
    await guest(code, 'Zed', ANA);
    await guest(code, 'Newbie');
    return code;
  }

  it('reads the counts, the friends, the waiting names and the names', async () => {
    await withAnswers();
    now += 5000;
    expect(await state().refresh('tue')).toEqual({ ok: true });
    const s = state().summaries.tue;
    expect(s.counts).toEqual({ in: 1, maybe: 1, out: 0, late: 1 });
    expect(s.friends).toBe(1);
    expect(s.waiting.map((w) => w.name).sort()).toEqual(['Newbie', 'Zed']);
    expect(s.names).toEqual({ [ANA]: 'Ana', [BEN]: 'Ben' });
    expect(s.fetchedAt).toBe(now);
    expect(state().lastError.tue).toBeNull();
  });

  it('fills the play-tonight list and the late ids', async () => {
    const code = await withAnswers();
    await answerAs(code, BEN, 'in', false);
    await state().refresh('tue');
    expect(state().summaries.tue.tonight).toEqual([]);
    expect(state().summaries.tue.lateIds).toEqual([ANA]);
    const zed = state().summaries.tue.waiting.find((w) => w.name === 'Zed')!;
    await fakeAttendanceRemote(db, USER_A).setGuestState(zed.id, 'play_tonight');
    await state().refresh('tue');
    expect(state().summaries.tue.tonight.map((w) => [w.name, w.broughtBy])).toEqual([['Zed', ANA]]);
    expect(state().summaries.tue.waiting.map((w) => w.name)).toEqual(['Newbie']);
  });

  it('asks for the play-tonight list for the date of the view', async () => {
    await withAnswers();
    flags.calls.length = 0;
    await state().refresh('tue');
    const date = state().summaries.tue.playDate;
    expect(flags.calls).toContain(`listTonight:tue:${date}`);
    expect(flags.calls).toContain(`listWaiting:tue:${date}`);
  });

  it('keeps the cached summary when the request fails offline, and says why', async () => {
    await withAnswers();
    await state().refresh('tue');
    const before = state().summaries.tue;
    flags.offline = true;
    now += 60_000;
    const result = await state().refresh('tue');
    expect(result).toEqual({ ok: false, message: OFFLINE });
    expect(state().summaries.tue).toBe(before);
    expect(state().lastError.tue).toBe('offline');
    flags.offline = false;
    expect(await state().refresh('tue')).toEqual({ ok: true });
    expect(state().lastError.tue).toBeNull();
    expect(state().summaries.tue.fetchedAt).toBe(now);
  });

  it('keeps the cache and records an auth or server failure', async () => {
    await withAnswers();
    const before = state().summaries.tue;
    override = { view: async () => { throw new RemoteError('auth'); } };
    expect((await state().refresh('tue')).ok).toBe(false);
    expect(state().lastError.tue).toBe('auth');
    override = { view: async () => { throw new RemoteError('server'); } };
    expect((await state().refresh('tue')).ok).toBe(false);
    expect(state().lastError.tue).toBe('server');
    expect(state().summaries.tue).toBe(before);
  });

  it('finds a link made on another device', async () => {
    await run(db, { user: USER_A }, "insert into public.attendance_links (slot_id, title, weekday) values ('tue', 'Tuesday open play', 2)");
    expect(state().links.tue).toBeUndefined();
    await state().refresh('tue');
    expect(state().links.tue.code).toBe(await codeOf());
    expect(state().summaries.tue).toBeDefined();
  });

  it('leaves a slot with no link without a summary or an error', async () => {
    expect(await state().refresh('thu')).toEqual({ ok: true });
    expect(state().links.thu).toBeUndefined();
    expect(state().summaries.thu).toBeUndefined();
    expect(state().lastError.thu ?? null).toBeNull();
  });

  it('picks up a code reset on another device', async () => {
    await state().ensureLink(TUE);
    const staleCode = state().links.tue.code;
    const other = fakeAttendanceRemote(db, USER_A);
    const fresh = (await other.resetLink('tue'))!;
    await state().refresh('tue');
    expect(state().links.tue.code).toBe(fresh);
    expect(state().links.tue.code).not.toBe(staleCode);
    expect(state().summaries.tue.code).toBe(fresh);
  });

  it('drops the link when it no longer exists on the server', async () => {
    await state().ensureLink(TUE);
    await db.exec('truncate public.attendance_links cascade');
    await state().refresh('tue');
    expect(state().links.tue).toBeUndefined();
    expect(state().summaries.tue).toBeUndefined();
  });

  it('does nothing and changes nothing when nobody is signed in', async () => {
    await state().ensureLink(TUE);
    const before = state().summaries.tue;
    signedIn = null;
    flags.calls.length = 0;
    const result = await state().refresh('tue');
    expect(result.ok).toBe(false);
    expect(flags.calls).toEqual([]);
    expect(state().summaries.tue).toBe(before);
    expect(state().lastError.tue ?? null).toBeNull();
  });

  it('ignores a result that arrives after the cache was cleared', async () => {
    await state().ensureLink(TUE);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const real = fakeAttendanceRemote(db, USER_A);
    let asked = 0;
    override = { view: async (code) => { asked += 1; await gate; return real.view(code); } };
    const pending = state().refresh('tue');
    await vi.waitFor(() => expect(asked).toBe(1));
    state().clear();
    release();
    await pending;
    expect(state().summaries).toEqual({});
    expect(state().links).toEqual({});
  });
});

describe('refreshes that overlap', () => {
  it('send one request while one is already running for the slot', async () => {
    await state().ensureLink(TUE);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const real = fakeAttendanceRemote(db, USER_A);
    let asked = 0;
    override = { view: async (code) => { asked += 1; await gate; return real.view(code); } };
    const first = state().refresh('tue');
    const second = state().refresh('tue');
    release();
    await Promise.all([first, second]);
    expect(asked).toBe(1);
  });

  it('drop an answer from before the cache was cleared, even when a new refresh has started since', async () => {
    await state().ensureLink(TUE);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const real = fakeAttendanceRemote(db, USER_A);
    let asked = 0;
    override = { view: async (code) => { asked += 1; await gate; return real.view(code); } };
    const old = state().refresh('tue');
    await vi.waitFor(() => expect(asked).toBe(1));
    state().clear();
    signedIn = USER_B;
    // Two refreshes, so the new account's request counter reaches the old request's number.
    await state().refresh('tue');
    await state().refresh('tue');
    release();
    await old;
    expect(state().links).toEqual({});
    expect(state().summaries).toEqual({});
  });
});

describe('the last change', () => {
  it('names the latest answer that changed, with the time', async () => {
    await state().ensureLink(TUE);
    const code = (await codeOf())!;
    await answerAs(code, ANA, 'in');
    await answerAs(code, BEN, 'in');
    await state().refresh('tue');
    expect(state().lastChange.tue ?? null).toBeNull();
    await answerAs(code, BEN, 'out');
    now += 1000;
    await state().refresh('tue');
    expect(state().lastChange.tue).toEqual({ player: 'Ben', from: 'in', to: 'out', at: now });
  });

  it('keeps the last change when later refreshes find none', async () => {
    await state().ensureLink(TUE);
    const code = (await codeOf())!;
    await answerAs(code, BEN, 'in');
    await state().refresh('tue');
    await answerAs(code, BEN, 'maybe');
    await state().refresh('tue');
    const note = state().lastChange.tue;
    now += 60_000;
    await state().refresh('tue');
    expect(state().lastChange.tue).toEqual(note);
  });

  it('does not count a first answer as a change', async () => {
    await state().ensureLink(TUE);
    const code = (await codeOf())!;
    await state().refresh('tue');
    await answerAs(code, ANA, 'in');
    await state().refresh('tue');
    expect(state().lastChange.tue ?? null).toBeNull();
  });

  it('adds a last initial when two players share a first name', async () => {
    await db.exec(`insert into public.players (owner_id, id, name) values ('${USER_A}', '${BEN2}', 'Ben Dale')`);
    await state().ensureLink(TUE);
    const code = (await codeOf())!;
    await answerAs(code, BEN2, 'in');
    await state().refresh('tue');
    await answerAs(code, BEN2, 'out');
    await state().refresh('tue');
    expect(state().lastChange.tue?.player).toBe('Ben D.');
  });

  it('starts again when the link moves to a new date', async () => {
    await state().ensureLink(TUE);
    const code = (await codeOf())!;
    await answerAs(code, BEN, 'in');
    await state().refresh('tue');
    await answerAs(code, BEN, 'out');
    await state().refresh('tue');
    expect(state().lastChange.tue).not.toBeNull();
    const date = state().summaries.tue.playDate;
    await fakeAttendanceRemote(db, USER_A).closeThrough('tue', date);
    await state().refresh('tue');
    expect(state().summaries.tue.playDate).not.toBe(date);
    expect(state().lastChange.tue ?? null).toBeNull();
  });
});

describe('reset, cancel and undo', () => {
  it('resets to a new code, keeps the answers, and the old code stops working', async () => {
    await state().ensureLink(TUE);
    const old = (await codeOf())!;
    await answerAs(old, ANA, 'in');
    await state().refresh('tue');
    expect(await state().resetLink('tue')).toEqual({ ok: true });
    const fresh = (await codeOf())!;
    expect(fresh).not.toBe(old);
    expect(state().links.tue.code).toBe(fresh);
    expect(state().summaries.tue.code).toBe(fresh);
    expect(state().summaries.tue.counts.in).toBe(1);
    expect(await fakeAttendanceRemote(db, USER_A).view(old)).toBeNull();
  });

  it('says so when there is no link to reset', async () => {
    const result = await state().resetLink('tue');
    expect(result.ok).toBe(false);
  });

  it('cancels the date of the latest summary, then replaces the reason', async () => {
    await state().ensureLink(TUE);
    const date = state().summaries.tue.playDate;
    expect(await state().cancelWeek('tue', 'Rain')).toEqual({ ok: true });
    expect(await cancellationRows()).toEqual([{ play_date: date, reason: 'Rain' }]);
    expect(state().summaries.tue.cancelled).toEqual({ reason: 'Rain' });
    await state().cancelWeek('tue', 'Court closed');
    expect(await cancellationRows()).toEqual([{ play_date: date, reason: 'Court closed' }]);
    expect(state().summaries.tue.cancelled).toEqual({ reason: 'Court closed' });
  });

  it('trims the reason, keeps at most 140 characters, and stores none as null', async () => {
    await state().ensureLink(TUE);
    await state().cancelWeek('tue', `  ${'x'.repeat(200)}  `);
    expect((await cancellationRows())[0].reason).toBe('x'.repeat(140));
    await state().cancelWeek('tue', '   ');
    expect((await cancellationRows())[0].reason).toBeNull();
    expect(state().summaries.tue.cancelled).toEqual({ reason: null });
  });

  it('undoes a cancellation', async () => {
    await state().ensureLink(TUE);
    await state().cancelWeek('tue', 'Rain');
    expect(await state().undoCancel('tue')).toEqual({ ok: true });
    expect(await cancellationRows()).toEqual([]);
    expect(state().summaries.tue.cancelled).toBeNull();
  });

  it('refuses to cancel before the date is known, without asking the server', async () => {
    const message = 'Could not find the date. Try again.';
    expect(await state().cancelWeek('tue', 'Rain')).toEqual({ ok: false, message });
    expect(await state().undoCancel('tue')).toEqual({ ok: false, message });
    expect(flags.calls).toEqual([]);
    expect(await cancellationRows()).toEqual([]);
  });

  it('shows busy only while a write runs', async () => {
    await state().ensureLink(TUE);
    const seen: boolean[] = [];
    const unsubscribe = useAttendanceStore.subscribe((s) => seen.push(Boolean(s.busy.tue)));
    await state().cancelWeek('tue', '');
    unsubscribe();
    expect(seen).toContain(true);
    expect(state().busy.tue).toBeFalsy();
  });
});

describe('guest states', () => {
  async function withGuests() {
    await state().ensureLink(TUE);
    const code = (await codeOf())!;
    await guest(code, 'Zed', ANA);
    await guest(code, 'Newbie');
    await state().refresh('tue');
    const byName = (n: string) => state().summaries.tue.waiting.find((w) => w.name === n)!;
    return { byName };
  }
  const stateOf = async (name: string) =>
    (await db.query<{ state: string }>('select state from public.attendance_guests where name = $1', [name])).rows[0]?.state;

  it('writes the state, then reloads so the row leaves waiting', async () => {
    const { byName } = await withGuests();
    expect(await state().setGuestState('tue', byName('Newbie').id, 'dismissed')).toEqual({ ok: true });
    expect(await stateOf('Newbie')).toBe('dismissed');
    expect(state().summaries.tue.waiting.map((w) => w.name)).toEqual(['Zed']);
  });

  it('moves a friend to the play-tonight list', async () => {
    const { byName } = await withGuests();
    await state().setGuestState('tue', byName('Zed').id, 'play_tonight');
    expect(state().summaries.tue.tonight.map((w) => w.name)).toEqual(['Zed']);
    expect(state().summaries.tue.waiting.map((w) => w.name)).toEqual(['Newbie']);
  });

  it('says so and changes nothing offline', async () => {
    const { byName } = await withGuests();
    const before = state().summaries;
    flags.offline = true;
    expect(await state().setGuestState('tue', byName('Zed').id, 'added')).toEqual({ ok: false, message: OFFLINE });
    flags.offline = false;
    expect(state().summaries).toBe(before);
    expect(await stateOf('Zed')).toBe('pending');
  });

  it('asks to sign in when nobody is signed in', async () => {
    signedIn = null;
    const result = await state().setGuestState('tue', 'g1', 'added');
    expect(result).toEqual({ ok: false, message: 'Sign in to use the attendance link.' });
  });

  it('shows busy only while it runs', async () => {
    const { byName } = await withGuests();
    const seen: boolean[] = [];
    const unsubscribe = useAttendanceStore.subscribe((s) => seen.push(Boolean(s.busy.tue)));
    await state().setGuestState('tue', byName('Zed').id, 'added');
    unsubscribe();
    expect(seen).toContain(true);
    expect(state().busy.tue).toBeFalsy();
  });
});

describe('writes with no connection', () => {
  it('say so and change nothing', async () => {
    await state().ensureLink(TUE);
    const before = { links: state().links, summaries: state().summaries, lastError: state().lastError, cache: localStorage.getItem(ATTENDANCE_KEY) };
    const codeBefore = await codeOf();
    flags.offline = true;
    for (const result of [
      await state().ensureLink({ ...TUE, venue: 'Elsewhere' }),
      await state().resetLink('tue'),
      await state().cancelWeek('tue', 'Rain'),
      await state().undoCancel('tue'),
    ]) {
      expect(result).toEqual({ ok: false, message: OFFLINE });
    }
    flags.offline = false;
    expect(state().links).toBe(before.links);
    expect(state().summaries).toBe(before.summaries);
    expect(state().lastError).toBe(before.lastError);
    expect(localStorage.getItem(ATTENDANCE_KEY)).toBe(before.cache);
    expect(await codeOf()).toBe(codeBefore);
    expect(await cancellationRows()).toEqual([]);
    expect((await db.query('select venue from public.attendance_links')).rows[0]).toEqual({ venue: 'Hall' });
  });

  it('are refused with a sign-in message when nobody is signed in', async () => {
    signedIn = null;
    for (const result of [
      await state().ensureLink(TUE),
      await state().resetLink('tue'),
      await state().cancelWeek('tue', ''),
      await state().undoCancel('tue'),
    ]) {
      expect(result.ok).toBe(false);
    }
    expect(flags.calls).toEqual([]);
  });
});

describe('closing a date when a session ends', () => {
  it('closes the link of the session slot through the date the session started, in the link zone', async () => {
    await state().ensureLink(TUE);
    // 9 Nov 23:30 UTC is already 10 Nov in Manila.
    const result = await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 9, 23, 30)));
    expect(result).toEqual({ ok: true });
    expect(await closedThrough()).toBe('2026-11-10');
    expect(state().pendingClose).toEqual([]);
  });

  it('uses the time zone of the device', async () => {
    zone = 'America/New_York';
    await state().ensureLink(TUE);
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 3, 0)));
    expect(await closedThrough()).toBe('2026-11-09');
  });

  it('touches only the slot of the session', async () => {
    await state().ensureLink(TUE);
    await state().ensureLink(THU);
    await state().closeForSession(sessionFrom('thu', Date.UTC(2026, 10, 12, 4, 0)));
    expect(await closedThrough('tue')).toBeNull();
    expect(await closedThrough('thu')).toBe('2026-11-12');
  });

  it('does nothing for a one-off session', async () => {
    await state().ensureLink(TUE);
    flags.calls.length = 0;
    expect(await state().closeForSession(sessionFrom(undefined, Date.UTC(2026, 10, 10)))).toEqual({ ok: true });
    expect(flags.calls).toEqual([]);
    expect(state().pendingClose).toEqual([]);
  });

  it('only moves forward', async () => {
    await state().ensureLink(TUE);
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 17, 4, 0)));
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
    expect(await closedThrough()).toBe('2026-11-17');
  });

  it('keeps a failed close in a saved queue, and sends it on the next refresh', async () => {
    await state().ensureLink(TUE);
    flags.offline = true;
    const result = await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
    expect(result.ok).toBe(false);
    expect(state().pendingClose).toEqual([{ slotId: 'tue', date: '2026-11-10' }]);
    expect(cached().pendingClose).toEqual([{ slotId: 'tue', date: '2026-11-10' }]);
    expect(await closedThrough()).toBeNull();
    flags.offline = false;
    await state().refresh('tue');
    expect(await closedThrough()).toBe('2026-11-10');
    expect(state().pendingClose).toEqual([]);
    expect(cached().pendingClose).toEqual([]);
  });

  it('keeps the close queued while the retry still fails', async () => {
    await state().ensureLink(TUE);
    flags.offline = true;
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
    await state().refresh('tue');
    expect(state().pendingClose).toEqual([{ slotId: 'tue', date: '2026-11-10' }]);
  });

  it('forgets an older queued close when a later one goes through, and keeps a later queued one', async () => {
    await state().ensureLink(TUE);
    flags.offline = true;
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 3, 4, 0)));
    flags.offline = false;
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
    expect(state().pendingClose).toEqual([]);
    flags.offline = true;
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 24, 4, 0)));
    flags.offline = false;
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 17, 4, 0)));
    expect(state().pendingClose).toEqual([{ slotId: 'tue', date: '2026-11-24' }]);
  });

  it('keeps one queued close per slot, the latest date', async () => {
    await state().ensureLink(TUE);
    flags.offline = true;
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 17, 4, 0)));
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 3, 4, 0)));
    expect(state().pendingClose).toEqual([{ slotId: 'tue', date: '2026-11-17' }]);
  });

  it('queues the close when the sign-in could not be checked, and not when nobody ever signed in', async () => {
    await state().ensureLink(TUE);
    signedIn = null;
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
    expect(state().pendingClose).toEqual([{ slotId: 'tue', date: '2026-11-10' }]);
    state().clear();
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
    expect(state().pendingClose).toEqual([]);
  });

  it('never throws, even when the remote throws something odd', async () => {
    await state().ensureLink(TUE);
    override = { closeThrough: async () => { throw new Error('boom'); } };
    await expect(state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)))).resolves.toMatchObject({ ok: false });
    expect(state().pendingClose).toHaveLength(1);
  });
});

describe('syncing a slot to its link', () => {
  it('updates the title, times, venue and courts, but not the code or the closed date', async () => {
    await state().ensureLink(TUE);
    const code = await codeOf();
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
    expect(await state().syncSlot({ ...TUE, startMin: 1080, endMin: 1200, venue: 'Park', courts: 4 })).toEqual({ ok: true });
    const row = (await db.query('select start_min, end_min, venue, courts, code, closed_through::text as c from public.attendance_links')).rows[0];
    expect(row).toEqual({ start_min: 1080, end_min: 1200, venue: 'Park', courts: 4, code, c: '2026-11-10' });
  });

  it('does nothing for a slot with no link', async () => {
    flags.calls.length = 0;
    expect(await state().syncSlot(THU)).toEqual({ ok: true });
    expect(flags.calls).toEqual([]);
    expect((await db.query('select count(*)::int as n from public.attendance_links')).rows[0]).toEqual({ n: 0 });
  });

  it('reports a failure without throwing', async () => {
    await state().ensureLink(TUE);
    flags.offline = true;
    expect(await state().syncSlot({ ...TUE, venue: 'Park' })).toEqual({ ok: false, message: OFFLINE });
  });

  it('does nothing when nobody is signed in', async () => {
    await state().ensureLink(TUE);
    signedIn = null;
    flags.calls.length = 0;
    expect((await state().syncSlot({ ...TUE, venue: 'Park' })).ok).toBe(false);
    expect(flags.calls).toEqual([]);
  });
});

describe('the saved copy', () => {
  it('records the account, links, summaries, last change and queue', async () => {
    await state().ensureLink(TUE);
    const saved = cached();
    expect(saved.version).toBe(1);
    expect(saved.userId).toBe(USER_A);
    expect(saved.links.tue.code).toBe(await codeOf());
    expect(saved.summaries.tue.slotId).toBe('tue');
    expect(saved.pendingClose).toEqual([]);
  });

  it('does not save the failure or busy flags', async () => {
    await state().ensureLink(TUE);
    flags.offline = true;
    await state().refresh('tue');
    const saved = cached();
    expect(saved).not.toHaveProperty('lastError');
    expect(saved).not.toHaveProperty('busy');
  });

  it('is read again when the app starts', async () => {
    await state().ensureLink(TUE);
    const before = state();
    vi.resetModules();
    const fresh = await import('./store');
    const loaded = fresh.useAttendanceStore.getState();
    expect(loaded.ownerId).toBe(USER_A);
    expect(loaded.links).toEqual(before.links);
    expect(loaded.summaries).toEqual(before.summaries);
  });

  it('survives storage that throws', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    await expect(state().ensureLink(TUE)).resolves.toEqual({ ok: true });
    expect(state().links.tue).toBeDefined();
  });
});

describe('reading a bad saved copy', () => {
  const summary = {
    slotId: 'tue', code: 'c', playDate: '2026-11-10', cancelled: null,
    counts: { in: 1, maybe: 0, out: 0, late: 0 }, friends: 0, waiting: [], tonight: [], lateIds: [], answers: { p: 'in' }, names: { p: 'Ana' }, fetchedAt: 5,
  };
  const good = { version: 1, userId: 'u', links: { tue: { code: 'c' } }, summaries: { tue: summary }, lastChange: {}, pendingClose: [] };

  it('accepts a good copy', () => {
    expect(parseAttendanceCache(JSON.stringify(good))).toMatchObject({ ownerId: 'u', links: { tue: { code: 'c' } }, summaries: { tue: summary } });
  });

  it('keeps a copy saved before the new fields, with both as empty lists', () => {
    const { tonight: _t, lateIds: _l, ...old } = summary;
    const parsed = parseAttendanceCache(JSON.stringify({ ...good, summaries: { tue: old } }))!;
    expect(parsed.summaries.tue).toEqual(summary);
  });

  it('keeps the new fields when they are there', () => {
    const next = { ...summary, tonight: [{ id: 'g', name: 'Fay', broughtBy: 'p' }], lateIds: ['p'] };
    expect(parseAttendanceCache(JSON.stringify({ ...good, summaries: { tue: next } }))!.summaries.tue).toEqual(next);
  });

  it('drops a summary whose new fields are malformed', () => {
    for (const bad of [
      { ...summary, tonight: 'x' },
      { ...summary, tonight: [{ id: 'g', name: 5, broughtBy: null }] },
      { ...summary, tonight: [{ id: 'g', name: 'Fay', broughtBy: 5 }] },
      { ...summary, lateIds: 'p' },
      { ...summary, lateIds: [5] },
    ]) {
      expect(parseAttendanceCache(JSON.stringify({ ...good, summaries: { tue: bad } }))!.summaries).toEqual({});
    }
  });

  it('gives nothing for missing, broken or foreign data', () => {
    for (const raw of [null, '', 'nope', '[]', '5', JSON.stringify({ ...good, version: 2 }), JSON.stringify({ ...good, userId: 5 }), JSON.stringify({ ...good, userId: '' })]) {
      expect(parseAttendanceCache(raw)).toBeNull();
    }
  });

  it('drops only the entries that are wrong', () => {
    const raw = JSON.stringify({
      ...good,
      links: { tue: { code: 'c' }, thu: { code: 5 }, sat: 'x', sun: { code: '' } },
      summaries: {
        tue: summary,
        thu: { ...summary, slotId: 'thu', counts: { in: 'many' } },
        sat: { ...summary, slotId: 'other' },
        bad: null,
      },
      lastChange: {
        tue: { player: 'Ben', from: 'in', to: 'out', at: 1 },
        thu: { player: 'Ben', from: 'in', to: 'sideways', at: 1 },
        sat: null,
      },
      pendingClose: [{ slotId: 'tue', date: '2026-11-10' }, { slotId: 'tue', date: 'tomorrow' }, { slotId: 5, date: '2026-11-10' }, null],
    });
    const parsed = parseAttendanceCache(raw)!;
    expect(Object.keys(parsed.links)).toEqual(['tue']);
    expect(Object.keys(parsed.summaries)).toEqual(['tue']);
    expect(Object.keys(parsed.lastChange)).toEqual(['tue']);
    expect(parsed.pendingClose).toEqual([{ slotId: 'tue', date: '2026-11-10' }]);
  });

  it('drops a summary whose answers or waiting names are malformed', () => {
    for (const bad of [
      { ...summary, answers: { p: 'perhaps' } },
      { ...summary, names: { p: 5 } },
      { ...summary, waiting: [{ id: 'g', name: 5, broughtBy: null }] },
      { ...summary, cancelled: { reason: 5 } },
      { ...summary, fetchedAt: 'now' },
      { ...summary, friends: -1 },
    ]) {
      expect(parseAttendanceCache(JSON.stringify({ ...good, summaries: { tue: bad } }))!.summaries).toEqual({});
    }
  });

  it('drops a summary or last change for a slot that has no link, and a summary filed under the wrong slot', () => {
    const note = { player: 'Ben', from: 'in', to: 'out', at: 1 };
    const raw = JSON.stringify({
      ...good,
      links: { tue: { code: 'c' }, thu: { code: 'd' } },
      summaries: { tue: summary, thu: { ...summary, slotId: 'tue' }, sat: { ...summary, slotId: 'sat' } },
      lastChange: { tue: note, sat: note },
    });
    const parsed = parseAttendanceCache(raw)!;
    expect(Object.keys(parsed.summaries)).toEqual(['tue']);
    expect(Object.keys(parsed.lastChange)).toEqual(['tue']);
  });

  it('starts empty from a bad copy instead of crashing', async () => {
    localStorage.setItem(ATTENDANCE_KEY, '{{{');
    vi.resetModules();
    const fresh = await import('./store');
    expect(fresh.useAttendanceStore.getState()).toMatchObject({ ownerId: null, links: {}, summaries: {}, pendingClose: [] });
  });
});

describe('clearing', () => {
  it('empties everything and removes the saved copy', async () => {
    await state().ensureLink(TUE);
    flags.offline = true;
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
    state().clear();
    expect(state()).toMatchObject({ ownerId: null, links: {}, summaries: {}, lastChange: {}, lastError: {}, pendingClose: [] });
    expect(localStorage.getItem(ATTENDANCE_KEY)).toBeNull();
  });

  it('keeps one account from seeing another account cache', async () => {
    await state().ensureLink(TUE);
    expect(state().summaries.tue).toBeDefined();
    signedIn = USER_B;
    await state().refresh('tue');
    expect(state().ownerId).toBe(USER_B);
    expect(state().links).toEqual({});
    expect(state().summaries).toEqual({});
    expect(cached().userId).toBe(USER_B);
  });

  it('also drops the queue of the other account', async () => {
    await state().ensureLink(TUE);
    flags.offline = true;
    await state().closeForSession(sessionFrom('tue', Date.UTC(2026, 10, 10, 4, 0)));
    flags.offline = false;
    signedIn = USER_B;
    await state().refresh('tue');
    expect(state().pendingClose).toEqual([]);
    expect(await closedThrough()).toBeNull();
  });

  it('applies to a saved copy of another account found at start', async () => {
    await state().ensureLink(TUE);
    signedIn = USER_B;
    await state().ensureLink(THU);
    expect(state().links).toEqual({ thu: { code: await codeOf('thu') } });
  });
});
