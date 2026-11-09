import { useEffect, useState } from 'react';
import { shareUrl, titleFor } from '../sync/attendance/links';
import { useAttendanceStore } from '../sync/attendance/store';
import { useLiveStore } from '../sync/live/store';
import { QrCode } from './QrCode';
import { Sheet } from './Sheet';
import { shareOrCopy } from './shareLink';
import { useSlotsStore } from '../store/slots';

/** The link and the QR for the live board come from the day's attendance link: one link for the whole day. */
function useLiveLink(): { slotId: string | null; code: string | null; url: string | null } {
  const slotId = useLiveStore((s) => s.slotId);
  const code = useAttendanceStore((s) => (slotId ? s.links[slotId]?.code : undefined)) ?? null;
  return { slotId, code, url: code ? shareUrl(window.location.origin, code) : null };
}

/** Full screen, for people standing next to the organizer. Tap anywhere, or press Escape, to close. */
function QrScreen({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="qr-screen" role="dialog" aria-modal="true" aria-label="Live board QR code" onClick={onClose}>
      <p className="qr-screen-title">Scan to follow the game</p>
      <QrCode text={url} label="QR code for the live board" className="qr-screen-code" />
      <p className="qr-screen-sub">{title}</p>
      <p className="qr-screen-url">{url.replace(/^https?:\/\//, '')}</p>
      <button type="button" className="qr-screen-close" onClick={onClose}>
        Tap to close
      </button>
    </div>
  );
}

function ResetConfirm({ onConfirm, onClose, error, busy }: { onConfirm: () => void; onClose: () => void; error: string | null; busy: boolean }) {
  return (
    <Sheet title="Reset the link?" onClose={onClose}>
      <p>Printed QR codes and links already shared will stop working. You will need to share the new one. Answers are kept.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn btn-danger" disabled={busy} onClick={onConfirm}>
        Reset link
      </button>
      <button type="button" className="btn" disabled={busy} onClick={onClose}>
        Keep it
      </button>
    </Sheet>
  );
}

function LiveShareSheet({ onClose }: { onClose: () => void }) {
  const { slotId, url } = useLiveLink();
  const paused = useLiveStore((s) => s.paused);
  const showPhotos = useLiveStore((s) => s.showPhotos);
  const status = useLiveStore((s) => s.status);
  const slot = useSlotsStore((s) => s.slots.find((x) => x.id === slotId));
  const [note, setNote] = useState<string | null>(null);
  const [qr, setQr] = useState(false);
  const [more, setMore] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const title = slot ? titleFor(slot) : 'Live board';

  async function share() {
    if (!url) return;
    const outcome = await shareOrCopy(url, title);
    setNote(outcome === 'copied' ? 'Link copied' : outcome === 'field' ? 'Could not copy. Select the link below.' : null);
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setNote('Link copied');
    } catch {
      setNote('Could not copy. Select the link below.');
    }
  }

  async function reset() {
    if (!slotId) return;
    setBusy(true);
    setResetError(null);
    const result = await useAttendanceStore.getState().resetLink(slotId);
    setBusy(false);
    if (result.ok) setResetting(false);
    else setResetError(result.message);
  }

  return (
    <>
      <Sheet title="Live board" onClose={onClose}>
        <p className="live-share-status" role="status">
          {paused ? 'Paused. Visitors see that the board is paused.' : status === 'error' ? 'Cannot reach the server. Visitors see the last board.' : 'On. Visitors see the courts and who is waiting.'}
        </p>
        {url ? (
          <div className="live-share-row">
            <QrCode text={url} label="QR code for the live board" className="live-share-qr" />
            <p className="muted live-share-note">
              {title}
              <br />
              Anyone with the link sees names and photos.
            </p>
          </div>
        ) : (
          <p className="muted">Getting the link ready.</p>
        )}
        <button type="button" className="btn btn-primary" disabled={!url} onClick={() => void share()}>
          Share link
        </button>
        <div className="live-share-pair">
          <button type="button" className="btn" disabled={!url} onClick={() => void copy()}>
            Copy link
          </button>
          <button type="button" className="btn" disabled={!url} onClick={() => setQr(true)}>
            Show QR
          </button>
        </div>
        {note && (
          <p className="muted live-share-msg" role="status">
            {note}
          </p>
        )}
        <label className="switch-row">
          <span>Show photos</span>
          <input type="checkbox" role="switch" checked={showPhotos} onChange={(e) => useLiveStore.getState().setShowPhotos(e.target.checked)} />
        </label>
        <button type="button" className="btn" onClick={() => useLiveStore.getState().setPaused(!paused)}>
          {paused ? 'Resume sharing' : 'Pause sharing'}
        </button>
        <button type="button" className="live-share-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          More
        </button>
        {more && (
          <button type="button" className="btn live-share-reset" onClick={() => setResetting(true)}>
            Reset link
          </button>
        )}
      </Sheet>
      {qr && url && <QrScreen url={url} title={title} onClose={() => setQr(false)} />}
      {resetting && <ResetConfirm onConfirm={() => void reset()} onClose={() => setResetting(false)} error={resetError} busy={busy} />}
    </>
  );
}

/** The one-time notice under the court screen's header: anyone with the link sees names and photos. */
export function LiveNotice() {
  const status = useLiveStore((s) => s.status);
  const noticeSeen = useLiveStore((s) => s.noticeSeen);
  if (status === 'off' || noticeSeen) return null;
  return (
    <div className="live-notice" role="status">
      <p>Live board is on. Anyone with your link sees names and photos.</p>
      <div className="live-notice-actions">
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            useLiveStore.getState().setPaused(true);
            useLiveStore.getState().dismissNotice();
          }}
        >
          Turn off
        </button>
        <button type="button" className="btn btn-small" onClick={() => useLiveStore.getState().dismissNotice()}>
          Got it
        </button>
      </div>
    </div>
  );
}

/**
 * The "Live board" pill in the court screen's top bar, with the share sheet it opens.
 * It shows only while a board is up, which is only for a session started from a saved day while signed in.
 */
export function LiveSharePill() {
  const status = useLiveStore((s) => s.status);
  const paused = useLiveStore((s) => s.paused);
  const [open, setOpen] = useState(false);
  if (status === 'off') return null;
  const word = paused ? 'Paused' : status === 'error' ? 'Offline' : 'On';
  return (
    <>
      <button type="button" className="live-pill" data-state={paused ? 'paused' : status === 'error' ? 'error' : 'on'} aria-label={`Live board: ${word}. Share it.`} onClick={() => setOpen(true)}>
        <i aria-hidden="true" />
        Live board · {word}
      </button>
      {open && <LiveShareSheet onClose={() => setOpen(false)} />}
    </>
  );
}
