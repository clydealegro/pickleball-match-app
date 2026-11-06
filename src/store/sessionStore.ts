import { create } from 'zustand';
import * as engine from '../engine';
import type { Ctx, NewSessionInput, Session } from '../engine';
import { liveCtx } from './liveCtx';
import { loadPersisted, savePersisted } from './persistence';

export const MAX_UNDO = 50;

export type SessionAction = (s: Session, ctx: Ctx) => Session;
export type ApplyResult = { ok: true } | { ok: false; error: string };

interface SessionState {
  session: Session | null;
  undoStack: Session[];
  /** True when the last attempt to save to the browser failed. */
  saveFailed: boolean;
  start: (input: NewSessionInput) => ApplyResult;
  apply: (action: SessionAction) => ApplyResult;
  undo: () => void;
  reset: () => void;
}

/** Engine errors are expected user-facing rejections; anything else is a bug and rethrown. */
function toResult(e: unknown): ApplyResult {
  if (e instanceof engine.EngineError) return { ok: false, error: e.message };
  throw e;
}

const initial = loadPersisted();

export const useSessionStore = create<SessionState>()((set, get) => {
  const commit = (session: Session | null, undoStack: Session[]) => {
    const saved = savePersisted({ session, undoStack });
    set({ session, undoStack, saveFailed: !saved });
  };

  return {
    session: initial?.session ?? null,
    undoStack: initial?.undoStack ?? [],
    saveFailed: false,

    start(input) {
      try {
        commit(engine.createSession(input, liveCtx()), []);
        return { ok: true };
      } catch (e) {
        return toResult(e);
      }
    },

    apply(action) {
      const { session, undoStack } = get();
      if (!session) return { ok: false, error: 'There is no active session.' };
      try {
        const next = action(session, liveCtx());
        commit(next, [...undoStack, session].slice(-MAX_UNDO));
        return { ok: true };
      } catch (e) {
        return toResult(e);
      }
    },

    undo() {
      const { undoStack } = get();
      const previous = undoStack[undoStack.length - 1];
      if (!previous) return;
      commit(previous, undoStack.slice(0, -1));
    },

    reset() {
      commit(null, []);
    },
  };
});
