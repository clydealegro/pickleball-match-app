import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveBoard } from '../sync/live/board';
import type { LiveFaceReply, LiveViewReply } from './liveTypes';
import { MemberError, type MemberRemote } from './remote';
import { FACES_KEY, IDLE_POLL_MS, LIVE_POLL_MS, useLiveBoard } from './useLiveBoard';

const BOARD: LiveBoard = {
  title: 'Tuesday open play',
  courts: [{ n: 1, status: 'playing', closing: false, startedAt: 1, teams: [['a', 'b'], ['c', 'd']] }],
  players: { a: { f: 'Ana', l: 'R', r: 'r-a' }, b: { f: 'Ben', l: null, r: 'r-b' }, c: { f: 'Cy', l: null, r: null }, d: { f: 'Dee', l: null, r: null } },
  waiting: [],
  onBreak: [],
};
const full = (version: number, over: Partial<Extract<LiveViewReply, { state: 'live' }>> = {}): LiveViewReply =>
  ({ state: 'live', version, ageS: 2, showPhotos: true, board: BOARD, ...over }) as LiveViewReply;
const FACE = (id: string, seq = 1): LiveFaceReply => ({ id, seq, data: `data:image/jpeg;base64,${id.toUpperCase()}` });

function remoteWith(replies: (since: number | null) => LiveViewReply | Promise<LiveViewReply>, faces: LiveFaceReply[] = []) {
  const live = vi.fn(async (_code: string, since: number | null) => replies(since));
  const liveFaces = vi.fn(async (_code: string, _have: string[]) => faces);
  const remote = { view: vi.fn(), answer: vi.fn(), addGuest: vi.fn(), live, liveFaces } as unknown as MemberRemote;
  return { remote, live, liveFaces };
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useLiveBoard', () => {
  it('is idle at once for a remote with no live board', () => {
    const { result } = renderHook(() => useLiveBoard('code', { view: vi.fn(), answer: vi.fn(), addGuest: vi.fn() } as unknown as MemberRemote));
    expect(result.current.phase).toBe('idle');
    expect(renderHook(() => useLiveBoard('code', null)).result.current.phase).toBe('idle');
  });

  it('is checking until the first answer, then shows the board', async () => {
    const { remote } = remoteWith(() => full(5));
    const { result } = renderHook(() => useLiveBoard('code', remote));
    expect(result.current.phase).toBe('checking');
    await flush();
    expect(result.current).toMatchObject({ phase: 'live', version: 5, ageS: 2, failed: false, showPhotos: true });
    expect(result.current.board?.title).toBe('Tuesday open play');
  });

  it('is idle when no board is up, and asks again slowly in case one starts', async () => {
    let up = false;
    const { remote, live } = remoteWith(() => (up ? full(1) : { state: 'idle' }));
    const { result } = renderHook(() => useLiveBoard('code', remote));
    await flush();
    expect(result.current.phase).toBe('idle');
    await wait(IDLE_POLL_MS - 1);
    expect(live).toHaveBeenCalledTimes(1);
    up = true;
    await wait(2);
    expect(live).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe('live');
  });

  it('asks every 8 seconds while a board is up, with the version it already has', async () => {
    const { remote, live } = remoteWith((since) => (since === 5 ? { state: 'live', version: 5, ageS: 6, unchanged: true } : full(5)));
    const { result } = renderHook(() => useLiveBoard('code', remote));
    await flush();
    await wait(LIVE_POLL_MS);
    expect(live).toHaveBeenLastCalledWith('code', 5);
    expect(result.current).toMatchObject({ phase: 'live', ageS: 6 });
    expect(result.current.board?.title).toBe('Tuesday open play');
  });

  it('replaces the board when a newer version arrives', async () => {
    let n = 1;
    const { remote } = remoteWith(() => full(n, { board: { ...BOARD, title: `Board ${n}` } }));
    const { result } = renderHook(() => useLiveBoard('code', remote));
    await flush();
    n = 2;
    await wait(LIVE_POLL_MS);
    expect(result.current.board?.title).toBe('Board 2');
  });

  it('shows paused with no board, and sends no version when it comes back so the whole board is fetched', async () => {
    let state: 'paused' | 'live' = 'live';
    const { remote, live } = remoteWith((since) => (state === 'paused' ? { state: 'paused', version: 5, ageS: 3 } : since === null ? full(5) : { state: 'live', version: 5, ageS: 1, unchanged: true }));
    const { result } = renderHook(() => useLiveBoard('code', remote));
    await flush();
    state = 'paused';
    await wait(LIVE_POLL_MS);
    expect(result.current).toMatchObject({ phase: 'paused', board: null });
    state = 'live';
    await wait(LIVE_POLL_MS);
    expect(live).toHaveBeenLastCalledWith('code', null);
    expect(result.current.board).not.toBeNull();
  });

  it('keeps the last board and marks it when asking fails, and recovers', async () => {
    let fail = false;
    const { remote } = remoteWith(() => {
      if (fail) throw new MemberError('offline');
      return full(5);
    });
    const { result } = renderHook(() => useLiveBoard('code', remote));
    await flush();
    fail = true;
    await wait(LIVE_POLL_MS);
    expect(result.current).toMatchObject({ phase: 'live', failed: true });
    expect(result.current.board).not.toBeNull();
    fail = false;
    await wait(LIVE_POLL_MS);
    expect(result.current.failed).toBe(false);
  });

  it('treats a failure with no board up as no board, so an older server just shows the list', async () => {
    const { remote } = remoteWith(() => {
      throw new MemberError('server');
    });
    const { result } = renderHook(() => useLiveBoard('code', remote));
    await flush();
    expect(result.current.phase).toBe('idle');
  });

  it('does not ask while the page is hidden, and asks as it comes back', async () => {
    const { remote, live } = remoteWith(() => full(5));
    renderHook(() => useLiveBoard('code', remote));
    await flush();
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await wait(LIVE_POLL_MS * 3);
    expect(live).toHaveBeenCalledTimes(1);
    state.mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(live).toHaveBeenCalledTimes(2);
    state.mockRestore();
  });

  it('stops asking when the page goes away', async () => {
    const { remote, live } = remoteWith(() => full(5));
    const { unmount } = renderHook(() => useLiveBoard('code', remote));
    await flush();
    unmount();
    await wait(LIVE_POLL_MS * 3);
    expect(live).toHaveBeenCalledTimes(1);
  });
});

