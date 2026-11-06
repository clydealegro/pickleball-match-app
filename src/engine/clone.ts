import type { Session } from './types';

/** A session is plain JSON data, so a JSON round trip is a safe deep clone. */
export function cloneSession(s: Session): Session {
  return JSON.parse(JSON.stringify(s)) as Session;
}
