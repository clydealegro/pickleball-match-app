import { useEffect, useState } from 'react';
import { setSessionWritesBlocked } from '../store/sessionStore';
import { STORAGE_KEY } from '../store/persistence';

/**
 * True once another tab or window has saved this app's session. The storage event only fires in the other windows,
 * never for this window's own saves, so a hit always means a second copy of the app is open.
 */
export function useSessionConflict(): boolean {
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    let disposed = false;
    let conflicted = false;
    let release: (() => void) | undefined;
    // Hold one origin-wide writer lease for this mounted app. Acquisition is asynchronous,
    // so block mutations until it completes. A second tab remains read-only until reloaded.
    if (navigator.locks) {
      setSessionWritesBlocked(true);
      void Promise.resolve().then(() => {
        if (disposed) return; // StrictMode's discarded mount must not compete for the lease.
        return navigator.locks.request('pickleball-session-writer', { ifAvailable: true }, async (lock) => {
        if (disposed) return;
        if (!lock) {
          setChanged(true);
          return;
        }
        if (!conflicted) setSessionWritesBlocked(false);
        await new Promise<void>(resolve => { release = resolve; });
        });
      }).catch(() => {
        if (!disposed) setChanged(true); // fail closed if coordination is unavailable
      });
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) {
        conflicted = true;
        setSessionWritesBlocked(true);
        setChanged(true);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      disposed = true;
      release?.();
      window.removeEventListener('storage', onStorage);
      setSessionWritesBlocked(false);
    };
  }, []);
  return changed;
}
