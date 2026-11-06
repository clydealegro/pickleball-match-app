import { useEffect, useState } from 'react';
import { getRosterPhoto } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';

/**
 * An object URL for a saved player's photo, or undefined when they have none on this device.
 * It reloads when the photo changes and frees the URL when it is replaced or the component goes away.
 */
export function usePhotoUrl(rosterId: string | undefined): string | undefined {
  const version = useRosterStore((s) =>
    rosterId ? (s.players.find((p) => p.id === rosterId)?.photoVersion ?? 0) : 0,
  );
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (!rosterId || version === 0) {
      setUrl(undefined);
      return;
    }
    let cancelled = false;
    getRosterPhoto(rosterId)
      .then((photo) => {
        if (cancelled) return;
        setUrl(photo ? URL.createObjectURL(new Blob([photo.data], { type: photo.type })) : undefined);
      })
      .catch(() => {
        // A photo that cannot be read just shows initials.
      });
    return () => {
      cancelled = true;
    };
  }, [rosterId, version]);

  // The cleanup runs when `url` is replaced and when the component unmounts.
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  // Never show a stale picture: with no photo the answer is undefined right away, not after the effect runs.
  return rosterId && version > 0 ? url : undefined;
}
