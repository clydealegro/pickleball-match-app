import { create } from 'zustand';

interface UpdateState {
  /** True once a new app version has been downloaded and is waiting to be applied. */
  ready: boolean;
  /** Applies the waiting update (reloads the page). Only ever called from a user click. */
  apply: (() => void) | null;
  markReady: (apply: () => void) => void;
}

export const useUpdateStore = create<UpdateState>()((set) => ({
  ready: false,
  apply: null,
  markReady(apply) {
    set({ ready: true, apply });
  },
}));
