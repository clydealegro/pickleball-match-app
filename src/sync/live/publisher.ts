import type { Session } from '../../engine/types';
import { getRosterPhoto, type PhotoData } from '../../store/rosterDb';
import { useRosterStore } from '../../store/rosterStore';
import { useSessionStore } from '../../store/sessionStore';
import { effectiveSlot, useSlotsStore } from '../../store/slots';
import { useAttendanceStore } from '../attendance/store';
import { titleFor } from '../attendance/links';
import { useAuthStore } from '../auth';
import { getSupabase } from '../client';
import { isRemoteError } from '../remote';
import { buildBoard } from './board';
import { supabaseLiveRemote, type LiveFace, type LiveRemote } from './remote';
import { useLiveStore } from './store';
import { thumbFromPhoto } from './thumb';

/** A change reaches the board this long after the last one, so a burst of taps sends once. */
const CHANGE_DELAY_MS = 600;
/** How often the board says it is still being kept up. A visitor treats two minutes of silence as a lost signal. */
const HEARTBEAT_MS = 30_000;

export interface LiveDeps {
  /** The server for the signed-in organizer, or null when there is no backend or nobody is signed in. */
  server(): LiveRemote | null;
  now(): number;
  /** A saved player's photo, from this device. */
  photoOf(rosterId: string): Promise<PhotoData | undefined>;
  /** Makes the small face for a photo, or null. */
  thumb(photo: PhotoData): Promise<string | null>;
}

const defaultDeps: LiveDeps = {
  server() {
    const client = getSupabase();
    const { status, userId } = useAuthStore.getState();
    return client && status === 'signedIn' && userId ? supabaseLiveRemote(client, userId) : null;
  },
  now: () => Date.now(),
  photoOf: (id) => getRosterPhoto(id),
  thumb: (photo) => thumbFromPhoto(photo),
};

/** A session that publishes: running, started from a saved day, and not over. */
const publishable = (s: Session | null): s is Session & { slotId: string } => !!s && !s.endedAt && !!s.slotId;

interface Running {
  slotId: string;
  sessionId: string;
  version: number;
  /** The last board sent, to skip a send that would change nothing. */
  lastJson: string;
  lastPaused: boolean;
  lastShowPhotos: boolean;
  /** The faces on the server, by saved player id, with the photo sequence they were made from. */
  faces: Map<string, number>;
  /** True when the last send failed, so the next tick sends in full instead of just saying hello. */
  dirty: boolean;
}

/**
 * Keeps the public live board in step with the running session. When a session that came from a saved day is running
 * and the organizer is signed in, it publishes a trimmed copy of it, sends small faces for the players in it, says
 * "still here" every 30 seconds, and takes it all down when the session ends. It never throws. A send that fails
 * leaves the board as it was and is tried again on the next change or tick. Returns a function that stops it.
 */
