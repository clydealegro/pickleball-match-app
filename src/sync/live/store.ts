import { create } from 'zustand';

export const LIVE_PREFS_KEY = 'pickleball.live.v1';

/** What the organizer sees of the live board: not running, up, paused by them, or failing to reach the server. */
export type LiveStatus = 'off' | 'on' | 'paused' | 'error';

interface Prefs {
  /** Whether faces go on the board. On unless the organizer turns it off. */
  showPhotos: boolean;
  /** The organizer has read the one-time notice that anyone with the link sees names and photos. */
  noticeSeen: boolean;
}

interface LiveState extends Prefs {
  status: LiveStatus;
  /** The slot being published, and the code of its link, while the board is up. */
  slotId: string | null;
  code: string | null;
  /** The organizer paused sharing for the session that is running. Reset when it ends. */
  paused: boolean;
  lastPublishedAt: number | null;
  setPaused: (paused: boolean) => void;
  setShowPhotos: (show: boolean) => void;
  dismissNotice: () => void;
  /** Used by the publisher. */
  set: (patch: Partial<Pick<LiveState, 'status' | 'slotId' | 'code' | 'lastPublishedAt' | 'paused'>>) => void;
}

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(LIVE_PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    return { showPhotos: raw?.showPhotos !== false, noticeSeen: raw?.noticeSeen === true };
  } catch {
    return { showPhotos: true, noticeSeen: false };
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(LIVE_PREFS_KEY, JSON.stringify(p));
  } catch {
    // Not saved: the choice still holds until the app closes.
  }
}

export const useLiveStore = create<LiveState>()((set, get) => ({
  ...loadPrefs(),
  status: 'off',
  slotId: null,
  code: null,
  paused: false,
  lastPublishedAt: null,
  setPaused: (paused) => set({ paused }),
  setShowPhotos(showPhotos) {
    set({ showPhotos });
    savePrefs({ showPhotos, noticeSeen: get().noticeSeen });
  },
  dismissNotice() {
    set({ noticeSeen: true });
    savePrefs({ showPhotos: get().showPhotos, noticeSeen: true });
  },
  set: (patch) => set(patch),
}));
