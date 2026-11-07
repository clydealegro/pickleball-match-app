import { useEffect } from 'react';

interface Sentinel {
  released: boolean;
  release: () => Promise<void>;
}
interface WakeLockApi {
  request: (type: 'screen') => Promise<Sentinel>;
}

/**
 * Keeps the screen on while `active`. The browser drops the lock whenever the page is hidden, so it is asked for again
 * when the page comes back. Where the feature is missing or refused, nothing happens.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const api = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;
    if (!api) return;
    let sentinel: Sentinel | null = null;
    let stopped = false;

    async function acquire() {
      if (document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      try {
        const next = await api!.request('screen');
        if (stopped) void next.release().catch(() => {});
        else sentinel = next;
      } catch {
        // Refused (for example by battery saver): carry on without it.
      }
    }

    void acquire();
    const onVisible = () => void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
