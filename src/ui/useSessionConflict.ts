import { useEffect, useState } from 'react';
import { STORAGE_KEY } from '../store/persistence';

/**
 * True once another tab or window has saved this app's session. The storage event only fires in the other windows,
 * never for this window's own saves, so a hit always means a second copy of the app is open.
 */
export function useSessionConflict(): boolean {
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) setChanged(true);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return changed;
}
