import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkPlayer, mkSession } from '../../engine/fixtures';
import type { Court, Session } from '../../engine/types';
import { useRosterStore } from '../../store/rosterStore';
import { useSessionStore } from '../../store/sessionStore';
import { useSlotsStore } from '../../store/slots';
import { useAttendanceStore } from '../attendance/store';
import { useAuthStore } from '../auth';
import type { LiveBoard } from './board';
import { startLivePublisher, type LiveDeps } from './publisher';
import type { LiveFace, LivePublish, LiveRemote } from './remote';
import { useLiveStore } from './store';

const ANA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const NOW = 1_800_000_000_000;

/** A remote that writes down what it was asked, and fails on request. */
function recorder() {
  const log: { name: string; arg?: unknown }[] = [];
  const state = { fail: false };
  const go = async (name: string, arg?: unknown) => {
    log.push({ name, arg });
    if (state.fail) throw Object.assign(new Error('offline'), { name: 'RemoteError', kind: 'offline' });
  };
  const remote: LiveRemote = {
    publish: (p: LivePublish) => go('publish', p),
    heartbeat: (slotId, sessionId) => go('heartbeat', { slotId, sessionId }),
    putFaces: (slotId, faces: LiveFace[]) => go('putFaces', { slotId, faces }),
    removeFaces: (slotId) => go('removeFaces', slotId),
    stop: (slotId) => go('stop', slotId),
  };
  return { remote, log, state, names: () => log.map((l) => l.name), last: (name: string) => [...log].reverse().find((l) => l.name === name)?.arg };
}

const court = (over: Partial<Court> = {}): Court => ({ id: 'c1', number: 1, status: 'empty', closing: false, ...over });
function session(over: Partial<Session> = {}): Session {
  return mkSession(
    [
      mkPlayer('a', { name: 'Ana Reyes', rosterId: ANA, rating: 9 }),
      mkPlayer('b', { name: 'Ben Cruz', rosterId: BEN }),
      mkPlayer('c', { name: 'Cy' }),
      mkPlayer('d', { name: 'Dee' }),
      mkPlayer('e', { name: 'Eli' }),
    ],
    { id: 's1', slotId: 'tue', courts: [court({ status: 'playing', game: { team1: ['a', 'b'], team2: ['c', 'd'], startedAt: NOW } })], ...over },
  );
}

let rec: ReturnType<typeof recorder>;
let stop: () => void;
const deps = (): LiveDeps => ({
  server: () => rec.remote,
  now: () => NOW,
  photoOf: async (id) => (id === ANA ? { type: 'image/jpeg', data: new ArrayBuffer(4) } : undefined),
  thumb: async () => 'data:image/jpeg;base64,AAAA',
});
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const startSession = (s: Session | null) => {
  useSessionStore.setState({ session: s });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  rec = recorder();
  localStorage.clear();
  useAuthStore.setState({ status: 'signedIn', userId: 'u1', email: 'o@example.com', error: null, busy: false });
  useSlotsStore.setState({ slots: [{ id: 'tue', weekday: 2, startMin: 960, endMin: 1140, venue: 'Nitro' }], venues: [], tonight: {}, persistent: true });
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useRosterStore.setState({
    players: [
      { id: ANA, name: 'Ana Reyes', photoVersion: 1, photoSeq: 4 },
      { id: BEN, name: 'Ben Cruz', photoVersion: 0, photoSeq: 0 },
    ] as never,
    loaded: true,
  });
  useAttendanceStore.setState({ links: { tue: { code: 'c0de' } }, ownerId: 'u1', ensureLink: vi.fn(async () => ({ ok: true as const })) });
  useLiveStore.setState({ status: 'off', slotId: null, code: null, paused: false, lastPublishedAt: null, showPhotos: true, noticeSeen: false });
});
afterEach(() => {
  stop?.();
  vi.useRealTimers();
});

