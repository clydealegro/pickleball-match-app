import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttendanceStatus, AttendanceViewData } from '../sync/attendance/types';
import { readCached, writeCached } from './cache';
import { forgetPick, readPick, savePick } from './identity';
import { isMemberError, type MemberReason, type MemberRemote } from './remote';

export type MemberPhase = 'loading' | 'ready' | 'notfound' | 'failed' | 'unavailable';

/** What a sheet gets back: the words to show, and for a failure its reason. */
export type ActionResult = { ok: true; message: string } | { ok: false; reason: MemberReason; message: string };

export interface MemberPageState {
  phase: MemberPhase;
  view: AttendanceViewData | null;
  /** Set while the view on screen is older than the server: when it was fetched, and whether the failure was offline. */
  stale: { at: number; offline: boolean } | null;
  /** Why the last request failed, until one works. */
  error: MemberReason | null;
  /** The player this member picked, or null. */
  me: string | null;
  busy: boolean;
  /** The words for the last answer or name that went wrong or right. */
  message: string | null;
}

export interface MemberPage extends MemberPageState {
  pick(playerId: string): void;
  forget(): void;
  answer(status: AttendanceStatus, late?: boolean): Promise<void>;
  addFriend(name: string): Promise<ActionResult>;
  askToJoin(name: string): Promise<ActionResult>;
  retry(): void;
}

const POLL_MS = 30_000;
const OFFLINE = 'No connection. Try again when you are online.';
const GENERIC = 'Something went wrong. Try again.';
const FRIEND_ADDED = 'Added for the organizer to confirm.';
const ASKED = 'Thanks. The organizer will see your name.';
const BAD_NAME = 'Use 1 to 40 characters.';
const TOO_MANY = 'The list of new names is full. Ask your organizer.';
const PICK_FIRST = 'Pick your name first.';

const reasonOf = (error: unknown): MemberReason => (isMemberError(error) ? error.reason : 'server');

/** The words for a failed answer or name. Null for a reason the page shows by itself (a cancelled week, a dead link). */
function wordsFor(reason: MemberReason): string | null {
  if (reason === 'offline') return OFFLINE;
  if (reason === 'too_many') return TOO_MANY;
  if (reason === 'bad_name') return BAD_NAME;
  if (reason === 'cancelled' || reason === 'unknown_link') return null;
  return GENERIC;
}

/** The view with one player's answer replaced. */
function withAnswer(view: AttendanceViewData, playerId: string, status: AttendanceStatus, late: boolean): AttendanceViewData {
  return { ...view, answers: [...view.answers.filter((a) => a.player_id !== playerId), { player_id: playerId, status, late }] };
}

function initial(code: string, remote: MemberRemote | null): MemberPageState {
  const base = { error: null, me: readPick(code), busy: false, message: null };
  if (!remote) return { ...base, phase: 'unavailable', view: null, stale: null };
  const cached = readCached(code);
  if (cached) return { ...base, phase: 'ready', view: cached.view, stale: { at: cached.at, offline: false } };
  return { ...base, phase: 'loading', view: null, stale: null };
}

/**
 * Everything the member page does. `code` does not change over the life of the page. `remote` is null in a build
 * with no backend. Nothing is guessed: a view only changes when the server (or an accepted answer) says so.
 */
