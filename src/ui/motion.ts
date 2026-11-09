import { getBoolPref, REDUCE_MOTION_KEY } from './prefs';

/** Whether the app may animate: off when the organizer switched motion off, or the device asks for less of it. */
export function motionOK(): boolean {
  if (getBoolPref(REDUCE_MOTION_KEY, false)) return false;
  try {
    return !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return true;
  }
}

/** Lets the stylesheet see the organizer's choice. The device setting is read by the stylesheet itself. */
export function applyMotionPref(): void {
  document.documentElement.dataset.motion = getBoolPref(REDUCE_MOTION_KEY, false) ? 'reduced' : 'full';
}

/** Shared easings and timings, matching the CSS tokens in app.css. */
export const MOTION = {
  out: 'power3.out',
  spring: 'back.out(1.6)',
  fast: 0.2,
  slow: 0.32,
} as const;