describe('starting', () => {
  it('publishes the board and the faces when a session from a saved day starts', async () => {
    stop = startLivePublisher(deps());
    startSession(session());
    await settle();
    expect(rec.names()).toEqual(['publish', 'putFaces']);
    const p = rec.last('publish') as LivePublish;
    expect(p).toMatchObject({ slotId: 'tue', sessionId: 's1', paused: false, showPhotos: true });
    expect(p.board.title).toBe('Tuesday open play');
    expect(p.board).toMatchObject({ venue: 'Nitro', startMin: 960, endMin: 1140 });
    expect(p.version).toBeGreaterThanOrEqual(NOW);
    // Only players with a photo get a face, and it is made from the saved photo's sequence.
    expect(rec.last('putFaces')).toEqual({ slotId: 'tue', faces: [{ rosterId: ANA, seq: 4, data: 'data:image/jpeg;base64,AAAA' }] });
    expect(useLiveStore.getState()).toMatchObject({ status: 'on', slotId: 'tue', code: 'c0de' });
  });

  it('makes the attendance link first, because the board hangs off it', async () => {
    stop = startLivePublisher(deps());
    startSession(session());
    await settle();
    expect(useAttendanceStore.getState().ensureLink).toHaveBeenCalledWith(expect.objectContaining({ id: 'tue' }));
  });

  it('sends nothing for a one-off session, a finished one, or when signed out', async () => {
    stop = startLivePublisher(deps());
    startSession(session({ slotId: undefined }));
    await settle();
    startSession(session({ endedAt: NOW }));
    await settle();
    useAuthStore.setState({ status: 'signedOut', userId: null });
    startSession(session());
    await settle();
    expect(rec.log).toEqual([]);
    expect(useLiveStore.getState().status).toBe('off');
  });

  it('starts when the organizer signs in during a session', async () => {
    useAuthStore.setState({ status: 'signedOut', userId: null });
    startSession(session());
    stop = startLivePublisher(deps());
    await settle();
    expect(rec.log).toEqual([]);
    useAuthStore.setState({ status: 'signedIn', userId: 'u1' });
    await settle(1000);
    expect(rec.names()).toContain('publish');
  });

  it('shows an error and sends nothing when the link cannot be made', async () => {
    useAttendanceStore.setState({ links: {}, ensureLink: vi.fn(async () => ({ ok: false as const, message: 'x' })) });
    stop = startLivePublisher(deps());
    startSession(session());
    await settle();
    expect(rec.log).toEqual([]);
    expect(useLiveStore.getState().status).toBe('error');
  });
});

describe('keeping it up', () => {
  beforeEach(async () => {
    stop = startLivePublisher(deps());
    startSession(session());
    await settle();
    rec.log.length = 0;
  });

  it('sends a change after a short pause, once for a burst, with a newer version', async () => {
    const first = (rec.last('publish') as LivePublish | undefined)?.version;
    const s = session();
    startSession({ ...s, courts: [court({ status: 'empty' })] });
    startSession({ ...s, courts: [court({ status: 'empty' })], pinned: ['e'] });
    await settle(599);
    expect(rec.log).toEqual([]);
    await settle(2);
    expect(rec.names().filter((n) => n === 'publish')).toHaveLength(1);
    expect((rec.last('publish') as LivePublish).version).toBeGreaterThan(first ?? 0);
  });

  it('only says it is still here when nothing changed', async () => {
    await settle(30_000);
    expect(rec.names()).toEqual(['heartbeat']);
    expect(rec.last('heartbeat')).toEqual({ slotId: 'tue', sessionId: 's1' });
  });

  it('does not send again for a change the page cannot see', async () => {
    const s = session();
    startSession({ ...s, gameSeq: 99 });
    await settle(700);
    expect(rec.log).toEqual([]);
  });

  it('sends the whole board again after a failed send, not just a hello', async () => {
    rec.state.fail = true;
    await settle(30_000);
    expect(useLiveStore.getState().status).toBe('error');
    rec.state.fail = false;
    rec.log.length = 0;
    await settle(30_000);
    expect(rec.names()[0]).toBe('publish');
    expect(useLiveStore.getState().status).toBe('on');
  });

  it('sends a new face only when the photo changed', async () => {
    useRosterStore.setState({ players: [{ id: ANA, name: 'Ana Reyes', photoVersion: 1, photoSeq: 4 }] as never });
    startSession({ ...session(), courts: [court({ status: 'playing', game: { team1: ['a', 'b'], team2: ['c', 'e'], startedAt: NOW } })] });
    await settle(700);
    expect(rec.names()).toEqual(['publish']);
    useRosterStore.setState({ players: [{ id: ANA, name: 'Ana Reyes', photoVersion: 2, photoSeq: 5 }] as never });
    startSession({ ...session(), courts: [court({ status: 'empty' })] });
    await settle(700);
    expect((rec.last('putFaces') as { faces: LiveFace[] }).faces[0].seq).toBe(5);
  });
});

