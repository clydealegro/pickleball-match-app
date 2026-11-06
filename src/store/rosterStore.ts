import { create } from 'zustand';
import {
  addRosterPlayer,
  deleteRosterPlayer,
  listRoster,
  markRosterPlayed,
  renameRosterPlayer,
  type RosterPlayer,
} from './rosterDb';

interface RosterState {
  players: RosterPlayer[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (name: string) => Promise<RosterPlayer>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  markPlayed: (ids: string[], at: number) => Promise<void>;
}

export const useRosterStore = create<RosterState>()((set) => {
  const refresh = async () => set({ players: await listRoster(), loaded: true });
  return {
    players: [],
    loaded: false,
    load: refresh,
    async add(name) {
      const player = await addRosterPlayer(name);
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
  };
});
