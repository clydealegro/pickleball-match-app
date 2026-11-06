import { create } from 'zustand';

/**
 * Where sync stands, for the screens to show. `off`: not signed in, or not signed in for sure, or no backend.
 * `error`: the server could not be reached or refused something, and sync will try again.
 */
export type SyncStatus = 'off' | 'syncing' | 'synced' | 'offline' | 'error' | 'auth' | 'otherAccount';

export interface SyncState {
  status: SyncStatus;
  /** Players with changes not yet pushed, as of the last round. */
  pending: number;
  /** When the last round ended well, in milliseconds. */
  lastSyncedAt: number | null;
}

export const useSyncStore = create<SyncState>()(() => ({ status: 'off', pending: 0, lastSyncedAt: null }));
