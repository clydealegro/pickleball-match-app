import { useSyncExternalStore } from 'react';

/**
 * The organizer's private skill ratings, 1 to 10, by saved-player id. They live in this device's localStorage only:
 * they are not part of the roster, so sync never sends them and no other organizer can see them.
 */
export const RATINGS_KEY = 'pickleball.ratings';
export const MIN_RATING = 1;
export const MAX_RATING = 10;

type Ratings = Record<string, number>;

const listeners = new Set<() => void>();
let memory: Ratings | null = null; // used when storage is blocked
let cache: { raw: string | null; value: Ratings } | null = null;

const valid = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= MIN_RATING && n <= MAX_RATING;

function readRaw(): string | null {
  try {
    return localStorage.getItem(RATINGS_KEY);
  } catch {
    return memory ? JSON.stringify(memory) : null;
  }
}

/** All stored ratings. Anything malformed is dropped. The same object comes back until the stored text changes. */
export function getRatings(): Ratings {
  const raw = readRaw();
  if (cache && cache.raw === raw) return cache.value;
  const value: Ratings = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [id, n] of Object.entries(parsed)) if (valid(n)) value[id] = n;
    }
  } catch {
    // unreadable text counts as no ratings
  }
  cache = { raw, value };
  return value;
}

/** A player's rating, or undefined when they have none. */
export function getRating(rosterId: string): number | undefined {
  return getRatings()[rosterId];
}

/** Saves a rating, or removes it when `rating` is undefined. A value outside 1 to 10 is ignored. */
export function setRating(rosterId: string, rating: number | undefined): void {
  if (rating !== undefined && !valid(rating)) return;
  const next = { ...getRatings() };
  if (rating === undefined) delete next[rosterId];
  else next[rosterId] = rating;
  const text = JSON.stringify(next);
  try {
    localStorage.setItem(RATINGS_KEY, text);
  } catch {
    memory = next;
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRatings(): Ratings {
  return useSyncExternalStore(subscribe, getRatings, () => ({}));
}
