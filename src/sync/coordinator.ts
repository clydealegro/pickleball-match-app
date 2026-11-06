import { subscribeRosterChanges } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useAuthStore, type AuthStatus } from './auth';
import { getSupabase } from './client';
import { syncOnce } from './engine';
import { supabaseRemote, type Remote } from './remote';
import { createRunner, type Runner, type RunnerOptions } from './runner';
import { useSyncStore } from './syncStore';

/** Coming back to the app syncs again, unless a round ended less than this long ago. */
const FOCUS_GAP_MS = 30 * 1000;

export interface CoordinatorDeps {
  auth: {
    getState(): { status: AuthStatus; userId: string | null };
    subscribe(listener: () => void): () => void;
  };
  /** The server for this organizer, or null when this build has no backend. */
  makeRemote(userId: string): Remote | null;
  /** Called when a round changed what this device holds, so the screens can read it again. */
  onChanged(): void;
  /** Shorter waits, for tests. */
  timing?: Pick<RunnerOptions, 'intervalMs' | 'debounceMs'>;
}

const defaultDeps: CoordinatorDeps = {
  auth: useAuthStore,
  makeRemote(userId) {
    const client = getSupabase();
    return client ? supabaseRemote(client, userId) : null;
  },
  onChanged() {
    useRosterStore.getState().load().catch(() => {});
  },
};

/**
 * Keeps one sync runner going while an organizer is signed in, and none otherwise. A saved session that could not be
 * checked (`unknown`) neither syncs nor clears anything. Returns a function that stops it all.
 */
export function startSyncCoordinator(deps: CoordinatorDeps = defaultDeps): () => void {
  let runner: Runner | null = null;
  let runnerUser: string | null = null;
  let lastRoundAt = 0;

  function follow() {
    const { status, userId } = deps.auth.getState();
    const wanted = status === 'signedIn' && userId ? userId : null;
    if (wanted === runnerUser) return;
    runner?.stop();
    runner = null;
    runnerUser = wanted;
    useSyncStore.setState({ status: 'off', pending: 0 });
    if (!wanted) return;
    const remote = deps.makeRemote(wanted);
    if (!remote) return;
    runner = createRunner({
      ...deps.timing,
      run: () => syncOnce(remote, wanted),
      onStart: () => useSyncStore.setState({ status: 'syncing' }),
      onResult(result) {
        lastRoundAt = Date.now();
        if (result.ok) {
          useSyncStore.setState({ status: 'synced', pending: result.pending, lastSyncedAt: lastRoundAt });
          if (result.pushed > 0 || result.pulled > 0) deps.onChanged();
        } else {
          const status = result.reason === 'offline' ? 'offline' : result.reason === 'auth' ? 'auth' : result.reason === 'otherAccount' ? 'otherAccount' : 'error';
          useSyncStore.setState({ status, pending: result.pending });
        }
      },
    });
    // The runner starts on a timer, so nothing here runs inside the sign-in listener that told us about the session.
    runner.start();
  }

  const stopFollowing = deps.auth.subscribe(follow);
  const stopHearing = subscribeRosterChanges(() => runner?.poke());
  const back = () => {
    if (Date.now() - lastRoundAt > FOCUS_GAP_MS) runner?.poke(0);
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') back();
  };
  const onOnline = () => runner?.poke(0);
  window.addEventListener('online', onOnline);
  window.addEventListener('focus', back);
  document.addEventListener('visibilitychange', onVisible);
  follow();

  return () => {
    stopFollowing();
    stopHearing();
    window.removeEventListener('online', onOnline);
    window.removeEventListener('focus', back);
    document.removeEventListener('visibilitychange', onVisible);
    runner?.stop();
    runner = null;
    runnerUser = null;
    useSyncStore.setState({ status: 'off', pending: 0 });
  };
}
