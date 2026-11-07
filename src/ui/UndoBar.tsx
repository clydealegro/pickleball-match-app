import { useEffect, useState } from 'react';
import { useSessionStore } from '../store/sessionStore';

/** How long the bar stays after an action. */
const SECONDS = 8;

/**
 * One line under the court that says what the last action did, with the one Undo button. It is the only place Undo
 * lives right after a mistake; the menu keeps a labelled Undo for later.
 */
export function UndoBar() {
  const last = useSessionStore((s) => s.lastAction);
  const undo = useSessionStore((s) => s.undo);
  const [hiddenId, setHiddenId] = useState<number | null>(null);

  useEffect(() => {
    if (!last) return;
    const left = SECONDS * 1000 - (Date.now() - last.at);
    if (left <= 0) {
      setHiddenId(last.id);
      return;
    }
    const timer = setTimeout(() => setHiddenId(last.id), left);
    return () => clearTimeout(timer);
  }, [last]);

  if (!last || hiddenId === last.id || Date.now() - last.at >= SECONDS * 1000) return null;
  return (
    <div className="undo-bar" role="status">
      <span className="undo-text">{last.label}</span>
      <button type="button" className="btn btn-small undo-btn" onClick={undo}>
        Undo
      </button>
    </div>
  );
}
