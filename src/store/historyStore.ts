import { create } from 'zustand';
import type { Session } from '../engine';
import { clearHistory, isHistoryPersistent, listHistory, saveSessionToHistory, type HistoryEntry } from './historyDb';

interface HistoryState {
  entries: HistoryEntry[];
  loaded: boolean;
  /** False when history only lives in memory (IndexedDB unavailable). */
  persistent: boolean;
  load: () => Promise<void>;
  /** Keeps a finished session. Never throws: history must not get in the way of ending a session. */
  save: (session: Session) => Promise<void>;
  clear: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>()((set) => {
  const refresh = async () => {
    try {
      set({ entries: await listHistory(), loaded: true, persistent: isHistoryPersistent() });
    } catch {
      set({ loaded: true, persistent: false });
    }
  };
  return {
    entries: [],
    loaded: false,
    persistent: true,
    load: refresh,
    async save(session) {
      try {
        await saveSessionToHistory(session);
      } catch {
        // A session that cannot be kept is simply not in the list.
      }
      await refresh();
    },
    async clear() {
      try {
        await clearHistory();
      } catch {
        // Nothing to forget if storage is unavailable.
      }
      await refresh();
    },
  };
});
