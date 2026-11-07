import { create } from 'zustand';
import { requestPersistentStorage } from '../lib/persist';
import {
  addRosterPlayer,
  deleteRosterPlayer,
  isRosterBlocked,
  isRosterPersistent,
  listRoster,
  subscribeRosterBlocked,
  markRosterPlayed,
  removeRosterPhoto,
  renameRosterPlayer,
  setRosterPhoto,
  type PhotoData,
  type RosterPlayer,
} from './rosterDb';

interface RosterState {
  players: RosterPlayer[];
  loaded: boolean;
  /** False when saved players only live in memory (IndexedDB unavailable). */
  persistent: boolean;
  /** True while another tab of the app keeps saved players from loading (a database upgrade is waiting for it). */
  blocked: boolean;
  load: () => Promise<void>;
  add: (name: string) => Promise<RosterPlayer>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  markPlayed: (ids: string[], at: number) => Promise<void>;
  setPhoto: (id: string, photo: PhotoData) => Promise<void>;
  removePhoto: (id: string) => Promise<void>;
}

export const useRosterStore = create<RosterState>()((set) => {
  const refresh = async () => {
    const players = await listRoster();
    set({ players, loaded: true, persistent: isRosterPersistent() });
  };
  subscribeRosterBlocked(() => set({ blocked: isRosterBlocked() }));
  return {
    players: [],
    loaded: false,
    persistent: true,
    blocked: false,
    load: refresh,
    async add(name) {
      const player = await addRosterPlayer(name);
      void requestPersistentStorage(); // once there is something worth keeping
      await refresh();
      return player;
    },
    async rename(id, name) {
      await renameRosterPlayer(id, name);
      await refresh();
    },
    async remove(id) {
      await deleteRosterPlayer(id);
      await refresh();
    },
    async markPlayed(ids, at) {
      await markRosterPlayed(ids, at);
      await refresh();
    },
    async setPhoto(id, photo) {
      await setRosterPhoto(id, photo);
      void requestPersistentStorage();
      await refresh();
    },
    async removePhoto(id) {
      await removeRosterPhoto(id);
      await refresh();
    },
  };
});
