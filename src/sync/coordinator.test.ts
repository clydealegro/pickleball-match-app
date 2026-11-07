import { createStore } from 'zustand/vanilla';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addRosterPlayer, resetRosterDbForTests } from '../store/rosterDb';
import type { AuthStatus } from './auth';
import { pauseSync, startSyncCoordinator, syncNow, type CoordinatorDeps } from './coordinator';
import type { Remote } from './remote';
import { useSyncStore } from './syncStore';

/** A server that holds nothing and accepts everything, and counts what it is asked. */
function stubRemote() {
  const upserts: string[] = [];
  let pulls = 0;
  const remote: Remote = {
    upsertPlayer: async (row) => {
      upserts.push(row.name);
      return 'ok';
    },
    listLive: async () => [],
    pull: async () => {
      pulls += 1;
      return [];
    },
    uploadPhoto: async () => undefined,
    downloadPhoto: async () => null,
    listPhotoFiles: async () => [],
    removePhotoFiles: async () => undefined,
    deleteAllMyPlayers: async () => undefined,
  };
  return { remote, upserts, pulls: () => pulls };
}

const auth = createStore<{ status: AuthStatus; userId: string | null }>(() => ({ status: 'loading', userId: null }));
const signIn = (userId: string) => auth.setState({ status: 'signedIn', userId });

let stub: ReturnType<typeof stubRemote>;
let onChanged: ReturnType<typeof vi.fn>;
let makeRemote: ReturnType<typeof vi.fn>;
let stop: (() => void) | undefined;

function start(over: Partial<CoordinatorDeps> = {}) {
  stop = startSyncCoordinator({
    auth,
    makeRemote,
    onChanged,
    timing: { debounceMs: 5, intervalMs: 60_000 },
    ...over,
  });
}

beforeEach(async () => {
  await resetRosterDbForTests();
  auth.setState({ status: 'loading', userId: null });
  stub = stubRemote();
  onChanged = vi.fn();
  makeRemote = vi.fn(() => stub.remote);
  useSyncStore.setState({ status: 'off', pending: 0, lastSyncedAt: null });
});
afterEach(() => {
  stop?.();
  stop = undefined;
});

