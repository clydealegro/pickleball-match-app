import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { PhotoError, processPhoto } from '../lib/photo';
import type { PhotoData } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { PlayerAvatar } from './PlayerAvatar';

interface Props {
  rosterId: string;
  name: string;
  /** Called after a photo is saved or removed, and when the organizer leaves without changing it. */
  onDone: () => void;
  /** The label of the button that leaves without changing the photo. */
  doneLabel?: string;
}

interface Preview {
  photo: PhotoData;
  url: string;
}

/** Take or choose a photo for a saved player, check it, then save it. Remove the current one. */
export function PhotoPanel({ rosterId, name, onDone, doneLabel = 'Close' }: Props) {
  const hasPhoto = useRosterStore((s) => (s.players.find((p) => p.id === rosterId)?.photoVersion ?? 0) > 0);
  const setPhoto = useRosterStore((s) => s.setPhoto);
  const removePhoto = useRosterStore((s) => s.removePhoto);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  // The sheet can be dismissed while a picture is being prepared or saved. Once it has, nothing
  // here may create a URL, change state or report "done".
  const alive = useRef(true);
  // Only the latest chosen file may set the preview.
  const latest = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Free the preview's object URL when it is replaced or the panel closes.
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // lets the same file be chosen again after "Retake"
    if (!file) return;
    const request = ++latest.current;
    const current = () => alive.current && request === latest.current;
    setError(null);
    setBusy(true);
    try {
      const photo = await processPhoto(file);
      if (!current()) return;
      setPreview({ photo, url: URL.createObjectURL(new Blob([photo.data], { type: photo.type })) });
    } catch (e) {
      if (current()) setError(e instanceof PhotoError ? e.message : "Couldn't prepare that picture. Try again.");
    } finally {
      if (current()) setBusy(false);
    }
  }

  async function save() {
    if (!preview) return;
    setError(null);
    setBusy(true);
    try {
      await setPhoto(rosterId, preview.photo);
      if (alive.current) onDone();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Couldn't save that photo.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      await removePhoto(rosterId);
      if (alive.current) onDone();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Couldn't remove that photo.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const inputs = (
    <>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="user"
        hidden
        tabIndex={-1}
        aria-label="Take a photo with the camera"
        onChange={(e) => void onFile(e)}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        hidden
        tabIndex={-1}
        aria-label="Choose a photo from the library"
        onChange={(e) => void onFile(e)}
      />
    </>
  );

  return (
    <div className="stack">
      {inputs}

      {preview ? (
        <>
          <img className="photo-preview" src={preview.url} alt={`Preview of the new photo for ${name}`} />
          <p className="muted">Take photos with the player's permission.</p>
          <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void save()}>
            Use photo
          </button>
          <button type="button" className="btn btn-block" disabled={busy} onClick={() => {
              setError(null);
              setPreview(null);
            }}
          >
            Retake
          </button>
        </>
      ) : (
        <>
          <div className="row-flex">
            <PlayerAvatar name={name} rosterId={rosterId} size="lg" />
            <p className="muted">{hasPhoto ? 'Current photo' : 'No photo yet'}</p>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy}
            onClick={() => cameraRef.current?.click()}
          >
            {busy ? 'Preparing…' : 'Take photo'}
          </button>
          <button type="button" className="btn btn-block" disabled={busy} onClick={() => libraryRef.current?.click()}>
            Choose from library
          </button>
          {hasPhoto && (
            <button type="button" className="btn btn-block btn-danger" disabled={busy} onClick={() => void remove()}>
              Remove photo
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={onDone}>
            {doneLabel}
          </button>
        </>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
