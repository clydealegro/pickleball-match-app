import { useState } from 'react';
import { Sheet } from './Sheet';

const MAX_REASON = 140;
/** The count shows from here, so it does not nag while there is plenty of room. */
const COUNT_FROM = 120;

interface ResetProps {
  busy: boolean;
  /** Why the last try failed, if it did. */
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** Asks before a new link replaces the old one. */
export function ResetSheet({ busy, error, onConfirm, onClose }: ResetProps) {
  return (
    <Sheet title="Reset the link?" onClose={onClose}>
      <p>Members who have the old link will need the new one. Answers are kept.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}>
        Reset link
      </button>
      <button type="button" className="btn" disabled={busy} onClick={onClose}>
        Keep it
      </button>
    </Sheet>
  );
}

interface CancelProps {
  /** The date being cancelled, like "Tue 10 Nov". */
  dateLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/** Cancels one week, with a reason members can read. */
export function CancelSheet({ dateLabel, busy, error, onConfirm, onClose }: CancelProps) {
  const [reason, setReason] = useState('');
  return (
    <Sheet title={`Cancel ${dateLabel}?`} onClose={onClose}>
      <div>
        <label className="label" htmlFor="attendance-reason">
          Reason (optional)
        </label>
        <input
          id="attendance-reason"
          className="field"
          type="text"
          maxLength={MAX_REASON}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {reason.length >= COUNT_FROM && (
          <p className="muted attendance-count">
            {reason.length}/{MAX_REASON}
          </p>
        )}
      </div>
      <p className="muted">Members will see your reason. Answers are kept if you undo this.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn btn-danger" disabled={busy} onClick={() => onConfirm(reason)}>
        Cancel this week
      </button>
      <button type="button" className="btn" disabled={busy} onClick={onClose}>
        Keep it on
      </button>
    </Sheet>
  );
}
