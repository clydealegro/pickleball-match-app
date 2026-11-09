import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveBoard } from '../sync/live/board';
import type { MemberRemote } from './remote';

/** `checking` until the first answer. `idle` when no board is up. `paused` when the organizer paused sharing. */
export type LivePhase = 'checking' | 'idle' | 'live' | 'paused';

export interface LiveBoardState {
  phase: LivePhase;
  board: LiveBoard | null;
  showPhotos: boolean;
  version: number | null;
  /** How old the board was on the server when this page last asked, in seconds, and when that was here, in ms. */
  ageS: number;
  fetchedAt: number;
  /** The last request failed while a board was up, so what is shown may be old. */
  failed: boolean;
  /** Small faces by saved player id, as data URIs. */
  faces: Record<string, string>;
}

/** While a board is up, the page asks this often. Only while the page is in front. */
export const LIVE_POLL_MS = 8_000;
/** With no board up, it checks this often, in case one starts. */
export const IDLE_POLL_MS = 30_000;
/** How often it asks again for faces it already has all of, in case a photo changed. */
const FACE_RECHECK_MS = 60_000;
export const FACES_KEY = 'pikl.live.faces.v1';
const MAX_FACES = 60;

type FaceCache = Record<string, { seq: number; data: string }>;

function readFaces(): FaceCache {
  try {
    const raw = JSON.parse(localStorage.getItem(FACES_KEY) ?? '{}') as unknown;
    if (typeof raw !== 'object' || raw === null) return {};
    const out: FaceCache = {};
    for (const [id, v] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_FACES)) {
      const f = v as { seq?: unknown; data?: unknown };
      if (typeof f?.seq === 'number' && typeof f.data === 'string' && f.data.startsWith('data:image/jpeg;base64,')) out[id] = { seq: f.seq, data: f.data };
    }
    return out;
  } catch {
    return {};
  }
}

function writeFaces(cache: FaceCache) {
  try {
    const entries = Object.entries(cache).slice(-MAX_FACES);
    localStorage.setItem(FACES_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Not kept: the faces are fetched again next time.
  }
}

/**
 * The live board for a link code. Asks right away, then every 8 seconds while a board is up and every 30 while not,
 * only while the page is in front. A board that has not changed answers with a few bytes. A failure keeps the last
 * board and marks it, so the page can say it may be old. A remote that has no live board is always idle.
 */
export function useLiveBoard(code: string, remote: MemberRemote | null): LiveBoardState {
  const supported = !!remote?.live;
  const [state, setState] = useState<LiveBoardState>(() => ({
    phase: supported ? 'checking' : 'idle',
    board: null,
    showPhotos: true,
    version: null,
    ageS: 0,
    fetchedAt: 0,
    failed: false,
    faces: {},
  }));
  const ref = useRef(state);
  const latest = useRef(0);
  const cache = useRef<FaceCache>(readFaces());
  const faceCheckedAt = useRef(0);

  const update = useCallback((patch: Partial<LiveBoardState>) => {
    ref.current = { ...ref.current, ...patch };
    setState(ref.current);
  }, []);

  const loadFaces = useCallback(
    async (board: LiveBoard, mine: number) => {
      if (!remote?.liveFaces) return;
      const wanted = [...new Set(Object.values(board.players).flatMap((p) => (p.r ? [p.r] : [])))];
      const missing = wanted.some((id) => !cache.current[id]);
      if (!missing && Date.now() - faceCheckedAt.current < FACE_RECHECK_MS) return;
      faceCheckedAt.current = Date.now();
      try {
        const have = wanted.flatMap((id) => (cache.current[id] ? [`${id}:${cache.current[id].seq}`] : []));
        const got = await remote.liveFaces(code, have);
        if (mine !== latest.current || got.length === 0) return;
        for (const f of got) cache.current[f.id] = { seq: f.seq, data: f.data };
        writeFaces(cache.current);
      } catch {
        // No faces this time. The page shows initials and tries again on the next recheck.
        return;
      }
      update({ faces: Object.fromEntries(Object.entries(cache.current).map(([id, f]) => [id, f.data])) });
    },
    [code, remote, update],
  );

  const refresh = useCallback(async () => {
    if (!remote?.live) return;
    const mine = ++latest.current;
    const cur = ref.current;
    try {
      const reply = await remote.live(code, cur.phase === 'live' && cur.board ? cur.version : null);
      if (mine !== latest.current) return;
      const now = Date.now();
      if (reply.state === 'idle') {
        update({ phase: 'idle', board: null, version: null, failed: false });
      } else if (reply.state === 'paused') {
        update({ phase: 'paused', board: null, version: null, ageS: reply.ageS, fetchedAt: now, failed: false });
      } else if (reply.unchanged) {
        update({ phase: 'live', version: reply.version, ageS: reply.ageS, fetchedAt: now, failed: false });
      } else {
        const faces = reply.showPhotos ? Object.fromEntries(Object.entries(cache.current).map(([id, f]) => [id, f.data])) : {};
        update({ phase: 'live', board: reply.board, showPhotos: reply.showPhotos, version: reply.version, ageS: reply.ageS, fetchedAt: now, failed: false, faces });
        if (reply.showPhotos) void loadFaces(reply.board, mine);
      }
    } catch {
      if (mine !== latest.current) return;
      // A board that was up stays on screen, marked as maybe old. With none up, a failure is the same as no board.
      if (ref.current.phase === 'live' || ref.current.phase === 'paused') update({ failed: true });
      else update({ phase: 'idle', failed: false });
    }
  }, [code, remote, update, loadFaces]);

  useEffect(() => {
    if (!remote?.live) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const visible = () => document.visibilityState === 'visible';
    const tick = async () => {
      if (visible()) await refresh();
      if (stopped) return;
      const up = ref.current.phase === 'live' || ref.current.phase === 'paused';
      timer = setTimeout(() => void tick(), up ? LIVE_POLL_MS : IDLE_POLL_MS);
    };
    void tick();
    const onVisible = () => {
      if (visible()) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [remote, refresh]);

  return supported ? state : { ...state, phase: 'idle' };
}