describe('the sync coordinator', () => {
  it('does nothing while nobody is signed in', async () => {
    await addRosterPlayer('Ann');
    start();
    for (const status of ['loading', 'unknown', 'signedOut', 'linkSent', 'unconfigured'] as const) {
      auth.setState({ status, userId: status === 'unknown' ? 'u1' : null });
    }
    await new Promise((r) => setTimeout(r, 30));
    expect(makeRemote).not.toHaveBeenCalled();
    expect(useSyncStore.getState().status).toBe('off');
  });

  it('syncs once signed in, and shows the result', async () => {
    await addRosterPlayer('Ann');
    start();
    signIn('u1');
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
    expect(makeRemote).toHaveBeenCalledWith('u1');
    expect(stub.upserts).toEqual(['Ann']);
    expect(useSyncStore.getState()).toMatchObject({ pending: 0, lastSyncedAt: expect.any(Number) });
    expect(onChanged).toHaveBeenCalled();
  });

  it('is already signed in when it starts', async () => {
    signIn('u1');
    start();
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
  });

  it('pushes a change made on this device soon after', async () => {
    signIn('u1');
    start();
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
    await addRosterPlayer('Ben');
    await vi.waitFor(() => expect(stub.upserts).toEqual(['Ben']));
  });

  it('stops when the organizer signs out, and does not sync later changes', async () => {
    signIn('u1');
    start();
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
    auth.setState({ status: 'signedOut', userId: null });
    expect(useSyncStore.getState().status).toBe('off');
    await addRosterPlayer('Ben');
    await new Promise((r) => setTimeout(r, 40));
    expect(stub.upserts).toEqual([]);
  });

  it('does not sync, and does not clear anything, when the session could not be checked', async () => {
    signIn('u1');
    start();
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
    await addRosterPlayer('Ben');
    auth.setState({ status: 'unknown', userId: 'u1' });
    await new Promise((r) => setTimeout(r, 40));
    expect(useSyncStore.getState().status).toBe('off');
    expect(stub.upserts).not.toContain('Ben');
  });

  it('does nothing when this build has no backend', async () => {
    signIn('u1');
    start({ makeRemote: () => null });
    await new Promise((r) => setTimeout(r, 30));
    expect(useSyncStore.getState().status).toBe('off');
  });

  it('refuses a second account on the same device, and says so', async () => {
    signIn('u1');
    start();
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
    signIn('u2');
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('otherAccount'));
  });

  it('syncs again when the connection comes back, and when the app is shown again after a while', async () => {
    signIn('u1');
    start();
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
    const before = stub.pulls();
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(stub.pulls()).toBe(before + 1));

    // Shown again straight after a round: no new round.
    window.dispatchEvent(new Event('focus'));
    await new Promise((r) => setTimeout(r, 30));
    expect(stub.pulls()).toBe(before + 1);

    // Shown again after a while.
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 31_000);
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(stub.pulls()).toBe(before + 2));
    vi.spyOn(Date, 'now').mockReturnValue(now + 62_000);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 30));
    expect(stub.pulls()).toBe(before + 2);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(stub.pulls()).toBe(before + 3));
    vi.restoreAllMocks();
  });

  it('can be paused, waits for a round in flight, and starts again when resumed', async () => {
    signIn('u1');
    start();
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
    let finishRound: (() => void) | undefined;
    stub.remote.pull = () => new Promise<unknown[]>((resolve) => (finishRound = () => resolve([])));
    syncNow();
    await vi.waitFor(() => expect(finishRound).toBeDefined());

    let paused = false;
    const resume = await Promise.race([
      pauseSync().then((r) => {
        paused = true;
        return r;
      }),
      new Promise<undefined>((r) => setTimeout(() => r(undefined), 30)),
    ]);
    expect(resume).toBeUndefined(); // still waiting for the round
    expect(paused).toBe(false);
    finishRound?.();
    await vi.waitFor(() => expect(paused).toBe(true));
    expect(useSyncStore.getState().status).toBe('off');

    const pullsBefore = stub.pulls();
    await addRosterPlayer('Zed');
    signIn('u1'); // a sign-in change while paused does not start anything
    await new Promise((r) => setTimeout(r, 40));
    expect(stub.pulls()).toBe(pullsBefore);
    expect(stub.upserts).not.toContain('Zed');

    stub.remote.pull = async () => [];
    const again = await pauseSync(); // pausing twice is harmless
    again();
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
    expect(stub.upserts).toContain('Zed');
  });

  it('does nothing to pause, resume or nudge when it is not running, even after it has run', async () => {
    const resume = await pauseSync();
    resume();
    syncNow();
    expect(useSyncStore.getState().status).toBe('off');

    start();
    stop?.();
    stop = undefined;
    signIn('u1');
    (await pauseSync())();
    syncNow();
    await new Promise((r) => setTimeout(r, 40));
    expect(makeRemote).not.toHaveBeenCalled();
    expect(useSyncStore.getState().status).toBe('off');
  });

  it('takes back every listener it added when it is stopped', () => {
    const windowOff = vi.spyOn(window, 'removeEventListener');
    const documentOff = vi.spyOn(document, 'removeEventListener');
    start();
    stop?.();
    stop = undefined;
    expect(windowOff.mock.calls.map(([type]) => type).sort()).toEqual(['focus', 'online']);
    expect(documentOff.mock.calls.map(([type]) => type)).toEqual(['visibilitychange']);
    windowOff.mockRestore();
    documentOff.mockRestore();
  });

  it('stops listening to everything when it is stopped', async () => {
    signIn('u1');
    start();
    await vi.waitFor(() => expect(useSyncStore.getState().status).toBe('synced'));
    stop?.();
    stop = undefined;
    const before = stub.pulls();
    window.dispatchEvent(new Event('online'));
    await addRosterPlayer('Ben');
    await new Promise((r) => setTimeout(r, 40));
    expect(stub.pulls()).toBe(before);
    expect(useSyncStore.getState().status).toBe('off');
  });
});
