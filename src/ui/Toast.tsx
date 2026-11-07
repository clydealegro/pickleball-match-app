import { useEffect } from 'react';

interface Props {
  text: string;
  /** Changes with every new message, so the timer starts again even when the words repeat. */
  id: number;
  onUndo: () => void;
  onDismiss: () => void;
  seconds?: number;
}

/** A short message under the court with an Undo button. It goes by itself after a few seconds. */
export function Toast({ text, id, onUndo, onDismiss, seconds = 8 }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, seconds * 1000);
    return () => clearTimeout(timer);
  }, [id, seconds, onDismiss]);

  return (
    <div className="toast" role="status">
      <span className="toast-text">{text}</span>
      <button type="button" className="btn btn-small toast-undo" onClick={onUndo}>
        Undo
      </button>
    </div>
  );
}
