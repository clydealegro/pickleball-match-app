import type { Session } from '../engine';

export const STORAGE_KEY = 'pickleball.session.v1';
const VERSION = 1;

export interface Persisted {
  session: Session | null;
  undoStack: Session[];
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

function isCourt(x: unknown): boolean {
  return (
    isObject(x) &&
    typeof x.id === 'string' &&
    typeof x.number === 'number' &&
    (x.status === 'empty' || x.status === 'playing') &&
    typeof x.closing === 'boolean'
  );
}

function isPlayer(x: unknown): boolean {
  return (
    isObject(x) &&
    typeof x.id === 'string' &&
    typeof x.name === 'string' &&
    (x.status === 'active' || x.status === 'break' || x.status === 'left') &&
    typeof x.gamesPlayed === 'number'
  );
}

function isSession(x: unknown): x is Session {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    (s.mode === 'fairness' || s.mode === 'queue') &&
    Array.isArray(s.courts) &&
    s.courts.every(isCourt) &&
    Array.isArray(s.players) &&
    s.players.every(isPlayer) &&
    Array.isArray(s.queueOrder) &&
    s.queueOrder.every((id) => typeof id === 'string') &&
    Array.isArray(s.history) &&
    s.history.every(isObject) &&
    typeof s.gameSeq === 'number'
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
