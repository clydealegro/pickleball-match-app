import { clearHistory } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { clearRosterData } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useAttendanceStore } from './attendance/store';
import { useAuthStore } from './auth';
import { getSupabase } from './client';
import { pauseSync, syncNow } from './coordinator';
import { isRemoteError, photoFolder, supabaseRemote, type Remote } from './remote';
import { useSyncStore } from './syncStore';

/** The Storage API removes at most this many files in one call. */
const REMOVE_BATCH = 1000;

export interface DataActionDeps {
  /** The server for the signed-in organizer and their id, or null when there is no backend or nobody is signed in. */
  server(): { remote: Remote; userId: string } | null;
  /** Stops syncing and waits for a round in flight. Returns the function that starts it again. */
  pause(): Promise<() => void>;
  syncNow(): void;
  /** Called when this device's players changed, so the screens read them again. */
  refresh(): void;
  batchSize?: number;
}

const defaultDeps: DataActionDeps = {
  server() {
    const client = getSupabase();
    const { status, userId } = useAuthStore.getState();
    return client && status === 'signedIn' && userId ? { remote: supabaseRemote(client, userId), userId } : null;
  },
  pause: pauseSync,
  syncNow,
  refresh() {
    useRosterStore.getState().load().catch(() => {});
  },
};

export type DataResult = { ok: true } | { ok: false; message: string };

/** Removes every photo file of the account, a player's folder at a time and in batches the Storage API accepts. */
export async function removeAllPhotoFiles(remote: Remote, userId: string, batchSize = REMOVE_BATCH): Promise<void> {
  const owner = userId.toLowerCase();
  const paths: string[] = [];
  for (const player of await remote.listPhotoFiles(owner)) {
    const folder = photoFolder(owner, player);
    for (const file of await remote.listPhotoFiles(folder)) paths.push(`${folder}/${file}`);
  }
  for (let from = 0; from < paths.length; from += batchSize) {
    await remote.removePhotoFiles(paths.slice(from, from + batchSize));
  }
}

/**
 * Deletes every player and photo from the signed-in account, then from this device. The device is cleared last, so a
 * failure leaves this device's players where they are, and trying again is safe. Syncing is paused throughout.
 */
export async function deleteAllMyData(deps: DataActionDeps = defaultDeps): Promise<DataResult> {
  const server = deps.server();
  if (!server) return { ok: false, message: 'Sign in to delete the data in your account.' };
  const resume = await deps.pause();
  try {
    await removeAllPhotoFiles(server.remote, server.userId, deps.batchSize);
    await server.remote.deleteAllMyPlayers();
    await clearRosterData();
    // Past sessions name the same people, so they go with the account's data.
    await clearHistory();
    // The attendance copy is part of the account's data.
    useAttendanceStore.getState().clear();
    void useHistoryStore.getState().load();
    useSyncStore.setState({ pending: 0, lastSyncedAt: null });
    deps.refresh();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        isRemoteError(error) && error.kind === 'offline'
          ? 'No connection. Try again when you are online. Nothing on this device was removed.'
          : "Couldn't finish deleting. Nothing on this device was removed. Try again: what was already deleted stays deleted.",
    };
  } finally {
    resume();
  }
}

/**
 * Removes the saved players, photos and sync records from this device only. An account they were backed up to is
 * not touched. If someone is signed in, they come back from the account on the next sync.
 */
export async function clearThisDevice(deps: DataActionDeps = defaultDeps): Promise<DataResult> {
  const resume = await deps.pause();
  try {
    await clearRosterData();
    useAttendanceStore.getState().clear();
    useSyncStore.setState({ pending: 0, lastSyncedAt: null });
    deps.refresh();
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't clear this device. Try again." };
  } finally {
    resume();
    deps.syncNow();
  }
}
