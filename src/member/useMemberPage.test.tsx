import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceViewData } from '../sync/attendance/types';
import { CACHE_KEY, readCached, writeCached } from './cache';
import { IDENTITY_KEY, readPick, savePick } from './identity';
import { MemberError, type MemberReason, type MemberRemote } from './remote';
import { useMemberPage } from './useMemberPage';

const CODE = 'abc123';
const ANA = 'p-ana';
const BEN = 'p-ben';
const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);

const player = (id: string, first: string) => ({ id, first_name: first, last_initial: null, has_photo: false, photo_seq: 0 });
const VIEW: AttendanceViewData = {
  title: 'Tuesday open play',
  weekday: 2,
  venue: 'Sample Hall',
  start_min: 1140,
  end_min: 1260,
  courts: 3,
  play_date: '2026-11-10',
  cancelled: null,
  players: [player(ANA, 'Ana'), player(BEN, 'Ben')],
  answers: [{ player_id: BEN, status: 'maybe', late: false }],
  friends: 0,
};
const view = (patch: Partial<AttendanceViewData> = {}): AttendanceViewData => ({ ...VIEW, ...patch });

type Stub = { [K in keyof MemberRemote]: ReturnType<typeof vi.fn<MemberRemote[K]>> };
function makeRemote(data: AttendanceViewData | null = VIEW): Stub {
  return {
    view: vi.fn<MemberRemote['view']>(async () => data),
    answer: vi.fn<MemberRemote['answer']>(async () => undefined),
    addGuest: vi.fn<MemberRemote['addGuest']>(async () => undefined),
  };
}
const fails = (reason: MemberReason) => async () => {
  throw new MemberError(reason);
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
/** Lets a request that has already settled reach the hook. */
const settle = () => act(async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
});
async function mount(remote: MemberRemote | null, options: { strict?: boolean } = {}) {
  const hook = renderHook(() => useMemberPage(CODE, remote), options.strict ? { wrapper: StrictMode } : undefined);
  await settle();
  return hook;
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('phases', () => {
  it('is unavailable, and asks for nothing, when there is no backend', async () => {
    const { result } = await mount(null);
    expect(result.current.phase).toBe('unavailable');
    expect(result.current.view).toBeNull();
  });

  it('starts loading, then is ready with the view', async () => {
    const reply = deferred<AttendanceViewData | null>();
    const remote = makeRemote();
    remote.view.mockReturnValue(reply.promise);
    const { result } = renderHook(() => useMemberPage(CODE, remote));
    expect(result.current.phase).toBe('loading');
    expect(result.current.view).toBeNull();
    reply.resolve(VIEW);
    await settle();
    expect(result.current.phase).toBe('ready');
    expect(result.current.view).toEqual(VIEW);
    expect(result.current.stale).toBeNull();
    expect(result.current.error).toBeNull();
    expect(remote.view).toHaveBeenCalledWith(CODE);
  });

  it('is notfound for an unknown code', async () => {
    const { result } = await mount(makeRemote(null));
    expect(result.current.phase).toBe('notfound');
    expect(result.current.view).toBeNull();
  });

  it('is failed, with the reason, when the first request fails and there is no copy', async () => {
    const remote = makeRemote();
    remote.view.mockImplementation(fails('offline'));
    const { result } = await mount(remote);
    expect(result.current.phase).toBe('failed');
    expect(result.current.error).toBe('offline');
    expect(result.current.view).toBeNull();
  });

  it('says server for a server failure with no copy', async () => {
    const remote = makeRemote();
    remote.view.mockImplementation(fails('server'));
    const { result } = await mount(remote);
    expect(result.current.phase).toBe('failed');
    expect(result.current.error).toBe('server');
  });

  it('is notfound when the refresh says the link is unknown, even with a copy', async () => {
    writeCached(CODE, VIEW, NOW);
    const remote = makeRemote();
    remote.view.mockImplementation(fails('unknown_link'));
    const { result } = await mount(remote);
    expect(result.current.phase).toBe('notfound');
    expect(result.current.view).toBeNull();
  });

  it('treats a failure that is not a MemberError as a server failure', async () => {
    const remote = makeRemote();
    remote.view.mockRejectedValue(new Error('boom'));
    const { result } = await mount(remote);
    expect(result.current.phase).toBe('failed');
    expect(result.current.error).toBe('server');
  });

  it('keeps a good copy of the view for next time', async () => {
    await mount(makeRemote());
    expect(readCached(CODE)).toEqual({ view: VIEW, at: NOW });
  });

  it('does not keep a copy of an unknown code', async () => {
    await mount(makeRemote(null));
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });
});

describe('the offline copy', () => {
  const CACHED_AT = NOW - 60_000;
  beforeEach(() => writeCached(CODE, view({ title: 'Cached play' }), CACHED_AT));

  it('shows the copy at once, with when it was updated', async () => {
    const reply = deferred<AttendanceViewData | null>();
    const remote = makeRemote();
    remote.view.mockReturnValue(reply.promise);
    const { result } = renderHook(() => useMemberPage(CODE, remote));
    expect(result.current.phase).toBe('ready');
    expect(result.current.view?.title).toBe('Cached play');
    expect(result.current.stale).toEqual({ at: CACHED_AT, offline: false });
  });

  it('replaces the copy when the refresh works, and the stale note goes', async () => {
    const { result } = await mount(makeRemote());
    expect(result.current.view?.title).toBe('Tuesday open play');
    expect(result.current.stale).toBeNull();
    expect(readCached(CODE)).toEqual({ view: VIEW, at: NOW });
  });

  it('keeps the copy, marked offline, when the refresh fails offline', async () => {
    const remote = makeRemote();
    remote.view.mockImplementation(fails('offline'));
    const { result } = await mount(remote);
    expect(result.current.phase).toBe('ready');
    expect(result.current.view?.title).toBe('Cached play');
    expect(result.current.stale).toEqual({ at: CACHED_AT, offline: true });
    expect(result.current.error).toBe('offline');
  });

  it('keeps the copy, not marked offline, when the refresh fails on the server', async () => {
    const remote = makeRemote();
    remote.view.mockImplementation(fails('server'));
    const { result } = await mount(remote);
    expect(result.current.phase).toBe('ready');
    expect(result.current.stale).toEqual({ at: CACHED_AT, offline: false });
    expect(result.current.error).toBe('server');
  });

  it('is notfound for a code the server no longer knows, even with a copy', async () => {
    const { result } = await mount(makeRemote(null));
    expect(result.current.phase).toBe('notfound');
  });

  it('dates a later failure from the last good refresh', async () => {
    const remote = makeRemote();
    const { result } = await mount(remote);
    vi.setSystemTime(NOW + 5 * 60_000);
    remote.view.mockImplementation(fails('offline'));
    await act(async () => {
      result.current.retry();
    });
    await settle();
    expect(result.current.stale).toEqual({ at: NOW, offline: true });
    expect(result.current.view?.title).toBe('Tuesday open play');
  });

  it('clears the stale note and the error when a later refresh works', async () => {
    const remote = makeRemote();
    remote.view.mockImplementationOnce(fails('offline'));
    const { result } = await mount(remote);
    expect(result.current.stale?.offline).toBe(true);
    await act(async () => {
      result.current.retry();
    });
    await settle();
    expect(result.current.stale).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

describe('retry', () => {
  it('asks again from the failed screen, shows loading, then the view', async () => {
    const remote = makeRemote();
    remote.view.mockImplementationOnce(fails('offline'));
    const { result } = await mount(remote);
    expect(result.current.phase).toBe('failed');
    const reply = deferred<AttendanceViewData | null>();
    remote.view.mockReturnValueOnce(reply.promise);
    await act(async () => {
      result.current.retry();
    });
    expect(result.current.phase).toBe('loading');
    expect(result.current.error).toBeNull();
    reply.resolve(VIEW);
    await settle();
    expect(result.current.phase).toBe('ready');
    expect(remote.view).toHaveBeenCalledTimes(2);
  });

  it('goes back to failed when it fails again', async () => {
    const remote = makeRemote();
    remote.view.mockImplementation(fails('server'));
    const { result } = await mount(remote);
    await act(async () => {
      result.current.retry();
    });
    await settle();
    expect(result.current.phase).toBe('failed');
    expect(result.current.error).toBe('server');
  });

  it('keeps showing the view while it asks again', async () => {
    const remote = makeRemote();
    const { result } = await mount(remote);
    const reply = deferred<AttendanceViewData | null>();
    remote.view.mockReturnValueOnce(reply.promise);
    await act(async () => {
      result.current.retry();
    });
    expect(result.current.phase).toBe('ready');
    expect(result.current.view).toEqual(VIEW);
    reply.resolve(VIEW);
    await settle();
  });

  it('does nothing when there is no backend', async () => {
    const { result } = await mount(null);
    await act(async () => {
      result.current.retry();
    });
    expect(result.current.phase).toBe('unavailable');
  });
});

describe('picking a name', () => {
  it('starts with nobody picked', async () => {
    const { result } = await mount(makeRemote());
    expect(result.current.me).toBeNull();
  });

  it('picks a player on the roster and remembers it for this code', async () => {
    const { result } = await mount(makeRemote());
    act(() => result.current.pick(ANA));
    expect(result.current.me).toBe(ANA);
    expect(readPick(CODE)).toBe(ANA);
    expect(JSON.parse(localStorage.getItem(IDENTITY_KEY)!)).toEqual({ version: 1, picks: { [CODE]: ANA } });
  });

  it('ignores a pick that is not on the roster', async () => {
    const { result } = await mount(makeRemote());
    act(() => result.current.pick('stranger'));
    expect(result.current.me).toBeNull();
    expect(readPick(CODE)).toBeNull();
  });

  it('knows the remembered player on the next visit', async () => {
    savePick(CODE, ANA);
    const { result } = await mount(makeRemote());
    expect(result.current.me).toBe(ANA);
  });

  it('forgets a remembered player who is no longer on the roster', async () => {
    savePick(CODE, 'removed');
    const { result } = await mount(makeRemote());
    expect(result.current.me).toBeNull();
    expect(readPick(CODE)).toBeNull();
  });

  it('keeps the remembered player while only the offline copy is showing', async () => {
    writeCached(CODE, VIEW, NOW);
    savePick(CODE, ANA);
    const remote = makeRemote();
    remote.view.mockImplementation(fails('offline'));
    const { result } = await mount(remote);
    expect(result.current.me).toBe(ANA);
  });

  it('forgets who they are, for this code only', async () => {
    savePick(CODE, ANA);
    savePick('other', BEN);
    const { result } = await mount(makeRemote());
    act(() => result.current.forget());
    expect(result.current.me).toBeNull();
    expect(readPick(CODE)).toBeNull();
    expect(readPick('other')).toBe(BEN);
  });

  it('clears an old message when the pick changes', async () => {
    const remote = makeRemote();
    savePick(CODE, ANA);
    const { result } = await mount(remote);
    remote.answer.mockImplementation(fails('offline'));
    await act(async () => {
      await result.current.answer('in');
    });
    expect(result.current.message).not.toBeNull();
    act(() => result.current.forget());
    expect(result.current.message).toBeNull();
  });
});

describe('answering', () => {
  async function ready(remote: Stub = makeRemote()) {
    savePick(CODE, ANA);
    const hook = await mount(remote);
    return { ...hook, remote };
  }

  it.each(['in', 'maybe', 'out'] as const)('sends %s for the picked player', async (status) => {
    const { result, remote } = await ready();
    await act(async () => {
      await result.current.answer(status);
    });
    expect(remote.answer).toHaveBeenCalledWith(CODE, ANA, status, false);
  });

  it('sends the late flag with In', async () => {
    const { result, remote } = await ready();
    await act(async () => {
      await result.current.answer('in', true);
    });
    expect(remote.answer).toHaveBeenCalledWith(CODE, ANA, 'in', true);
  });

  it('never sends the late flag with Maybe or Out', async () => {
    const { result, remote } = await ready();
    await act(async () => {
      await result.current.answer('maybe', true);
      await result.current.answer('out', true);
    });
    expect(remote.answer).toHaveBeenNthCalledWith(1, CODE, ANA, 'maybe', false);
    expect(remote.answer).toHaveBeenNthCalledWith(2, CODE, ANA, 'out', false);
  });

  it('shows the new answer at once, and asks the server again', async () => {
    const { result, remote } = await ready();
    remote.view.mockResolvedValue(view({ answers: [{ player_id: BEN, status: 'maybe', late: false }, { player_id: ANA, status: 'in', late: true }] }));
    await act(async () => {
      await result.current.answer('in', true);
    });
    expect(remote.view).toHaveBeenCalledTimes(2);
    expect(result.current.view?.answers).toContainEqual({ player_id: ANA, status: 'in', late: true });
    expect(result.current.message).toBeNull();
  });

  it('shows the new answer even when the refresh after it fails', async () => {
    const { result, remote } = await ready();
    remote.view.mockImplementation(fails('offline'));
    await act(async () => {
      await result.current.answer('in', true);
    });
    expect(result.current.view?.answers).toContainEqual({ player_id: ANA, status: 'in', late: true });
    expect(result.current.stale?.offline).toBe(true);
  });

  it('replaces an earlier answer of the same player and leaves the others', async () => {
    const remote = makeRemote(view({ answers: [{ player_id: ANA, status: 'maybe', late: false }, { player_id: BEN, status: 'in', late: false }] }));
    const { result } = await ready(remote);
    remote.view.mockImplementation(fails('offline'));
    await act(async () => {
      await result.current.answer('out');
    });
    expect(result.current.view?.answers).toEqual([
      { player_id: BEN, status: 'in', late: false },
      { player_id: ANA, status: 'out', late: false },
    ]);
  });

  it('is busy while the answer is on its way', async () => {
    const { result, remote } = await ready();
    const reply = deferred<void>();
    remote.answer.mockReturnValue(reply.promise);
    let done!: Promise<void>;
    act(() => {
      done = result.current.answer('in');
    });
    expect(result.current.busy).toBe(true);
    reply.resolve();
    await act(async () => {
      await done;
    });
    expect(result.current.busy).toBe(false);
  });

  it('ignores a second answer while one is on its way', async () => {
    const { result, remote } = await ready();
    const reply = deferred<void>();
    remote.answer.mockReturnValue(reply.promise);
    act(() => {
      void result.current.answer('in');
    });
    await act(async () => {
      await result.current.answer('out');
    });
    expect(remote.answer).toHaveBeenCalledTimes(1);
    reply.resolve();
    await settle();
  });

  it('does nothing when nobody is picked', async () => {
    const remote = makeRemote();
    const { result } = await mount(remote);
    await act(async () => {
      await result.current.answer('in');
    });
    expect(remote.answer).not.toHaveBeenCalled();
  });

  it('does nothing on a cancelled date', async () => {
    const { result, remote } = await ready(makeRemote(view({ cancelled: { reason: 'Rain' } })));
    await act(async () => {
      await result.current.answer('in');
    });
    expect(remote.answer).not.toHaveBeenCalled();
  });

  it('changes nothing when offline, and says so', async () => {
    const { result, remote } = await ready();
    remote.answer.mockImplementation(fails('offline'));
    const before = result.current.view;
    await act(async () => {
      await result.current.answer('in', true);
    });
    expect(result.current.view).toBe(before);
    expect(result.current.view?.answers).toEqual(VIEW.answers);
    expect(result.current.message).toBe('No connection. Try again when you are online.');
    expect(result.current.busy).toBe(false);
    expect(result.current.phase).toBe('ready');
    expect(remote.view).toHaveBeenCalledTimes(1);
  });

  it('says something went wrong for a server failure, and changes nothing', async () => {
    const { result, remote } = await ready();
    remote.answer.mockImplementation(fails('server'));
    await act(async () => {
      await result.current.answer('in');
    });
    expect(result.current.message).toBe('Something went wrong. Try again.');
    expect(result.current.view?.answers).toEqual(VIEW.answers);
  });

  it('clears the message on the next answer that works', async () => {
    const { result, remote } = await ready();
    remote.answer.mockImplementationOnce(fails('offline'));
    await act(async () => {
      await result.current.answer('in');
    });
    expect(result.current.message).not.toBeNull();
    await act(async () => {
      await result.current.answer('in');
    });
    expect(result.current.message).toBeNull();
  });

  it('shows the cancelled week after a cancelled answer, with no error text', async () => {
    const { result, remote } = await ready();
    remote.answer.mockImplementation(fails('cancelled'));
    remote.view.mockResolvedValue(view({ cancelled: { reason: 'Rain' } }));
    await act(async () => {
      await result.current.answer('in');
    });
    expect(result.current.view?.cancelled).toEqual({ reason: 'Rain' });
    expect(result.current.message).toBeNull();
  });

  it('asks for the name again when the server no longer knows the player', async () => {
    const { result, remote } = await ready();
    remote.answer.mockImplementation(fails('unknown_player'));
    remote.view.mockResolvedValue(view({ players: [player(BEN, 'Ben')] }));
    await act(async () => {
      await result.current.answer('in');
    });
    expect(result.current.me).toBeNull();
    expect(readPick(CODE)).toBeNull();
  });

  it('is notfound when the link stopped working', async () => {
    const { result, remote } = await ready();
    remote.answer.mockImplementation(fails('unknown_link'));
    await act(async () => {
      await result.current.answer('in');
    });
    expect(result.current.phase).toBe('notfound');
  });

  it('says something went wrong for a status the server refused', async () => {
    const { result, remote } = await ready();
    remote.answer.mockImplementation(fails('bad_status'));
    await act(async () => {
      await result.current.answer('in');
    });
    expect(result.current.message).toBe('Something went wrong. Try again.');
  });
});

describe('friends and new names', () => {
  async function ready(remote: Stub = makeRemote()) {
    savePick(CODE, ANA);
    const hook = await mount(remote);
    return { ...hook, remote };
  }

  it('adds a friend for the picked player, with the name trimmed', async () => {
    const { result, remote } = await ready();
    let out: Awaited<ReturnType<typeof result.current.addFriend>> | undefined;
    await act(async () => {
      out = await result.current.addFriend('  Zed Zane ');
    });
    expect(remote.addGuest).toHaveBeenCalledWith(CODE, 'Zed Zane', ANA);
    expect(out).toEqual({ ok: true, message: 'Added for the organizer to confirm.' });
    expect(result.current.message).toBe('Added for the organizer to confirm.');
  });

  it('asks to join with nobody bringing them, and needs no pick', async () => {
    const remote = makeRemote();
    const { result } = await mount(remote);
    let out: Awaited<ReturnType<typeof result.current.askToJoin>> | undefined;
    await act(async () => {
      out = await result.current.askToJoin('Newbie');
    });
    expect(remote.addGuest).toHaveBeenCalledWith(CODE, 'Newbie', null);
    expect(out).toEqual({ ok: true, message: 'Thanks. The organizer will see your name.' });
  });

  it('asks again after a friend is added, so the friends count follows', async () => {
    const { result, remote } = await ready();
    remote.view.mockResolvedValue(view({ friends: 1 }));
    await act(async () => {
      await result.current.addFriend('Zed');
    });
    expect(result.current.view?.friends).toBe(1);
  });

  it('adds a friend only for a picked player', async () => {
    const remote = makeRemote();
    const { result } = await mount(remote);
    let out: Awaited<ReturnType<typeof result.current.addFriend>> | undefined;
    await act(async () => {
      out = await result.current.addFriend('Zed');
    });
    expect(remote.addGuest).not.toHaveBeenCalled();
    expect(out?.ok).toBe(false);
  });

  it.each([['empty', ''], ['blank', '   '], ['41 characters', 'x'.repeat(41)]])('refuses a %s name without asking the server', async (_n, name) => {
    const { result, remote } = await ready();
    let out: Awaited<ReturnType<typeof result.current.addFriend>> | undefined;
    await act(async () => {
      out = await result.current.addFriend(name);
    });
    expect(out).toEqual({ ok: false, reason: 'bad_name', message: 'Use 1 to 40 characters.' });
    expect(remote.addGuest).not.toHaveBeenCalled();
  });

  it('accepts 40 characters', async () => {
    const { result, remote } = await ready();
    await act(async () => {
      await result.current.askToJoin('x'.repeat(40));
    });
    expect(remote.addGuest).toHaveBeenCalledTimes(1);
  });

  it('counts the length after trimming', async () => {
    const { result, remote } = await ready();
    await act(async () => {
      await result.current.askToJoin(` ${'x'.repeat(40)} `);
    });
    expect(remote.addGuest).toHaveBeenCalledWith(CODE, 'x'.repeat(40), null);
  });

  it.each([
    ['too_many', 'The list of new names is full. Ask your organizer.'],
    ['bad_name', 'Use 1 to 40 characters.'],
    ['offline', 'No connection. Try again when you are online.'],
    ['server', 'Something went wrong. Try again.'],
  ] as const)('says the right thing for %s', async (reason, text) => {
    const { result, remote } = await ready();
    remote.addGuest.mockImplementation(fails(reason));
    let out: Awaited<ReturnType<typeof result.current.askToJoin>> | undefined;
    await act(async () => {
      out = await result.current.askToJoin('Newbie');
    });
    expect(out).toEqual({ ok: false, reason, message: text });
    expect(result.current.message).toBe(text);
    expect(result.current.busy).toBe(false);
  });

  it('shows the cancelled week after a cancelled name', async () => {
    const { result, remote } = await ready();
    remote.addGuest.mockImplementation(fails('cancelled'));
    remote.view.mockResolvedValue(view({ cancelled: { reason: null } }));
    let out: Awaited<ReturnType<typeof result.current.askToJoin>> | undefined;
    await act(async () => {
      out = await result.current.askToJoin('Newbie');
    });
    expect(result.current.view?.cancelled).toEqual({ reason: null });
    expect(out).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(result.current.message).toBeNull();
  });

  it('is notfound when the link stopped working', async () => {
    const { result, remote } = await ready();
    remote.addGuest.mockImplementation(fails('unknown_link'));
    await act(async () => {
      await result.current.askToJoin('Newbie');
    });
    expect(result.current.phase).toBe('notfound');
  });

  it('asks for the name again when the player who brings a friend is gone', async () => {
    const { result, remote } = await ready();
    remote.addGuest.mockImplementation(fails('unknown_player'));
    remote.view.mockResolvedValue(view({ players: [player(BEN, 'Ben')] }));
    await act(async () => {
      await result.current.addFriend('Zed');
    });
    expect(result.current.me).toBeNull();
    expect(readPick(CODE)).toBeNull();
  });

  it('is busy while a name is on its way', async () => {
    const { result, remote } = await ready();
    const reply = deferred<void>();
    remote.addGuest.mockReturnValue(reply.promise);
    let done!: Promise<unknown>;
    act(() => {
      done = result.current.askToJoin('Newbie');
    });
    expect(result.current.busy).toBe(true);
    reply.resolve();
    await act(async () => {
      await done;
    });
    expect(result.current.busy).toBe(false);
  });
});

describe('refreshing', () => {
  const visible = (state: 'visible' | 'hidden') => vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  beforeEach(() => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
  });

  const tick = (ms: number) => act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

  it('asks again every 30 seconds while the page is visible', async () => {
    visible('visible');
    const remote = makeRemote();
    await mount(remote);
    expect(remote.view).toHaveBeenCalledTimes(1);
    await tick(29_999);
    expect(remote.view).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(remote.view).toHaveBeenCalledTimes(2);
    await tick(30_000);
    expect(remote.view).toHaveBeenCalledTimes(3);
  });

  it('does not ask while the page is hidden', async () => {
    visible('hidden');
    const remote = makeRemote();
    await mount(remote);
    const before = remote.view.mock.calls.length;
    await tick(90_000);
    expect(remote.view).toHaveBeenCalledTimes(before);
  });

  it('asks when the page becomes visible', async () => {
    const state = visible('hidden');
    const remote = makeRemote();
    await mount(remote);
    const before = remote.view.mock.calls.length;
    state.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(remote.view).toHaveBeenCalledTimes(before + 1);
  });

  it('does not ask when the page becomes hidden', async () => {
    const state = visible('visible');
    const remote = makeRemote();
    await mount(remote);
    state.mockReturnValue('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(remote.view).toHaveBeenCalledTimes(1);
  });

  it('stops asking, and stops listening, when the page closes', async () => {
    visible('visible');
    const remote = makeRemote();
    const { unmount } = await mount(remote);
    unmount();
    await tick(120_000);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(remote.view).toHaveBeenCalledTimes(1);
  });

  it('keeps the view when a poll fails, and marks it stale', async () => {
    visible('visible');
    const remote = makeRemote();
    const { result } = await mount(remote);
    remote.view.mockImplementation(fails('offline'));
    await tick(30_000);
    expect(result.current.view).toEqual(VIEW);
    expect(result.current.stale).toEqual({ at: NOW, offline: true });
  });

  it('shows a new view from a poll', async () => {
    visible('visible');
    const remote = makeRemote();
    const { result } = await mount(remote);
    remote.view.mockResolvedValue(view({ friends: 3 }));
    await tick(30_000);
    expect(result.current.view?.friends).toBe(3);
  });

  it('does not keep asking for a code that does not exist', async () => {
    visible('visible');
    const remote = makeRemote(null);
    await mount(remote);
    await tick(120_000);
    expect(remote.view).toHaveBeenCalledTimes(1);
  });

  it('does not ask at all when there is no backend', async () => {
    visible('visible');
    const { result } = await mount(null);
    await tick(60_000);
    expect(result.current.phase).toBe('unavailable');
  });
});

describe('a late reply from an earlier request', () => {
  it('is ignored when a newer request has already answered (the double effect run)', async () => {
    const first = deferred<AttendanceViewData | null>();
    const second = deferred<AttendanceViewData | null>();
    const remote = makeRemote();
    remote.view.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useMemberPage(CODE, remote), { wrapper: StrictMode });
    expect(remote.view).toHaveBeenCalledTimes(2);
    second.resolve(view({ title: 'Newer' }));
    await settle();
    expect(result.current.view?.title).toBe('Newer');
    first.resolve(view({ title: 'Older' }));
    await settle();
    expect(result.current.view?.title).toBe('Newer');
    expect(readCached(CODE)?.view.title).toBe('Newer');
  });

  it('is ignored when it arrives first, and the newer reply still counts', async () => {
    const first = deferred<AttendanceViewData | null>();
    const second = deferred<AttendanceViewData | null>();
    const remote = makeRemote();
    remote.view.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useMemberPage(CODE, remote), { wrapper: StrictMode });
    first.resolve(view({ title: 'Older' }));
    await settle();
    expect(result.current.phase).toBe('loading');
    second.resolve(view({ title: 'Newer' }));
    await settle();
    expect(result.current.phase).toBe('ready');
    expect(result.current.view?.title).toBe('Newer');
  });

  it('is ignored when an earlier request fails late', async () => {
    const first = deferred<AttendanceViewData | null>();
    const second = deferred<AttendanceViewData | null>();
    const remote = makeRemote();
    remote.view.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useMemberPage(CODE, remote), { wrapper: StrictMode });
    second.resolve(VIEW);
    await settle();
    first.reject(new MemberError('offline'));
    await settle();
    expect(result.current.phase).toBe('ready');
    expect(result.current.stale).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('is ignored when it comes after the page closed', async () => {
    const reply = deferred<AttendanceViewData | null>();
    const remote = makeRemote();
    remote.view.mockReturnValue(reply.promise);
    const { unmount } = renderHook(() => useMemberPage(CODE, remote));
    unmount();
    reply.resolve(VIEW);
    await settle();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it('is ignored when a poll answers after a newer answer-refresh', async () => {
    savePick(CODE, ANA);
    const remote = makeRemote();
    const { result } = await mount(remote);
    const slow = deferred<AttendanceViewData | null>();
    remote.view.mockReturnValueOnce(slow.promise);
    await act(async () => {
      result.current.retry();
    });
    remote.view.mockResolvedValue(view({ friends: 2 }));
    await act(async () => {
      await result.current.answer('in');
    });
    expect(result.current.view?.friends).toBe(2);
    slow.resolve(view({ friends: 99 }));
    await settle();
    expect(result.current.view?.friends).toBe(2);
  });
});

describe('the double effect run', () => {
  it('ends with a ready view and one remembered pick', async () => {
    savePick(CODE, ANA);
    const { result } = await mount(makeRemote(), { strict: true });
    expect(result.current.phase).toBe('ready');
    expect(result.current.me).toBe(ANA);
  });
});

describe('what the hook imports', () => {
  const sources = import.meta.glob('./*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const DENIED = [
    'ui/App',
    'ui/HomeScreen',
    'ui/AttendanceCard',
    'ui/useAttendance',
    'sync/attendance/start',
    'sync/attendance/store',
    'sync/coordinator',
    'sync/auth',
    'store/rosterStore',
    'store/sessionStore',
    'store/slots',
    'ui/ErrorBoundary',
  ];
  const specifiers = (text: string) => [...text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const resolve = (spec: string) => {
    if (!spec.startsWith('.')) return spec;
    const parts = ['member'];
    for (const piece of spec.split('/')) {
      if (piece === '..') parts.pop();
      else if (piece !== '.') parts.push(piece);
    }
    return parts.join('/').replace(/\/index$/, '');
  };

  it('imports none of the app, the stores or the sync engine', () => {
    const files = Object.entries(sources).filter(([name]) => !/\.test\.tsx?$/.test(name) && !name.includes('fakeRemote'));
    expect(files.map(([name]) => name)).toContain('./useMemberPage.ts');
    for (const [name, text] of files) {
      for (const spec of specifiers(text)) expect([name, DENIED.includes(resolve(spec))]).toEqual([name, false]);
    }
  });

  it('reads the specifiers it should', () => {
    expect(specifiers(sources['./useMemberPage.ts'])).toContain('react');
    expect(specifiers("import x from '../ui/App';")).toEqual(['../ui/App']);
    expect(resolve('../ui/App')).toBe('ui/App');
    expect(resolve('./remote')).toBe('member/remote');
  });
});
