import { useEffect, useRef, useState } from 'react';
import { useRosterStore } from '../store/rosterStore';
import { nameMatch } from '../sync/attendance/nameMatch';
import { useAttendanceStore } from '../sync/attendance/store';
import type { WaitingName } from '../sync/attendance/types';
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

interface ReviewProps {
  slotId: string;
  waiting: WaitingName[];
  /** Display first names by player id, for "Friend of Ana". */
  names: Record<string, string>;
  /** Called when the last name has been dealt with. */
  onEmpty: () => void;
  onClose: () => void;
}

/** The new names and friends members sent. Nothing reaches the roster until the organizer says so. */
export function ReviewSheet({ slotId, waiting, names, onEmpty, onClose }: ReviewProps) {
  const roster = useRosterStore((s) => s.players);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onEmptyRef = useRef(onEmpty);
  useEffect(() => {
    onEmptyRef.current = onEmpty;
  }, [onEmpty]);
  useEffect(() => {
    if (waiting.length === 0) onEmptyRef.current();
  }, [waiting.length]);

  /** Runs one row's change. A failure keeps the row and shows why. */
  async function act(guest: WaitingName, change: () => Promise<string | null>) {
    setError(null);
    setWorking(guest.id);
    try {
      const problem = await change();
      if (problem) setError(problem);
    } finally {
      setWorking(null);
    }
  }
  const mark = async (guest: WaitingName, state: 'play_tonight' | 'added' | 'dismissed') => {
    const result = await useAttendanceStore.getState().setGuestState(slotId, guest.id, state);
    return result.ok ? null : result.message;
  };
  const addToRoster = async (guest: WaitingName) => {
    try {
      await useRosterStore.getState().add(guest.name);
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not add that player.';
    }
    return mark(guest, 'added');
  };

  return (
    <Sheet title={`${waiting.length} to review`} onClose={onClose}>
      <ul className="review-list">
        {waiting.map((guest) => {
          const match = nameMatch(guest.name, roster);
          const friend = guest.broughtBy !== null;
          const sponsor = guest.broughtBy !== null ? names[guest.broughtBy] : undefined;
          const disabled = working === guest.id;
          return (
            <li key={guest.id} className="review-row">
              <p className="review-name">{guest.name}</p>
              <p className="muted review-note">{friend ? (sponsor ? `Friend of ${sponsor}` : 'Friend') : 'New name, asked to join'}</p>
              {match.kind === 'exact' && <p className="review-hint">{`Already saved as ${match.player?.name}.`}</p>}
              {match.kind === 'likely' && <p className="review-hint">{`Could be ${match.player?.name}, who is already saved.`}</p>}
              <div className="review-actions">
                {friend && (
                  <button type="button" className="btn btn-live attendance-btn" disabled={disabled} onClick={() => void act(guest, () => mark(guest, 'play_tonight'))}>
                    Play tonight
                  </button>
                )}
                <button type="button" className="btn attendance-btn" disabled={disabled} onClick={() => void act(guest, () => addToRoster(guest))}>
                  {match.kind === 'exact' ? 'Mark as done' : 'Add to roster'}
                </button>
                <button type="button" className="btn attendance-btn" disabled={disabled} onClick={() => void act(guest, () => mark(guest, 'dismissed'))}>
                  Dismiss
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="muted">Added players are saved to your roster. Tick them in Who's playing.</p>
    </Sheet>
  );
}
