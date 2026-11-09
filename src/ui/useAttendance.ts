import { useEffect } from 'react';
import { useAttendanceStore } from '../sync/attendance/store';
import { useAuthStore } from '../sync/auth';
import { ATTENDANCE_PREVIEW_KEY, useBoolPref } from './prefs';

const REFRESH_MS = 60_000;

/**
 * Keeps one slot's attendance answers fresh: when the card appears, every minute while the page is visible, and
 * when the page comes back to the front. Only while the preview is on and the organizer is signed in.
 */
export function useAttendance(slotId: string): { active: boolean } {
  const [preview] = useBoolPref(ATTENDANCE_PREVIEW_KEY, false);
  const signedIn = useAuthStore((s) => s.status === 'signedIn' && s.userId !== null);
  const active = preview && signedIn;

  useEffect(() => {
    if (!active) return;
    const refresh = () => void useAttendanceStore.getState().refresh(slotId);
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, slotId]);

  return { active };
}
