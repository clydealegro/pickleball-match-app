// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkPlayer, mkSession } from '../../engine/fixtures';
import type { Court, Session } from '../../engine/types';
import { fakeMemberRemote } from '../../member/fakeRemote';
import type { MemberRemote } from '../../member/remote';
import { useRosterStore } from '../../store/rosterStore';
import { useSessionStore } from '../../store/sessionStore';
import { useSlotsStore } from '../../store/slots';
import { useAttendanceStore } from '../attendance/store';
import { useAuthStore } from '../auth';
import { USER_A, createDb } from '../db/harness';
import { fakeLiveRemote } from './fakeRemote';
import { startLivePublisher } from './publisher';
import { useLiveStore } from './store';

// The organizer's phone publishes, and a visitor reads, both through the real migration. Nothing is stubbed in between.
const ANA = '11111111-1111-4111-8111-111111111111';
let db: PGlite;
let visitor: MemberRemote;
let stop: () => void;
let code = '';

beforeAll(async () => {
  db = await createDb();
  visitor = fakeMemberRemote(db);
});
afterAll(async () => {
  await db.close();
});

const court = (over: Partial<Court> = {}): Court => ({ id: 'c1', number: 1, status: 'playing', closing: false, game: { team1: ['a', 'b'], team2: ['c', 'd'], startedAt: 1 }, ...over });
const session = (over: Partial<Session> = {}): Session =>
  mkSession(
    [mkPlayer('a', { name: 'Ana Reyes', rosterId: ANA, rating: 9 }), mkPlayer('b', { name: 'Ben Cruz' }), mkPlayer('c', { name: 'Cy' }), mkPlayer('d', { name: 'Dee' }), mkPlayer('e', { name: 'Eli' })],
    { id: 's1', slotId: 'tue', courts: [court()], ...over },
  );

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  await db.exec('truncate public.live_boards, public.live_photos, public.attendance_links cascade');
  await db.exec(`insert into public.attendance_links (owner_id, slot_id, title, weekday) values ('${USER_A}', 'tue', 'Tuesday open play', 2)`);
  code = ((await db.query<{ code: string }>("select code from public.attendance_links where slot_id = 'tue'")).rows[0]).code;
  useAuthStore.setState({ status: 'signedIn', userId: USER_A, email: 'o@example.com', error: null, busy: false });
  useSlotsStore.setState({ slots: [{ id: 'tue', weekday: 2, startMin: 960, endMin: 1140 }], venues: [], tonight: {}, persistent: true });
  useRosterStore.setState({ players: [{ id: ANA, name: 'Ana Reyes', photoVersion: 1, photoSeq: 2 }] as never, loaded: true });
  useAttendanceStore.setState({ links: { tue: { code } }, ownerId: USER_A, ensureLink: vi.fn(async () => ({ ok: true as const })) });
  useLiveStore.setState({ status: 'off', slotId: null, code: null, paused: false, lastPublishedAt: null, showPhotos: true });
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  stop = startLivePublisher(
    {
      server: () => fakeLiveRemote(db, USER_A),
      now: () => Date.now(),
      photoOf: async () => ({ type: 'image/jpeg', data: new ArrayBuffer(4) }),
      thumb: async () => 'data:image/jpeg;base64,/9j/4AAQ',
    },
    10,
    1000,
  );
});
afterEach(() => {
  stop();
  vi.useRealTimers();
});

const settle = () => vi.advanceTimersByTimeAsync(50);

describe('from the organizer\'s phone to a visitor', () => {
  it('a visitor sees the running session, by first name, with no rating or full name', async () => {
    useSessionStore.setState({ session: session() });
    await settle();
    const reply = await visitor.live!(code, null);
    expect(reply.state).toBe('live');
    if (reply.state !== 'live' || reply.unchanged) throw new Error('expected a board');
    expect(reply.board.title).toBe('Tuesday open play');
    expect(reply.board.courts[0]).toMatchObject({ n: 1, status: 'playing', teams: [['a', 'b'], ['c', 'd']] });
    expect(reply.board.players.a).toEqual({ f: 'Ana', l: 'R', r: ANA });
    expect(JSON.stringify(reply)).not.toMatch(/rating|Reyes|Cruz/);
  });

  it('the visitor gets the face once, and then only what changed', async () => {
    useSessionStore.setState({ session: session() });
    await settle();
    const first = await visitor.liveFaces!(code, []);
    expect(first).toEqual([{ id: ANA, seq: 2, data: 'data:image/jpeg;base64,/9j/4AAQ' }]);
    expect(await visitor.liveFaces!(code, [`${ANA}:2`])).toEqual([]);
  });

  it('a change reaches the visitor, and an unchanged board costs a few bytes', async () => {
    useSessionStore.setState({ session: session() });
    await settle();
    const first = await visitor.live!(code, null);
    const version = first.state === 'live' ? first.version : -1;
    expect(await visitor.live!(code, version)).toMatchObject({ state: 'live', unchanged: true });
    useSessionStore.setState({ session: session({ courts: [court({ status: 'empty', game: undefined })] }) });
    await settle();
    const after = await visitor.live!(code, version);
    expect(after.state).toBe('live');
    if (after.state !== 'live' || after.unchanged) throw new Error('expected the new board');
    expect(after.board.courts[0].status).toBe('empty');
    expect(after.version).toBeGreaterThan(version);
  });

  it('pausing and turning photos off reach the visitor', async () => {
    useSessionStore.setState({ session: session() });
    await settle();
    useLiveStore.getState().setShowPhotos(false);
    await settle();
    expect(await visitor.liveFaces!(code, [])).toEqual([]);
    useLiveStore.getState().setPaused(true);
    await settle();
    expect(await visitor.live!(code, null)).toMatchObject({ state: 'paused' });
    useLiveStore.getState().setPaused(false);
    await settle();
    expect(await visitor.live!(code, null)).toMatchObject({ state: 'live' });
  });

  it('ending the session takes the board and the faces down', async () => {
    useSessionStore.setState({ session: session() });
    await settle();
    useSessionStore.setState({ session: { ...session(), endedAt: Date.now() } });
    await settle();
    expect(await visitor.live!(code, null)).toEqual({ state: 'idle' });
    expect(await visitor.liveFaces!(code, [])).toEqual([]);
    expect((await db.query('select * from public.live_photos')).rows).toEqual([]);
  });

  it('a one-off session never reaches a visitor', async () => {
    useSessionStore.setState({ session: session({ slotId: undefined }) });
    await settle();
    expect(await visitor.live!(code, null)).toEqual({ state: 'idle' });
  });
});