describe('faces', () => {
  it('fetches the faces a board needs once, shows them, and keeps them for next time', async () => {
    const { remote, liveFaces } = remoteWith(() => full(5), [FACE('r-a', 3), FACE('r-b', 1)]);
    const { result } = renderHook(() => useLiveBoard('code', remote));
    await flush();
    expect(liveFaces).toHaveBeenCalledWith('code', []);
    expect(result.current.faces).toEqual({ 'r-a': 'data:image/jpeg;base64,R-A', 'r-b': 'data:image/jpeg;base64,R-B' });
    expect(JSON.parse(localStorage.getItem(FACES_KEY)!)['r-a']).toEqual({ seq: 3, data: 'data:image/jpeg;base64,R-A' });
    await wait(LIVE_POLL_MS * 2);
    expect(liveFaces).toHaveBeenCalledTimes(1);
  });

  it('starts from the faces kept on the phone and only asks for what is missing', async () => {
    localStorage.setItem(FACES_KEY, JSON.stringify({ 'r-a': { seq: 3, data: 'data:image/jpeg;base64,R-A' } }));
    const { remote, liveFaces } = remoteWith(() => full(5), [FACE('r-b', 1)]);
    const { result } = renderHook(() => useLiveBoard('code', remote));
    await flush();
    expect(liveFaces).toHaveBeenCalledWith('code', ['r-a:3']);
    expect(Object.keys(result.current.faces).sort()).toEqual(['r-a', 'r-b']);
  });

  it('asks again after a minute, with what it has, in case a photo changed', async () => {
    const { remote, liveFaces } = remoteWith(() => full(5), [FACE('r-a'), FACE('r-b')]);
    renderHook(() => useLiveBoard('code', remote));
    await flush();
    await wait(60_000 + LIVE_POLL_MS);
    expect(liveFaces).toHaveBeenCalledTimes(2);
    expect(liveFaces).toHaveBeenLastCalledWith('code', ['r-a:1', 'r-b:1']);
  });

  it('shows no faces when the organizer turned photos off, and asks for none', async () => {
    localStorage.setItem(FACES_KEY, JSON.stringify({ 'r-a': { seq: 3, data: 'data:image/jpeg;base64,R-A' } }));
    const { remote, liveFaces } = remoteWith(() => full(5, { showPhotos: false }));
    const { result } = renderHook(() => useLiveBoard('code', remote));
    await flush();
    expect(result.current.faces).toEqual({});
    expect(liveFaces).not.toHaveBeenCalled();
  });

  it('shows initials and carries on when the faces cannot be fetched', async () => {
    const { remote, liveFaces } = remoteWith(() => full(5));
    liveFaces.mockRejectedValue(new MemberError('offline'));
    const { result } = renderHook(() => useLiveBoard('code', remote));
    await flush();
    expect(result.current.phase).toBe('live');
    expect(result.current.faces).toEqual({});
  });

  it('ignores a damaged face cache', async () => {
    localStorage.setItem(FACES_KEY, '{not json');
    const { remote } = remoteWith(() => full(5), [FACE('r-a')]);
    const { result } = renderHook(() => useLiveBoard('code', remote));
    await flush();
    expect(Object.keys(result.current.faces)).toEqual(['r-a']);
  });
});
