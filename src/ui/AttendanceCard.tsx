import { useEffect, useRef, useState, type ReactNode } from 'react';
import { shortDate } from '../store/attendance';
import { formatClock, type Slot } from '../store/slots';
import { shareUrl, titleFor, weekdayName } from '../sync/attendance/links';
import { useAttendanceStore, type AttendanceResult } from '../sync/attendance/store';
import type { AttendanceStatus } from '../sync/attendance/types';
import { useAuthStore } from '../sync/auth';
import { CancelSheet, ResetSheet } from './AttendanceSheets';
import { ATTENDANCE_PREVIEW_KEY, useBoolPref } from './prefs';
import { useAttendance } from './useAttendance';

interface Props {
  slot: Slot;
  /** Opens the place where the organizer signs in. */
  onSignIn: () => void;
}

/** Answers older than this show when they were fetched. */
const STALE_MS = 2 * 60_000;
const STATUS_LABEL: Record<AttendanceStatus, string> = { in: 'In', maybe: 'Maybe', out: 'Out' };

/** The time of day of a moment, in the app's 12-hour style: "4:12 pm". */
const clock = (ms: number) => {
  const d = new Date(ms);
  return formatClock(d.getHours() * 60 + d.getMinutes());
};

/** "Tue 10 Nov" from a YYYY-MM-DD date, read as a local date. */
function dateLabel(playDate: string): string {
  const [y, m, d] = playDate.split('-').map(Number);
  return shortDate(new Date(y, m - 1, d).getTime());
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Shell({ weekday, children }: { weekday?: string; children: ReactNode }) {
  return (
    <section className="attendance" aria-labelledby="attendance-title">
      <div className="attendance-head">
        <h2 id="attendance-title" className="section-title">
          Attendance link
        </h2>
        {weekday && <span className="muted">{weekday}</span>}
      </div>
      {children}
    </section>
  );
}

/** The organizer's attendance link for one saved slot, under the hero on Home. */
export function AttendanceCard({ slot, onSignIn }: Props) {
  const [preview] = useBoolPref(ATTENDANCE_PREVIEW_KEY, false);
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.userId);
  useAttendance(slot.id);
  const ownerId = useAttendanceStore((s) => s.ownerId);
  const saved = useAttendanceStore((s) => s.links[slot.id]);
  const savedSummary = useAttendanceStore((s) => s.summaries[slot.id]);
  const savedChange = useAttendanceStore((s) => s.lastChange[slot.id]);
  const savedError = useAttendanceStore((s) => s.lastError[slot.id]);
  const busy = useAttendanceStore((s) => !!s.busy[slot.id]);
  const [sheet, setSheet] = useState<'reset' | 'cancel' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [shared, setShared] = useState<'copied' | 'field' | null>(null);
  const fieldRef = useRef<HTMLInputElement>(null);

  // A different account's copy is not shown while the new one loads.
  const mine = ownerId === null || userId === null || ownerId === userId;
  const link = mine ? saved : undefined;
  const summary = mine ? savedSummary : undefined;
  const change = mine ? savedChange : null;
  const error = mine ? savedError : undefined;

  useEffect(() => {
    if (shared === 'field') fieldRef.current?.select();
  }, [shared]);

  if (!preview || status === 'unconfigured' || status === 'loading') return null;

  if (status === 'signedOut' || status === 'linkSent') {
    return (
      <Shell>
        <p className="muted">Sign in to share an attendance link with your players.</p>
        <div className="attendance-actions">
          <button type="button" className="btn btn-live attendance-btn" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </Shell>
    );
  }

  // Sign-in that cannot be checked is not signed out: saved answers stay, and nothing asks to sign in.
  if (status === 'unknown' && !link) return null;

  // Read when pressed, so the newest actions run.
  const store = () => useAttendanceStore.getState();

  /** Runs a change. A failure keeps the message; a success clears it. */
  async function run(act: () => Promise<AttendanceResult>, onDone?: () => void) {
    setProblem(null);
    const result = await act();
    if (result.ok) onDone?.();
    else setProblem(result.message);
  }

  async function share(url: string) {
    setShared(null);
    setProblem(null);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: titleFor(slot), url });
        return;
      } catch (e) {
        // The person closed the share sheet: nothing went wrong.
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared('copied');
    } catch {
      setShared('field');
    }
  }

  function closeSheet() {
    setSheet(null);
    setProblem(null);
  }

  if (!link) {
    const failed = error !== undefined && error !== null;
    return (
      <Shell weekday={weekdayName(slot.weekday)}>
        {error === undefined && (
          <p className="muted" role="status">
            Checking answers
          </p>
        )}
        {failed && <LoadFailed onRetry={() => void store().refresh(slot.id)} />}
        {error === null && (
          <div className="attendance-actions">
            <button type="button" className="btn btn-live attendance-btn" disabled={busy} onClick={() => void run(() => store().ensureLink(slot))}>
              Create link
            </button>
          </div>
        )}
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
      </Shell>
    );
  }

  if (!summary) {
    return (
      <Shell weekday={weekdayName(slot.weekday)}>
        {error ? (
          <LoadFailed onRetry={() => void store().refresh(slot.id)} />
        ) : (
          <p className="muted" role="status">
            Checking answers
          </p>
        )}
      </Shell>
    );
  }

  const stale = Date.now() - summary.fetchedAt > STALE_MS || (error !== undefined && error !== null);
  const staleLines = stale && (
    <>
      <p className="attendance-line">Updated {clock(summary.fetchedAt)}</p>
      {error === 'offline' && <p className="attendance-line">Offline, showing the last list</p>}
    </>
  );
  // While a sheet is open it shows the message itself.
  const alert = problem && sheet === null && (
    <p className="error" role="alert">
      {problem}
    </p>
  );

  if (summary.cancelled) {
    const { reason } = summary.cancelled;
    return (
      <Shell weekday={weekdayName(slot.weekday)}>
        <p className="attendance-notice">
          Cancelled for {dateLabel(summary.playDate)}.{reason ? ` ${reason}` : ''}
        </p>
        {staleLines}
        <div className="attendance-actions">
          <button type="button" className="btn attendance-btn" disabled={busy} onClick={() => void run(() => store().undoCancel(slot.id))}>
            Undo
          </button>
        </div>
        {alert}
      </Shell>
    );
  }

  const url = shareUrl(window.location.origin, link.code);
  const { counts, waiting } = summary;
  return (
    <Shell weekday={weekdayName(slot.weekday)}>
      <ul className="attendance-pills" aria-label="Answers">
        <li className="attendance-pill" data-kind="in">{`${counts.in} in`}</li>
        <li className="attendance-pill" data-kind="maybe">{`${counts.maybe} maybe`}</li>
        <li className="attendance-pill" data-kind="out">{`${counts.out} out`}</li>
        {summary.friends > 0 && (
          <li className="attendance-pill" data-kind="friend">
            {plural(summary.friends, 'friend', 'friends')}
          </li>
        )}
      </ul>
      {staleLines}
      {change && <p className="attendance-line">{`${change.player} changed to ${STATUS_LABEL[change.to]} at ${clock(change.at)}.`}</p>}
      {waiting.length > 0 && <p className="attendance-line">{`${plural(waiting.length, 'new name', 'new names')} to review`}</p>}
      <p className="attendance-link">{url}</p>
      <div className="attendance-actions">
        <button type="button" className="btn btn-live attendance-btn" disabled={busy} onClick={() => void share(url)}>
          Share
        </button>
        <button type="button" className="btn attendance-btn" disabled={busy} onClick={() => setSheet('reset')}>
          Reset link
        </button>
        <button type="button" className="btn attendance-btn" disabled={busy} onClick={() => setSheet('cancel')}>
          Cancel this week
        </button>
      </div>
      {shared === 'copied' && (
        <p className="attendance-line" role="status">
          Link copied
        </p>
      )}
      {shared === 'field' && <input ref={fieldRef} className="field" readOnly aria-label="Link" value={url} />}
      {alert}
      {sheet === 'reset' && (
        <ResetSheet busy={busy} error={problem} onClose={closeSheet} onConfirm={() => void run(() => store().resetLink(slot.id), closeSheet)} />
      )}
      {sheet === 'cancel' && (
        <CancelSheet
          dateLabel={dateLabel(summary.playDate)}
          busy={busy}
          error={problem}
          onClose={closeSheet}
          onConfirm={(reason) => void run(() => store().cancelWeek(slot.id, reason), closeSheet)}
        />
      )}
    </Shell>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <>
      <p className="muted">Could not load the answers. Try again.</p>
      <div className="attendance-actions">
        <button type="button" className="btn attendance-btn" onClick={onRetry}>
          Retry
        </button>
      </div>
    </>
  );
}