describe('the organizer\'s choices', () => {
  beforeEach(async () => {
    stop = startLivePublisher(deps());
    startSession(session());
    await settle();
    rec.log.length = 0;
  });

  it('pauses and resumes at once', async () => {
    useLiveStore.getState().setPaused(true);
    await settle();
    expect((rec.last('publish') as LivePublish).paused).toBe(true);
    expect(useLiveStore.getState().status).toBe('paused');
    useLiveStore.getState().setPaused(false);
    await settle();
    expect((rec.last('publish') as LivePublish).paused).toBe(false);
    expect(useLiveStore.getState().status).toBe('on');
  });

  it('takes the faces down when photos are turned off, and puts them back when turned on', async () => {
    useLiveStore.getState().setShowPhotos(false);
    await settle();
    expect(rec.names()).toEqual(['publish', 'removeFaces']);
    expect((rec.last('publish') as LivePublish).showPhotos).toBe(false);
    rec.log.length = 0;
    useLiveStore.getState().setShowPhotos(true);
    await settle();
    expect(rec.names()).toEqual(['publish', 'putFaces']);
  });
});

describe('ending', () => {
  beforeEach(async () => {
    stop = startLivePublisher(deps());
    startSession(session());
    await settle();
    rec.log.length = 0;
  });

  it('takes the board down when the session ends, and forgets a pause', async () => {
    useLiveStore.getState().setPaused(true);
    await settle();
    rec.log.length = 0;
    startSession({ ...session(), endedAt: NOW + 1 });
    await settle();
    expect(rec.names()).toEqual(['stop']);
    expect(rec.last('stop')).toBe('tue');
    expect(useLiveStore.getState()).toMatchObject({ status: 'off', slotId: null, code: null, paused: false });
  });

  it('takes the board down when the session is dropped, or the organizer signs out', async () => {
    startSession(null);
    await settle();
    expect(rec.names()).toEqual(['stop']);
  });

  it('takes the board down on sign out', async () => {
    useAuthStore.setState({ status: 'signedOut', userId: null });
    await settle();
    expect(useLiveStore.getState().status).toBe('off');
  });

  it('goes on to a new session without waiting for the old one to be taken down', async () => {
    startSession({ ...session(), id: 's2' });
    await settle();
    expect(rec.names()).toEqual(['stop', 'publish', 'putFaces']);
    expect((rec.last('publish') as LivePublish).sessionId).toBe('s2');
  });

  it('keeps going when taking the board down fails', async () => {
    rec.state.fail = true;
    startSession(null);
    await settle();
    expect(useLiveStore.getState().status).toBe('off');
  });
});

describe('what leaves the phone', () => {
  it('never carries a rating, a score or a full name', async () => {
    stop = startLivePublisher(deps());
    startSession(session());
    await settle();
    const text = JSON.stringify((rec.last('publish') as LivePublish).board satisfies LiveBoard);
    expect(text).not.toContain('rating');
    expect(text).not.toContain('Reyes');
    expect(text).not.toContain('Cruz');
  });
});