export function startLivePublisher(deps: LiveDeps = defaultDeps, changeDelayMs = CHANGE_DELAY_MS, heartbeatMs = HEARTBEAT_MS): () => void {
  let running: Running | null = null;
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  // Sends run one after another, so two changes never write at the same time.
  let chain: Promise<void> = Promise.resolve();
  const queue = (job: () => Promise<void>) => {
    chain = chain.then(job, job);
  };
  const live = () => useLiveStore.getState();

  function facts(session: Session & { slotId: string }) {
    const { slots, tonight } = useSlotsStore.getState();
    const slot = slots.find((s) => s.id === session.slotId);
    const e = slot ? effectiveSlot(slot, tonight) : undefined;
    return {
      title: slot ? titleFor(slot) : session.name,
      venue: session.venue ?? e?.venue,
      startMin: e?.startMin,
      endMin: e?.endMin,
    };
  }

  async function sendFaces(remote: LiveRemote, run: Running, ids: string[]) {
    const players = useRosterStore.getState().players;
    const made: LiveFace[] = [];
    for (const id of ids) {
      const saved = players.find((p) => p.id === id);
      if (!saved || saved.photoVersion <= 0) continue;
      if (run.faces.get(id) === saved.photoSeq) continue;
      const photo = await deps.photoOf(id);
      const data = photo ? await deps.thumb(photo) : null;
      if (data) made.push({ rosterId: id, seq: saved.photoSeq, data });
    }
    if (made.length === 0) return;
    await remote.putFaces(run.slotId, made);
    for (const f of made) run.faces.set(f.rosterId, f.seq);
  }

  /** `force` sends everything. `tick` says it is still here when nothing changed. `change` sends only if something did. */
  async function push(mode: 'force' | 'tick' | 'change') {
    const session = useSessionStore.getState().session;
    const remote = deps.server();
    if (!running || !remote || !publishable(session) || session.slotId !== running.slotId) return;
    const run = running;
    const { paused, showPhotos } = live();
    const board = buildBoard(session, facts(session));
    const json = JSON.stringify(board);
    const unchanged = json === run.lastJson && paused === run.lastPaused && showPhotos === run.lastShowPhotos;
    try {
      if (unchanged && mode !== 'force' && !run.dirty) {
        // Nothing to send. A change that changed nothing stays quiet, and a tick says it is still here.
        if (mode === 'change') return;
        await remote.heartbeat(run.slotId, run.sessionId);
      } else {
        run.version = Math.max(run.version + 1, deps.now());
        await remote.publish({ slotId: run.slotId, sessionId: run.sessionId, board, version: run.version, paused, showPhotos });
        run.lastJson = json;
        run.lastPaused = paused;
        run.lastShowPhotos = showPhotos;
        if (showPhotos) {
          await sendFaces(remote, run, Object.values(board.players).flatMap((p) => (p.r ? [p.r] : [])));
        } else if (run.faces.size > 0) {
          await remote.removeFaces(run.slotId);
          run.faces.clear();
        }
      }
      run.dirty = false;
      live().set({ status: paused ? 'paused' : 'on', lastPublishedAt: deps.now() });
    } catch (error) {
      run.dirty = true;
      // Offline is expected at a venue with weak signal. The board stays as it was, and the next tick sends it again.
      live().set({ status: 'error' });
      if (!isRemoteError(error)) console.error('The live board could not be sent.', error);
    }
  }

  const fresh = (session: Session & { slotId: string }): Running => ({
    slotId: session.slotId,
    sessionId: session.id,
    version: 0,
    lastJson: '',
    lastPaused: false,
    lastShowPhotos: true,
    faces: new Map(),
    dirty: true,
  });

  async function begin(run: Running) {
    const slot = useSlotsStore.getState().slots.find((s) => s.id === run.slotId);
    if (!deps.server() || !slot) return;
    // The board hangs off the slot's attendance link, so the link has to exist first.
    const made = await useAttendanceStore.getState().ensureLink(slot);
    const code = useAttendanceStore.getState().links[run.slotId]?.code ?? null;
    // The session may have ended or changed while the link was being made.
    if (running !== run) return;
    if (!made.ok || !code) {
      live().set({ status: 'error' });
      return;
    }
    live().set({ slotId: run.slotId, code });
    await push('force');
  }

  async function end(run: Running) {
    const remote = deps.server();
    if (!remote) return;
    try {
      await remote.stop(run.slotId);
    } catch {
      // The board goes quiet by itself: a visitor treats one nobody has touched for 12 hours as over.
    }
  }

  /** Looks at the session, the account and the choices, and brings the board in line with them. */
  function sync() {
    const session = useSessionStore.getState().session;
    const signedIn = useAuthStore.getState().status === 'signedIn';
    const wanted = publishable(session) && signedIn ? session : null;
    if (running && (!wanted || wanted.id !== running.sessionId)) {
      const old = running;
      running = null;
      clearTimeout(changeTimer);
      live().set({ status: 'off', slotId: null, code: null, paused: false, lastPublishedAt: null });
      queue(() => end(old));
    }
    if (wanted && !running) {
      const run = fresh(wanted);
      running = run;
      queue(() => begin(run));
    }
  }

  function change() {
    sync();
    if (!running) return;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => queue(() => push('change')), changeDelayMs);
  }

  const unwatchSession = useSessionStore.subscribe((s, prev) => {
    if (s.session !== prev.session) change();
  });
  const unwatchAuth = useAuthStore.subscribe((s, prev) => {
    if (s.status !== prev.status) change();
  });
  const unwatchLive = useLiveStore.subscribe((s, prev) => {
    if (s.paused !== prev.paused || s.showPhotos !== prev.showPhotos) {
      clearTimeout(changeTimer);
      queue(() => push('force'));
    }
  });
  heartbeat = setInterval(() => {
    if (running) queue(() => push('tick'));
  }, heartbeatMs);
  sync();

  return () => {
    unwatchSession();
    unwatchAuth();
    unwatchLive();
    clearTimeout(changeTimer);
    clearInterval(heartbeat);
    running = null;
  };
}
