import { useSyncExternalStore } from 'react';

/** Small settings kept in localStorage, with a memory fallback when storage is blocked. */
export const KEEP_AWAKE_KEY = 'pickleball.keepAwake';
export const VIBRATE_KEY = 'pickleball.vibrate';
export const COURTS_KEY = 'pickleball.courts';
export const AUTO_START_KEY = 'pickleball.autoStart';
export const PLAY_TO_KEY = 'pickleball.playTo';
export const REGULARS_FIRST_KEY = 'pickleball.regularsFirst';

/** The scores a game can be played to. */
export const PLAY_TO_CHOICES = [11, 15, 21] as const;
export type PlayTo = (typeof PLAY_TO_CHOICES)[number];

const listeners = new Set<() => void>();
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getBoolPref(key: string, fallback: boolean): boolean {
  const v = read(key);
  return v === null ? fallback : v === 'true';
}

export function setBoolPref(key: string, value: boolean): void {
  write(key, String(value));
}

export function useBoolPref(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => getBoolPref(key, fallback),
    () => fallback,
  );
  return [value, (v) => setBoolPref(key, v)];
}

/** A whole number from storage, clamped to a range; the fallback when missing or not a number. */
export function getNumPref(key: string, fallback: number, min: number, max: number): number {
  const n = Number(read(key));
  if (read(key) === null || !Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function setNumPref(key: string, value: number): void {
  write(key, String(value));
}

/** What a game is played to: 11 unless the organizer chose 15 or 21. Anything else in storage means 11. */
export function getPlayTo(): PlayTo {
  const n = getNumPref(PLAY_TO_KEY, 11, 1, 99);
  return (PLAY_TO_CHOICES as readonly number[]).includes(n) ? (n as PlayTo) : 11;
}

export function usePlayTo(): [PlayTo, (value: PlayTo) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => getPlayTo(),
    () => 11 as PlayTo,
  );
  return [value, (v) => setNumPref(PLAY_TO_KEY, v)];
}
