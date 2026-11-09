import type { LiveBoard, LiveCourt, LivePlayer } from '../sync/live/board';

/** What the server answers when a visitor asks for the live board. */
export type LiveViewReply =
  | { state: 'idle' }
  | { state: 'paused'; version: number; ageS: number }
  | { state: 'live'; version: number; ageS: number; unchanged: true }
  | { state: 'live'; version: number; ageS: number; unchanged?: false; showPhotos: boolean; board: LiveBoard };

/** A face the server sends: the saved player's id, the photo sequence it was made from, and a small JPEG data URI. */
export interface LiveFaceReply {
  id: string;
  seq: number;
  data: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);
const MAX_PLAYERS = 60;
const MAX_COURTS = 24;

function asPlayer(raw: unknown): LivePlayer | null {
  if (!isObject(raw)) return null;
  const f = str(raw.f, 40);
  const l = raw.l === null ? null : str(raw.l, 2);
  const r = raw.r === null ? null : str(raw.r, 64);
  return f === null || l === undefined || r === undefined || (raw.l !== null && l === null) || (raw.r !== null && r === null) ? null : { f, l, r };
}

function asCourt(raw: unknown): LiveCourt | null {
  if (!isObject(raw) || !isNum(raw.n)) return null;
  const status = raw.status;
  if (status !== 'empty' && status !== 'ready' && status !== 'playing') return null;
  const court: LiveCourt = { n: raw.n, status, closing: raw.closing === true };
  if (isNum(raw.startedAt)) court.startedAt = raw.startedAt;
  const t = raw.teams;
  if (Array.isArray(t) && t.length === 2 && t.every((team) => Array.isArray(team) && team.length === 2 && team.every((id) => typeof id === 'string'))) {
    court.teams = [[t[0][0], t[0][1]], [t[1][0], t[1][1]]];
  }
  return court;
}

const ids = (v: unknown): string[] | null => (Array.isArray(v) && v.length <= MAX_PLAYERS && v.every((id) => typeof id === 'string') ? (v as string[]) : null);

/** A board rebuilt from only the fields the page reads, or null when any of them is wrong. Nothing from the server is trusted as is. */
export function asBoard(raw: unknown): LiveBoard | null {
  if (!isObject(raw)) return null;
  const title = str(raw.title, 80);
  const waiting = ids(raw.waiting);
  const onBreak = ids(raw.onBreak);
  if (title === null || waiting === null || onBreak === null) return null;
  if (!Array.isArray(raw.courts) || raw.courts.length > MAX_COURTS || !isObject(raw.players)) return null;
  const courts = raw.courts.map(asCourt);
  if (courts.some((c) => c === null)) return null;
  const players: Record<string, LivePlayer> = {};
  for (const [id, p] of Object.entries(raw.players).slice(0, MAX_PLAYERS)) {
    const player = asPlayer(p);
    if (!player) return null;
    players[id] = player;
  }
  const board: LiveBoard = { title, courts: courts as LiveCourt[], players, waiting, onBreak };
  const venue = str(raw.venue, 60);
  if (venue) board.venue = venue;
  if (isNum(raw.startMin)) board.startMin = raw.startMin;
  if (isNum(raw.endMin)) board.endMin = raw.endMin;
  if (isNum(raw.avgGameMs)) board.avgGameMs = raw.avgGameMs;
  if (isObject(raw.next) && isNum(raw.next.court)) {
    const nextIds = ids(raw.next.ids);
    if (nextIds) board.next = { court: raw.next.court, ids: nextIds };
  }
  return board;
}

/** The reply, checked. Null when it is not something the page understands. */
export function asLiveReply(raw: unknown): LiveViewReply | null {
  if (!isObject(raw)) return null;
  if (raw.state === 'idle') return { state: 'idle' };
  const version = raw.version;
  const ageS = raw.age_s;
  if (!isNum(version) || !isNum(ageS)) return null;
  if (raw.state === 'paused') return { state: 'paused', version, ageS };
  if (raw.state !== 'live') return null;
  if (raw.unchanged === true) return { state: 'live', version, ageS, unchanged: true };
  const board = asBoard(raw.board);
  return board ? { state: 'live', version, ageS, showPhotos: raw.show_photos !== false, board } : null;
}

const FACE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

/** The faces, checked one by one. A bad one is dropped, not fatal. */
export function asFaces(raw: unknown): LiveFaceReply[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((f) =>
    isObject(f) && typeof f.id === 'string' && isNum(f.seq) && typeof f.data === 'string' && f.data.length <= 16384 && FACE.test(f.data)
      ? [{ id: f.id, seq: f.seq, data: f.data }]
      : [],
  );
}
