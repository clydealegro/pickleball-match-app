import { finishGame } from '../engine/game';
import { makeCtx, newTestSession } from '../engine/testing';
import { saveSessionToHistory } from '../store/historyDb';
import { addRosterPlayer } from '../store/rosterDb';

/** A finished session of saved players, on the day given (month is 0-based). */
export async function pastSession(names: string[], roster: Map<string, string>, y: number, m: number, d: number, name = 'Open play') {
  const ctx = makeCtx(1, new Date(y, m, d, 18).getTime());
  let s = newTestSession(names, { courts: 1 }, ctx);
  s = { ...s, id: `past-${y}-${m}-${d}-${name}`, name, players: s.players.map((p) => ({ ...p, rosterId: roster.get(p.name) })) };
  s = finishGame(s, s.courts[0].id, { ...ctx, now: ctx.now + 600_000 });
  s = { ...s, endedAt: ctx.now + 900_000 };
  await saveSessionToHistory(s);
  return s;
}

/** Saves players to the roster and returns their ids by name. */
export async function seed(names: string[]) {
  const ids = new Map<string, string>();
  for (const n of names) ids.set(n, (await addRosterPlayer(n)).id);
  return ids;
}
