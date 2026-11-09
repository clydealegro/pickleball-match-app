import { create } from 'zustand';
import type { Session } from '../../engine';
import type { Slot } from '../../store/slots';
import { useAuthStore } from '../auth';
import { getSupabase } from '../client';
import { isRemoteError, RemoteError } from '../remote';
import { diffChange, linkRow, localDate, safeTimezone, summarize } from './links';
import { supabaseAttendanceRemote, type AttendanceRemote } from './remote';
import type { AttendanceStatus, ChangeNote, Failure, Summary } from './types';

export const ATTENDANCE_KEY = 'pickleball.attendance.v1';
const VERSION = 1;
const MAX_REASON = 140;

export type AttendanceResult = { ok: true } | { ok: false; message: string };

export interface AttendanceDeps {
  /** The server for the signed-in organizer and their id, or null when there is no backend or nobody is signed in. */
  server(): { remote: AttendanceRemote; userId: string } | null;
  now(): number;
  /** The IANA zone links are written in. */
  timezone(): string;
}

const defaultDeps: AttendanceDeps = {
  server() {
    const client = getSupabase();
    const { status, userId } = useAuthStore.getState();
    return client && status === 'signedIn' && userId ? { remote: supabaseAttendanceRemote(client, userId), userId } : null;
  },
  now: () => Date.now(),
  timezone: () => safeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone),
};

let deps: AttendanceDeps = defaultDeps;
/** Replaces the server, clock and zone. For tests. */
export const setAttendanceDeps = (next: AttendanceDeps) => {
  deps = next;
};
export const resetAttendanceDeps = () => {
  deps = defaultDeps;
};

/** What is kept on the device, and so survives a restart. */
interface Data {
  /** The account this copy belongs to. */
  ownerId: string | null;
  links: Record<string, { code: string }>;
  summaries: Record<string, Summary>;
  lastChange: Record<string, ChangeNote | null>;
  /** Closes that could not be sent yet, at most one per slot. */
  pendingClose: { slotId: string; date: string }[];
}

interface AttendanceState extends Data {
  lastError: Record<string, Failure | null>;
  /** Slots with a write in progress. */
  busy: Record<string, boolean>;
  /** Reads the answers again. Keeps the last good copy when it fails. */
  refresh: (slotId: string) => Promise<AttendanceResult>;
  ensureLink: (slot: Slot) => Promise<AttendanceResult>;
  resetLink: (slotId: string) => Promise<AttendanceResult>;
  cancelWeek: (slotId: string, reason: string) => Promise<AttendanceResult>;
  undoCancel: (slotId: string) => Promise<AttendanceResult>;
  /** Closes the date a session started on. Never throws. */
  closeForSession: (session: Session) => Promise<AttendanceResult>;
  /** Sends a saved slot to its link, when it has one. */
  syncSlot: (slot: Slot) => Promise<AttendanceResult>;
  clear: () => void;
}

const SIGN_IN = 'Sign in to use the attendance link.';
const MESSAGES: Record<Failure, string> = {
  offline: 'No connection. Try again when you are online.',
  auth: 'Your sign-in ended. Sign in again.',
  server: 'Something went wrong. Try again.',
};
const failure = (kind: Failure): AttendanceResult => ({ ok: false, message: MESSAGES[kind] });
const kindOf = (error: unknown): Failure => (isRemoteError(error) ? error.kind : 'server');

// Reading the saved copy. Anything wrong is dropped, never trusted.

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStatus = (x: unknown): x is AttendanceStatus => x === 'in' || x === 'maybe' || x === 'out';
const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const isDate = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const isText = (x: unknown): x is string => typeof x === 'string' && x !== '';
const everyValue = (x: unknown, ok: (v: unknown) => boolean) => isObject(x) && Object.values(x).every(ok);

function isSummary(key: string, x: unknown): x is Summary {
  if (!isObject(x)) return false;
  const { counts, cancelled, waiting } = x;
  return (
    x.slotId === key &&
    isText(x.code) &&
    isDate(x.playDate) &&
    (cancelled === null || (isObject(cancelled) && (cancelled.reason === null || typeof cancelled.reason === 'string'))) &&
    isObject(counts) &&
    isCount(counts.in) &&
    isCount(counts.maybe) &&
    isCount(counts.out) &&
    isCount(counts.late) &&
    isCount(x.friends) &&
    Array.isArray(waiting) &&
    waiting.every(
      (w) => isObject(w) && typeof w.id === 'string' && typeof w.name === 'string' && (w.broughtBy === null || typeof w.broughtBy === 'string'),
    ) &&
    everyValue(x.answers, isStatus) &&
    everyValue(x.names, (v) => typeof v === 'string') &&
    typeof x.fetchedAt === 'number' &&
    Number.isFinite(x.fetchedAt)
  );
}

