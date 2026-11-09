export const IDENTITY_KEY = 'pikl.member.v1';

const MAX_CODES = 20;
const CODE = /^[A-Za-z0-9_-]+$/;

export interface Identity {
  version: 1;
  /** The player a member picked, by link code. Oldest first. */
  picks: Record<string, string>;
}

const empty = (): Identity => ({ version: 1, picks: {} });

/** Defaults for anything missing or malformed. Keeps the newest 20 codes. */
export function parseIdentity(raw: string | null): Identity {
  if (!raw) return empty();
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || (data as { version?: unknown }).version !== 1) return empty();
    const picks = (data as { picks?: unknown }).picks;
    if (typeof picks !== 'object' || picks === null || Array.isArray(picks)) return empty();
    const kept = Object.entries(picks).filter(
      (entry): entry is [string, string] => CODE.test(entry[0]) && typeof entry[1] === 'string' && entry[1] !== '' && entry[1].length <= 64,
    );
    return { version: 1, picks: Object.fromEntries(kept.slice(-MAX_CODES)) };
  } catch {
    return empty();
  }
}

function load(): Identity {
  try {
    return parseIdentity(localStorage.getItem(IDENTITY_KEY));
  } catch {
    return empty();
  }
}

function persist(identity: Identity): void {
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    // Storage is blocked or full: the pick holds until the page closes.
  }
}

export const readPick = (code: string): string | null => load().picks[code] ?? null;

/** Remembers the pick. A code saved again counts as new, so the oldest codes go first. */
export function savePick(code: string, playerId: string): void {
  const identity = load();
  delete identity.picks[code];
  identity.picks[code] = playerId;
  identity.picks = Object.fromEntries(Object.entries(identity.picks).slice(-MAX_CODES));
  persist(identity);
}

export function forgetPick(code: string): void {
  const identity = load();
  if (!(code in identity.picks)) return;
  delete identity.picks[code];
  persist(identity);
}
