import type { AuthStatus } from './auth';
import type { SyncState } from './syncStore';

const changes = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'} waiting`;

/**
 * The one line that says where backing up stands, for the Saved players and Settings screens. Null when there is
 * nothing to say (no backend, or still checking the sign-in).
 */
export function syncLine(auth: AuthStatus, sync: Pick<SyncState, 'status' | 'pending'>): string | null {
  switch (auth) {
    case 'unconfigured':
    case 'loading':
      return null;
    case 'unknown':
      return "Can't check sign-in without a connection";
    case 'signedOut':
    case 'linkSent':
      return 'Signed out';
    case 'signedIn':
      break;
  }
  switch (sync.status) {
    case 'synced':
      // A round that left changes waiting is followed by another straight away.
      return sync.pending > 0 ? 'Syncing…' : 'Synced';
    case 'offline':
      return sync.pending > 0 ? `Offline, ${changes(sync.pending)}` : 'Offline';
    case 'error':
      return sync.pending > 0 ? `Can't reach server, will retry. ${changes(sync.pending)}` : "Can't reach server, will retry";
    case 'auth':
      return 'Your sign-in was not accepted. Sign out and sign in again.';
    case 'otherAccount':
      return "This device holds another account's players, so nothing is synced. See Settings.";
    case 'off':
    case 'syncing':
      return 'Syncing…';
  }
}
