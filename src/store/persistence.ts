import type { Session } from '../engine';

export const STORAGE_KEY = 'pickleball.session.v1';
const VERSION = 1;

export interface Persisted {
  session: Session | null;
  undoStack: Session[];
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isNum = (x: unknown): x is number => typeof x === 'number';
const isTeam = (x: unknown): boolean =>
  Array.isArray(x) && x.length === 2 && x.every((id) => typeof id === 'string');

function isGame(x: unknown): boolean {
  return isObject(x) && isTeam(x.team1) && isTeam(x.team2) && isNum(x.startedAt);
}

function isLineup(x: unknown): boolean {
  return isObject(x) && isTeam(x.team1) && isTeam(x.team2);
}

function isCourt(x: unknown): boolean {
  return (
    isObject(x) &&
    typeof x.id === 'string' &&
    isNum(x.number) &&
    (x.status === 'empty' || x.status === 'ready' || x.status === 'playing') &&
    typeof x.closing === 'boolean' &&
    (x.status !== 'playing' || isGame(x.game)) &&
    (x.status !== 'ready' || isLineup(x.lineup))
  );
}

function isPlayer(x: unknown): boolean {
  return (
    isObject(x) &&
    typeof x.id === 'string' &&
    typeof x.name === 'string' &&
    (x.status === 'active' || x.status === 'break' || x.status === 'left') &&
    isNum(x.gamesPlayed) &&
    isNum(x.lastFinishedSeq) &&
    isNum(x.tieKey) &&
    isObject(x.partnerCounts) &&
    isObject(x.opponentCounts)
  );
}

function isFinishedGame(x: unknown): boolean {
  return (
    isObject(x) &&
    isTeam(x.team1) &&
    isTeam(x.team2) &&
    isNum(x.courtNumber) &&
    isNum(x.startedAt) &&
    isNum(x.finishedAt) &&
    (x.winner === undefined || x.winner === 1 || x.winner === 2) &&
    (x.score === undefined || (Array.isArray(x.score) && x.score.length === 2 && x.score.every(isNum)))
  );
}

function isSession(x: unknown): x is Session {
  if (!isObject(x)) return false;
  return (
    typeof x.id === 'string' &&
    typeof x.name === 'string' &&
    (x.mode === 'fairness' || x.mode === 'queue') &&
    Array.isArray(x.courts) &&
    x.courts.every(isCourt) &&
    Array.isArray(x.players) &&
    x.players.every(isPlayer) &&
    Array.isArray(x.queueOrder) &&
    x.queueOrder.every((id) => typeof id === 'string') &&
    Array.isArray(x.history) &&
    x.history.every(isFinishedGame) &&
    isNum(x.gameSeq) &&
    isNum(x.createdAt) &&
    (x.weekday === undefined || (typeof x.weekday === 'number' && Number.isInteger(x.weekday) && x.weekday >= 0 && x.weekday <= 6)) &&
    (x.slotId === undefined || typeof x.slotId === 'string') &&
    (x.venue === undefined || typeof x.venue === 'string') &&
    (x.plannedEndAt === undefined || isNum(x.plannedEndAt)) &&
    (x.pinned === undefined || (Array.isArray(x.pinned) && x.pinned.every((id) => typeof id === 'string')))
  );
}

export function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data.version !== VERSION) return null;
    if (data.session !== null && !isSession(data.session)) return null;
    if (!Array.isArray(data.undoStack) || !data.undoStack.every(isSession)) return null;
    return { session: data.session as Session | null, undoStack: data.undoStack as Session[] };
  } catch {
    return null;
  }
}

function write(p: Persisted): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, ...p }));
    return true;
  } catch {
    return false;
  }
}

/** Returns false if storage failed. Retries with a short undo stack if the quota is hit. */
export function savePersisted(p: Persisted): boolean {
  return write(p) || write({ session: p.session, undoStack: p.undoStack.slice(-5) });
}

export function clearPersisted(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing useful to do */
  }
}