export function useMemberPage(code: string, remote: MemberRemote | null): MemberPage {
  const [state, setState] = useState<MemberPageState>(() => initial(code, remote));
  const ref = useRef(state);
  // Each request takes a number. Only the newest may change the page, so a slow earlier reply is ignored.
  const latest = useRef(0);
  // When the view on screen was fetched.
  const fetchedAt = useRef<number>(readCached(code)?.at ?? 0);

  const update = useCallback((patch: Partial<MemberPageState>) => {
    ref.current = { ...ref.current, ...patch };
    setState(ref.current);
  }, []);

  const refresh = useCallback(async () => {
    if (!remote) return;
    const mine = ++latest.current;
    try {
      const data = await remote.view(code);
      if (mine !== latest.current) return;
      if (!data) {
        update({ phase: 'notfound', view: null, stale: null, error: null });
        return;
      }
      fetchedAt.current = Date.now();
      writeCached(code, data, fetchedAt.current);
      // A remembered player who is no longer on the roster is dropped.
      const me = ref.current.me;
      const gone = me !== null && !data.players.some((p) => p.id === me);
      if (gone) forgetPick(code);
      update({ phase: 'ready', view: data, stale: null, error: null, me: gone ? null : me });
    } catch (error) {
      if (mine !== latest.current) return;
      const reason = reasonOf(error);
      if (reason === 'unknown_link') update({ phase: 'notfound', view: null, stale: null, error: null });
      else if (ref.current.view) update({ phase: 'ready', stale: { at: fetchedAt.current, offline: reason === 'offline' }, error: reason });
      else update({ phase: 'failed', error: reason });
    }
  }, [code, remote, update]);

  useEffect(() => {
    if (!remote) return;
    void refresh();
    const visible = () => document.visibilityState === 'visible' && ref.current.phase !== 'notfound';
    const timer = setInterval(() => {
      if (visible()) void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (visible()) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      // Whatever is still on its way no longer counts.
      latest.current += 1;
    };
  }, [remote, refresh]);

  const retry = useCallback(() => {
    if (!remote) return;
    if (!ref.current.view) update({ phase: 'loading', error: null });
    void refresh();
  }, [remote, refresh, update]);

  const pick = useCallback(
    (playerId: string) => {
      if (!ref.current.view?.players.some((p) => p.id === playerId)) return;
      savePick(code, playerId);
      update({ me: playerId, message: null });
    },
    [code, update],
  );

  const forget = useCallback(() => {
    forgetPick(code);
    update({ me: null, message: null });
  }, [code, update]);

  /** What every failed answer or name does to the page. Returns the words to show, or null. */
  const settleFailure = useCallback(
    async (reason: MemberReason): Promise<string | null> => {
      if (reason === 'unknown_link') update({ phase: 'notfound', view: null, stale: null, error: null });
      else if (reason === 'cancelled') await refresh();
      else if (reason === 'unknown_player') {
        forgetPick(code);
        update({ me: null });
        await refresh();
      }
      return wordsFor(reason);
    },
    [code, refresh, update],
  );

  const answer = useCallback(
    async (status: AttendanceStatus, late = false) => {
      const { me, view, busy } = ref.current;
      if (!remote || !me || !view || view.cancelled || busy) return;
      const isLate = status === 'in' && late;
      update({ busy: true, message: null });
      try {
        await remote.answer(code, me, status, isLate);
      } catch (error) {
        const message = await settleFailure(reasonOf(error));
        update({ busy: false, message });
        return;
      }
      // Show the answer now, then check with the server.
      if (ref.current.view) update({ view: withAnswer(ref.current.view, me, status, isLate) });
      await refresh();
      update({ busy: false });
    },
    [code, remote, refresh, settleFailure, update],
  );

  const submitName = useCallback(
    async (name: string, broughtBy: string | null, done: string): Promise<ActionResult> => {
      const clean = name.trim();
      if (clean.length < 1 || clean.length > 40) {
        update({ message: BAD_NAME });
        return { ok: false, reason: 'bad_name', message: BAD_NAME };
      }
      if (!remote || ref.current.busy) return { ok: false, reason: 'server', message: GENERIC };
      update({ busy: true, message: null });
      try {
        await remote.addGuest(code, clean, broughtBy);
      } catch (error) {
        const reason = reasonOf(error);
        const message = await settleFailure(reason);
        update({ busy: false, message });
        return { ok: false, reason, message: message ?? '' };
      }
      update({ message: done });
      await refresh();
      update({ busy: false });
      return { ok: true, message: done };
    },
    [code, remote, refresh, settleFailure, update],
  );

  const addFriend = useCallback(
    (name: string): Promise<ActionResult> => {
      const me = ref.current.me;
      if (!me) return Promise.resolve({ ok: false, reason: 'unknown_player', message: PICK_FIRST });
      return submitName(name, me, FRIEND_ADDED);
    },
    [submitName],
  );

  const askToJoin = useCallback((name: string) => submitName(name, null, ASKED), [submitName]);

  return { ...state, pick, forget, answer, addFriend, askToJoin, retry };
}
