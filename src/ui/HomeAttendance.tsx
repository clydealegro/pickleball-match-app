import { useEffect, useRef, useState } from 'react';
import { courtFill } from '../store/courtFill';
import type { Slot } from '../store/slots';
import { shareUrl, titleFor } from '../sync/attendance/links';
import { useAttendanceStore } from '../sync/attendance/store';
import { useAuthStore } from '../sync/auth';
import { PlayerAvatar } from './PlayerAvatar';
import { shareOrCopy } from './shareLink';
import { useAttendance } from './useAttendance';

const MAX_FACES = 3;
const NOTE_MS = 2500;

interface Props {
  slot: Slot;
  /** Opens the full attendance sheet. */
  onOpen: () => void;
  /** Opens the place where the organizer signs in. */
  onSignIn: () => void;
}

/** The bottom of the hero: who is in, and the one button that sends the link. */
export function HomeAttendance({ slot, onOpen, onSignIn }: Props) {
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.userId);
  useAttendance(slot.id);
  const ownerId = useAttendanceStore((s) => s.ownerId);
  const link = useAttendanceStore((s) => s.links[slot.id]);
  const summary = useAttendanceStore((s) => s.summaries[slot.id]);
  const busy = useAttendanceStore((s) => !!s.busy[slot.id]);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (status === 'unconfigured' || status === 'loading') return null;
  const signedIn = status === 'signedIn' || status === 'unknown';
  const mine = ownerId === null || userId === null || ownerId === userId;
  const mineLink = mine ? link : undefined;
  const mineSummary = mine ? summary : undefined;
  if (status === 'unknown' && !mineLink) return null;

  function flash(text: string) {
    setNote(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(null), NOTE_MS);
  }

  async function share() {
    let code = mineLink?.code;
    if (!code) {
      const result = await useAttendanceStore.getState().ensureLink(slot);
      if (!result.ok) {
        flash(result.message);
        return;
      }
      code = useAttendanceStore.getState().links[slot.id]?.code;
    }
    if (!code) return;
    const outcome = await shareOrCopy(shareUrl(window.location.origin, code), titleFor(slot));
    if (outcome === 'copied') flash('Link copied');
    // Even copying failed: the sheet shows the link to select.
    if (outcome === 'field') onOpen();
  }

  const cancelled = mineSummary?.cancelled;
  const counts = mineSummary?.counts;
  const ins = mineSummary ? Object.entries(mineSummary.answers).filter(([, a]) => a === 'in').map(([id]) => id) : [];
  const waiting = mineSummary?.waiting.length ?? 0;
  const playing = counts?.in ?? 0;
  const maybe = counts?.maybe ?? 0;
  const fill = courtFill(playing);
  // Said as "playing", never "in", which reads as inches next to a number.
  const label = cancelled ? 'Cancelled this week' : counts ? `${playing} playing${maybe > 0 ? `, ${maybe} maybe` : ''}` : 'Answers show here';

  // Signed out there is nothing to show yet, so the only thing on offer is signing in.
  if (!signedIn) {
    return (
      <div className="home-attend-wrap">
        <button type="button" className="home-share" onClick={onSignIn}>
          Sign in to share
        </button>
      </div>
    );
  }

  return (
    <div className="home-attend-wrap">
      <button type="button" className="home-who" aria-label={`Attendance: ${label}`} onClick={onOpen}>
        <span className="home-who-top">
          {ins.length > 0 && !cancelled && (
            <span className="home-avatars" aria-hidden="true">
              {ins.slice(0, MAX_FACES).map((id) => (
                <PlayerAvatar key={id} name={mineSummary?.names[id] ?? '?'} rosterId={id} size="sm" />
              ))}
              {ins.length > MAX_FACES && <span className="home-more">+{ins.length - MAX_FACES}</span>}
            </span>
          )}
          <span className="home-who-count">
            {cancelled ? (
              'Cancelled this week'
            ) : counts ? (
              <>
                <b>{playing}</b> playing
              </>
            ) : (
              'Answers show here'
            )}
          </span>
          {waiting > 0 && <span className="home-attend-badge">{waiting} new</span>}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </span>
        {counts && !cancelled && (
          <>
            {/* One block per player, four to a court, so the bar shows when there are enough for a game. */}
            <span className="home-seats" aria-hidden="true">
              {fill.groups.map((taken, g) => (
                <span key={g} className="home-seat-group">
                  {[0, 1, 2, 3].map((k) => (
                    <i key={k} className={k < taken ? 'is-taken' : ''} />
                  ))}
                </span>
              ))}
            </span>
            <span className="home-who-cap">
              <span>{fill.caption}</span>
              {maybe > 0 && <span>{maybe} maybe</span>}
            </span>
          </>
        )}
      </button>
      {!cancelled && (
        <button type="button" className="home-share" disabled={busy} onClick={() => void share()}>
          {note ?? 'Share link'}
        </button>
      )}
    </div>
  );
}
