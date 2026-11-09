import { create } from 'zustand';
import * as engine from '../engine';
import type { Ctx, NewSessionInput, Session } from '../engine';
import { liveCtx } from './liveCtx';
import { loadPersisted, savePersisted } from './persistence';

export const MAX_UNDO = 50;

export type SessionAction = (s: Session, ctx: Ctx) => Session;
export type ApplyResult = { ok: true } | { ok: false; error: string };

/** The most recent action that can be undone, in words, kept in memory only. */
export interface LastAction {
  id: number;
  label: string;
  at: number;
}

interface SessionState {
  session: Session | null;
  undoStack: Session[];
  /** True when the last attempt to save to the browser failed. */
  saveFailed: boolean;
  /** What the last action was, for an Undo that says what it will undo. Null after Undo, a reset or a reload. */
  lastAction: LastAction | null;
  start: (input: NewSessionInput) => ApplyResult;
  /** `label` says what the action did ("Game finished on Court 1"), and is shown beside Undo. */
  apply: (action: SessionAction, label?: string) => ApplyResult;
  undo: () => void;
  reset: () => void;
  purge: () => boolean;
}

/**
 * Engine errors are expected user-facing rejections. Anything else is a bug: log it and
 * report a generic failure (a rethrow in a click handler would be invisible to the user).
 */
function toResult(e: unknown): ApplyResult {
  if (e instanceof engine.EngineError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: 'Something went wrong. Try again, or undo the last action.' };
}

const initial = loadPersisted();
let actionSeq = 0;
let writesBlocked = false;
const CONFLICT = 'This session changed in another window. Reload before making changes.';

export function setSessionWritesBlocked(blocked: boolean): void {
  writesBlocked = blocked;
}

export const useSessionStore = create<SessionState>()((set, get) => {
  const commit = (session: Session | null, undoStack: Session[]) => {
    const saved = savePersisted({ session, undoStack });
    set({ session, undoStack, saveFailed: !saved, lastAction: null });
  };

  return {
    session: initial?.session ?? null,
    undoStack: initial?.undoStack ?? [],
    saveFailed: false,
    lastAction: null,

    start(input) {
      if (writesBlocked) return { ok: false, error: CONFLICT };
      try {
        commit(engine.createSession(input, liveCtx()), []);
        return { ok: true };
      } catch (e) {
        return toResult(e);
      }
    },

    apply(action, label) {
      if (writesBlocked) return { ok: false, error: CONFLICT };
      const { session, undoStack } = get();
      if (!session) return { ok: false, error: 'There is no active session.' };
      try {
        const next = action(session, liveCtx());
        commit(next, [...undoStack, session].slice(-MAX_UNDO));
        if (label) set({ lastAction: { id: ++actionSeq, label, at: Date.now() } });
        return { ok: true };
      } catch (e) {
        return toResult(e);
      }
    },

    undo() {
      if (writesBlocked) return;
      const { undoStack } = get();
      const previous = undoStack[undoStack.length - 1];
      if (!previous) return;
      commit(previous, undoStack.slice(0, -1));
    },

    purge() {
      // Account deletion deliberately clears even a stale tab's retained snapshots.
      const saved = savePersisted({ session: null, undoStack: [] });
      set({ session: null, undoStack: [], lastAction: null, saveFailed: !saved });
      return saved;
    },

    reset() {
      if (writesBlocked) return;
      commit(null, []);
    },
  };
});
