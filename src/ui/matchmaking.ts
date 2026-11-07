import { useSyncExternalStore } from 'react';
import type { Mode } from '../engine';

const KEY = 'pickleball.mode';
const listeners = new Set<() => void>();

let memory: Mode | null = null;

/** How new sessions pick who plays next. Fairness unless the organizer chose the simple queue in Settings. */
export function getDefaultMode(): Mode {
  try {
    return localStorage.getItem(KEY) === 'queue' ? 'queue' : 'fairness';
  } catch {
    // Storage can be blocked; the choice then lasts only until the page closes.
    return memory ?? 'fairness';
  }
}

export function setDefaultMode(mode: Mode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    memory = mode;
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useDefaultMode(): [Mode, (mode: Mode) => void] {
  return [useSyncExternalStore(subscribe, getDefaultMode, () => 'fairness' as Mode), setDefaultMode];
}
