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
  // Remember whose photo this is, so one player's picture is never shown for another.
  const [loaded, setLoaded] = useState<{ id: string; url: string }>();

  useEffect(() => {
    if (!rosterId || version === 0) {
      setLoaded(undefined);
      return;
    }
    let cancelled = false;
    getRosterPhoto(rosterId)
      .then((photo) => {
        if (cancelled) return;
        setLoaded(
          photo ? { id: rosterId, url: URL.createObjectURL(new Blob([photo.data], { type: photo.type })) } : undefined,
        );
      })
      .catch(() => {
        // A photo that cannot be read just shows initials.
        if (!cancelled) setLoaded(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [rosterId, version]);

  // The cleanup runs when the URL is replaced and when the component unmounts.
  const url = loaded?.url;
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  // Only a photo that belongs to this player, and only while they still have one: a removed photo
  // or a different player's picture disappears in the same render, not after the effect runs.
  return rosterId && version > 0 && loaded?.id === rosterId ? loaded.url : undefined;
}