function isChange(x: unknown): x is ChangeNote {
  return isObject(x) && typeof x.player === 'string' && isStatus(x.from) && isStatus(x.to) && typeof x.at === 'number' && Number.isFinite(x.at);
}

/** The saved copy, or null when there is none or it is not ours. Wrong entries are dropped one by one. */
export function parseAttendanceCache(raw: string | null): Data | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isObject(data) || data.version !== VERSION || !isText(data.userId)) return null;
    const links: Data['links'] = {};
    if (isObject(data.links)) {
      for (const [slotId, link] of Object.entries(data.links)) if (isObject(link) && isText(link.code)) links[slotId] = { code: link.code };
    }
    const summaries: Data['summaries'] = {};
    if (isObject(data.summaries)) {
      for (const [slotId, s] of Object.entries(data.summaries)) if (slotId in links && isSummary(slotId, s)) summaries[slotId] = s;
    }
    const lastChange: Data['lastChange'] = {};
    if (isObject(data.lastChange)) {
      for (const [slotId, note] of Object.entries(data.lastChange)) if (slotId in links && isChange(note)) lastChange[slotId] = note;
    }
    const pendingClose = Array.isArray(data.pendingClose)
      ? data.pendingClose.flatMap((p: unknown) => (isObject(p) && isText(p.slotId) && isDate(p.date) ? [{ slotId: p.slotId, date: p.date }] : []))
      : [];
    return { ownerId: data.userId, links, summaries, lastChange, pendingClose };
  } catch {
    return null;
  }
}

const empty = (): Data => ({ ownerId: null, links: {}, summaries: {}, lastChange: {}, pendingClose: [] });

function readCache(): Data {
  try {
    return parseAttendanceCache(localStorage.getItem(ATTENDANCE_KEY)) ?? empty();
  } catch {
    return empty();
  }
}

function writeCache(data: Data): void {
  try {
    if (data.ownerId === null) {
      localStorage.removeItem(ATTENDANCE_KEY);
      return;
    }
    const { ownerId, links, summaries, lastChange, pendingClose } = data;
    localStorage.setItem(ATTENDANCE_KEY, JSON.stringify({ version: VERSION, userId: ownerId, links, summaries, lastChange, pendingClose }));
  } catch {
    /* the copy is only a convenience; the screen still works from memory */
  }
}

// Bumped when the copy is cleared, so an answer that arrives later is dropped.
let epoch = 0;
// Which request for a slot is the latest, so an older answer never overwrites a newer one.
const latest = new Map<string, number>();
const inFlight = new Map<string, Promise<AttendanceResult>>();

