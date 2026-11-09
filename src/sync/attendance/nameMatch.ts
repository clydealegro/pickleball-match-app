import { norm } from '../rows';
import type { RosterPlayer } from '../../store/rosterDb';

export interface NameMatch {
  kind: 'exact' | 'likely' | 'none';
  player?: RosterPlayer;
}

const firstWord = (name: string) => norm(name).split(/\s+/)[0] ?? '';

/**
 * How a name from the link lines up with the saved roster. Exact: the same name, ignoring case and spaces at the
 * ends. Likely: the same first word and a different name. An exact match anywhere wins over a likely one.
 */
export function nameMatch(name: string, roster: RosterPlayer[]): NameMatch {
  const key = norm(name);
  if (!key) return { kind: 'none' };
  const exact = roster.find((p) => norm(p.name) === key);
  if (exact) return { kind: 'exact', player: exact };
  const first = firstWord(name);
  const likely = roster.find((p) => firstWord(p.name) === first);
  return likely ? { kind: 'likely', player: likely } : { kind: 'none' };
}