export const useAttendanceStore = create<AttendanceState>()((set, get) => {
  /** Changes what is kept, and saves it. */
  function commit(patch: Partial<AttendanceState>) {
    set(patch);
    const { ownerId, links, summaries, lastChange, pendingClose } = get();
    writeCache({ ownerId, links, summaries, lastChange, pendingClose });
  }

  /** This copy belongs to one account. Another account signing in on the device starts from nothing. */
  function claim(userId: string) {
    const { ownerId } = get();
    if (ownerId === userId) return;
    if (ownerId !== null) get().clear();
    set({ ownerId: userId });
  }

  function dropLink(slotId: string) {
    const { [slotId]: _link, ...links } = get().links;
    const { [slotId]: _summary, ...summaries } = get().summaries;
    const { [slotId]: _change, ...lastChange } = get().lastChange;
    commit({ links, summaries, lastChange });
  }

  function enqueue(slotId: string, date: string) {
    const queue = get().pendingClose;
    const existing = queue.find((p) => p.slotId === slotId);
    if (existing && existing.date >= date) return;
    commit({ pendingClose: [...queue.filter((p) => p.slotId !== slotId), { slotId, date }] });
  }

  /** Forgets queued closes that a close through `date` has made unnecessary. */
  function dequeue(slotId: string, date: string) {
    const queue = get().pendingClose;
    const rest = queue.filter((p) => !(p.slotId === slotId && p.date <= date));
    if (rest.length !== queue.length) commit({ pendingClose: rest });
  }

  async function flushQueue(remote: AttendanceRemote, mine: number) {
    for (const { slotId, date } of get().pendingClose) {
      try {
        await remote.closeThrough(slotId, date);
        if (mine === epoch) dequeue(slotId, date);
      } catch {
        /* stays queued for the next refresh */
      }
    }
  }

  async function load(slotId: string): Promise<AttendanceResult> {
    const server = deps.server();
    if (!server) return { ok: false, message: SIGN_IN };
    claim(server.userId);
    const { remote } = server;
    const mine = epoch;
    const turn = (latest.get(slotId) ?? 0) + 1;
    latest.set(slotId, turn);
    const current = () => mine === epoch && latest.get(slotId) === turn;
    try {
      await flushQueue(remote, mine);
      let code = get().links[slotId]?.code;
      let view = code ? await remote.view(code) : null;
      if (!view) {
        // No code yet, or the saved one stopped working (reset on another device): ask for the link itself.
        const link = await remote.getLink(slotId);
        if (!link) {
          if (current()) {
            dropLink(slotId);
            commit({ lastError: { ...get().lastError, [slotId]: null } });
          }
          return { ok: true };
        }
        code = link.code;
        view = await remote.view(code);
        if (!view) throw new RemoteError('server');
      }
      const waiting = await remote.listWaiting(slotId, view.play_date);
      if (!current()) return { ok: true };
      const now = deps.now();
      const summary = summarize(slotId, code!, view, waiting, now);
      const before = get().summaries[slotId];
      let change = get().lastChange[slotId] ?? null;
      if (before && before.playDate !== summary.playDate) change = null;
      else if (before) change = diffChange(before.answers, summary.answers, summary.names, now) ?? change;
      commit({
        links: { ...get().links, [slotId]: { code: code! } },
        summaries: { ...get().summaries, [slotId]: summary },
        lastChange: { ...get().lastChange, [slotId]: change },
        lastError: { ...get().lastError, [slotId]: null },
      });
      return { ok: true };
    } catch (error) {
      const kind = kindOf(error);
      if (current()) set({ lastError: { ...get().lastError, [slotId]: kind } });
      return failure(kind);
    }
  }

  /** A change the organizer asked for. It changes nothing when it fails, then reads the answers again. */
  async function write(
    slotId: string,
    act: (remote: AttendanceRemote) => Promise<string | void>,
  ): Promise<AttendanceResult> {
    const server = deps.server();
    if (!server) return { ok: false, message: SIGN_IN };
    claim(server.userId);
    set({ busy: { ...get().busy, [slotId]: true } });
    try {
      const refused = await act(server.remote);
      if (refused) return { ok: false, message: refused };
      await load(slotId);
      return { ok: true };
    } catch (error) {
      return failure(kindOf(error));
    } finally {
      set({ busy: { ...get().busy, [slotId]: false } });
    }
  }

  return {
    ...readCache(),
    lastError: {},
    busy: {},

    refresh(slotId) {
      const running = inFlight.get(slotId);
      if (running) return running;
      const started = load(slotId).finally(() => inFlight.delete(slotId));
      inFlight.set(slotId, started);
      return started;
    },

    ensureLink(slot) {
      return write(slot.id, async (remote) => {
        await remote.upsertLink(linkRow(slot, deps.timezone()));
        const link = await remote.getLink(slot.id);
        if (!link) throw new RemoteError('server');
        commit({ links: { ...get().links, [slot.id]: { code: link.code } } });
      });
    },

    resetLink(slotId) {
      return write(slotId, async (remote) => {
        const code = await remote.resetLink(slotId);
        if (code === null) {
          dropLink(slotId);
          return 'That link no longer exists.';
        }
        commit({ links: { ...get().links, [slotId]: { code } } });
      });
    },

    async cancelWeek(slotId, reason) {
      const date = get().summaries[slotId]?.playDate;
      if (!date) return { ok: false, message: 'Could not find the date. Try again.' };
      const clean = reason.trim().slice(0, MAX_REASON).trim();
      return write(slotId, (remote) => remote.cancel(slotId, date, clean || null));
    },

    async undoCancel(slotId) {
      const date = get().summaries[slotId]?.playDate;
      if (!date) return { ok: false, message: 'Could not find the date. Try again.' };
      return write(slotId, (remote) => remote.undoCancel(slotId, date));
    },

    async closeForSession(session) {
      try {
        const slotId = session.slotId;
        if (!slotId) return { ok: true };
        // The calendar date the session started, where the link lives.
        const date = localDate(session.createdAt, deps.timezone());
        const server = deps.server();
        if (!server) {
          // Signed in before but not checkable now: keep it for later. Never signed in: there is no link to close.
          if (get().ownerId !== null) enqueue(slotId, date);
          return { ok: false, message: SIGN_IN };
        }
        claim(server.userId);
        try {
          await server.remote.closeThrough(slotId, date);
          dequeue(slotId, date);
          return { ok: true };
        } catch (error) {
          enqueue(slotId, date);
          return failure(kindOf(error));
        }
      } catch {
        return failure('server');
      }
    },

    async syncSlot(slot) {
      if (!get().links[slot.id]) return { ok: true };
      const server = deps.server();
      if (!server) return { ok: false, message: SIGN_IN };
      try {
        await server.remote.upsertLink(linkRow(slot, deps.timezone()));
        return { ok: true };
      } catch (error) {
        return failure(kindOf(error));
      }
    },

    clear() {
      epoch += 1;
      latest.clear();
      inFlight.clear();
      set({ ...empty(), lastError: {}, busy: {} });
      writeCache(empty());
    },
  };
});
