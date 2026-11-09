import {
  ackOutbox,
  applyPulledPlayer,
  getRosterEntry,
  getRosterPhoto,
  getSyncMeta,
  listOutbox,
  mergeLocalInto,
  queueAllForSync,
  setSyncMeta,
  type OutboxEntry,
  type PhotoData,
  type PulledPlayer,
  type RosterPlayer,
} from '../store/rosterDb';
import { RemoteError, isRemoteError, photoFolder, photoPath, type Remote, type RemoteFailure } from './remote';
import { norm, parsePlayerRow, pushRow } from './rows';

/** The `syncMeta` keys this engine owns. (`outboxRev` belongs to the roster database.) */
const USER_KEY = 'syncUser';
const CURSOR_KEY = 'syncCursor';

/** Rows are asked for from this long before the cursor, because a write that started earlier can commit later. */
const OVERLAP_MS = 2 * 60 * 1000;
/** How many times one sync tries the players it had to put off. */
const MAX_PASSES = 6;

export type SyncOutcome =
  | { ok: true; pushed: number; pulled: number; skippedRows: number; pending: number }
  | { ok: false; reason: RemoteFailure | 'otherAccount'; pending: number };

interface Stats {
  pushed: number;
  pulled: number;
  skippedRows: number;
}

const pendingCount = async () => (await listOutbox()).length;

/**
 * One round of sync as the signed-in organizer: first push every player with changes waiting, then pull what changed
 * on the server. Safe to run again at any time, and safe to stop halfway: each step is saved on its own.
 * Failures that need another try later come back as `ok: false`; anything else (a bug) is thrown.
 */
export async function syncOnce(remote: Remote, userId: string): Promise<SyncOutcome> {
  const owner = userId.toLowerCase();
  const known = await getSyncMeta(USER_KEY);
  if (known === undefined) {
    // The first sync on this device: everything saved here has to reach the account, and names that the account
    // already has are merged in when each player is pushed.
    await queueAllForSync();
    await setSyncMeta(USER_KEY, owner);
  } else if (known !== owner) {
    // Another account's players are on this device. Neither mix them into this account nor drop them.
    return { ok: false, reason: 'otherAccount', pending: await pendingCount() };
  }

  const stats: Stats = { pushed: 0, pulled: 0, skippedRows: 0 };
  try {
    const failed = await pushAll(remote, owner, stats);
    await pullAll(remote, owner, stats);
    const pending = await pendingCount();
    if (failed > 0) return { ok: false, reason: 'server', pending };
    return { ok: true, ...stats, pending };
  } catch (error) {
    if (isRemoteError(error)) return { ok: false, reason: error.kind, pending: await pendingCount() };
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------- push

/**
 * Pushes every marked player. Returns how many could not be pushed this time (the server refused them, or they are
 * still waiting for a name to be freed). Players put off are tried again after the others, and a merge can mark
 * another player, so each pass reads the marks afresh.
 */
async function pushAll(remote: Remote, owner: string, stats: Stats): Promise<number> {
  const refused = new Set<string>();
  const waiting = async () => (await listOutbox()).filter((mark) => !refused.has(mark.playerId));
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const todo = await waiting();
    if (todo.length === 0) return refused.size;
    let done = 0;
    const deferred: OutboxEntry[] = [];
    for (const mark of await deletedFirst(todo)) {
      try {
        if ((await pushPlayer(remote, owner, mark)) === 'deferred') deferred.push(mark);
        else done += 1;
      } catch (error) {
        // A refusal for one player must not hold up the others. No connection or no session stops everything.
        if (isRemoteError(error) && error.kind === 'server') refused.add(mark.playerId);
        else throw error;
      }
    }
    stats.pushed += done;
    if (done === 0 && deferred.length > 0 && refused.size === 0) {
      // Nobody could go first: players have to swap names. Park one under a name nobody has, so the others can go.
      // Not while a player was refused: that player may be the one holding the name, and waiting is then right.
      const stuck = await getRosterEntry(deferred[0].playerId);
      if (stuck) await remote.upsertPlayer({ ...pushRow(stuck), name: `${stuck.name.trim()} #${stuck.id.slice(0, 8)}` });
    }
  }
  return refused.size + (await waiting()).length;
}

/** Deleted players go first: the server's unique name rule would refuse a new player with a deleted player's name. */
async function deletedFirst(marks: OutboxEntry[]): Promise<OutboxEntry[]> {
  const flagged = await Promise.all(
    marks.map(async (mark) => ({ mark, deleted: (await getRosterEntry(mark.playerId))?.deletedAt !== undefined })),
  );
  return [...flagged.filter((f) => f.deleted), ...flagged.filter((f) => !f.deleted)].map((f) => f.mark);
}

/** Pushes one player: the picture, then the row, then clears the mark. `deferred` means try again after the others. */
async function pushPlayer(remote: Remote, owner: string, mark: OutboxEntry): Promise<'done' | 'deferred'> {
  const player = await getRosterEntry(mark.playerId);
  if (!player) {
    await ackOutbox(mark.playerId, mark.rev);
    return 'done';
  }
  const folder = photoFolder(owner, player.id);
  // The picture goes up before the row that points at it, so no other device finds a row without its picture.
  let stale: string[] = [];
  if (player.photoSeq > 0) {
    const names = await remote.listPhotoFiles(folder);
    const keep = player.deletedAt === undefined && player.photoVersion > 0 ? `${player.photoRevision ?? player.photoSeq}.jpg` : undefined;
    if (keep && !names.includes(keep)) {
      const photo = await getRosterPhoto(player.id);
      if (photo) await remote.uploadPhoto(`${folder}/${keep}`, photo);
    }
    // Earlier pictures of this player, and all of them once the player is deleted, are no longer needed.
    // Immutable revisions may be referenced by a concurrent writer. Reclaim only on deletion;
    // account purge also removes all revisions.
    stale = names.filter(() => keep === undefined).map((name) => `${folder}/${name}`);
  }

  if ((await remote.upsertPlayer(pushRow(player))) === 'nameTaken') {
    const settled = await settleNameClash(remote, owner, player);
    if (settled === 'deferred') return 'deferred';
    if (settled === 'merged') return 'done';
    // The holder of the name went away since the refusal.
    if ((await remote.upsertPlayer(pushRow(player))) !== 'ok') throw new RemoteError('server');
  }
  if (stale.length > 0) await remote.removePhotoFiles(stale);
  await ackOutbox(player.id, mark.rev);
  return 'done';
}

/**
 * The server already has a live player with this player's name. Either it is the same person, saved on another
 * device (merge them), or its holder is about to be renamed or deleted by a change of ours that has not been pushed
 * yet (wait for that).
 */
async function settleNameClash(remote: Remote, owner: string, player: RosterPlayer): Promise<'merged' | 'deferred' | 'retry'> {
  const live = (await remote.listLive()).map(parsePlayerRow).filter((row): row is PulledPlayer => row !== null);
  const holder = live.find((row) => row.id !== player.id && norm(row.name) === norm(player.name));
  if (!holder) return 'retry';
  if ((await listOutbox()).some((entry) => entry.playerId === holder.id)) return 'deferred';
  await applyRemote(remote, owner, holder);
  await mergeLocalInto(player.id, holder.id);
  // This player never had a row, so whatever picture was uploaded for them belongs to no one.
  const leftovers = await remote.listPhotoFiles(photoFolder(owner, player.id));
  await remote.removePhotoFiles(leftovers.map((name) => `${photoFolder(owner, player.id)}/${name}`));
  return 'merged';
}

// ---------------------------------------------------------------------------------------------------- pull

async function pullAll(remote: Remote, owner: string, stats: Stats): Promise<void> {
  const cursor = await getSyncMeta(CURSOR_KEY);
  const cursorMs = typeof cursor === 'string' ? Date.parse(cursor) : NaN;
  const since = Number.isNaN(cursorMs) ? undefined : new Date(cursorMs - OVERLAP_MS).toISOString();
  const rows: PulledPlayer[] = [];
  for (const raw of await remote.pull(since)) {
    const row = parsePlayerRow(raw);
    if (row) rows.push(row);
    else stats.skippedRows += 1;
  }
  rows.sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id));
  for (const row of rows) {
    if ((await applyRemote(remote, owner, row)) === 'applied') stats.pulled += 1;
  }
  // The cursor only moves once every row is saved, so a failure halfway reads the same rows again.
  const newest = rows.reduce((latest, row) => Math.max(latest, row.updatedAt), Number.isNaN(cursorMs) ? 0 : cursorMs);
  if (newest > 0) await setSyncMeta(CURSOR_KEY, new Date(newest).toISOString());
}

/** Saves one pulled row, downloading its picture first when this device does not have the right one. */
async function applyRemote(remote: Remote, owner: string, row: PulledPlayer): Promise<'applied' | 'pending' | 'unchanged'> {
  let photo: PhotoData | null | undefined;
  if (row.deletedAt === undefined && row.photoVersion !== 0) {
    const local = await getRosterEntry(row.id);
    // A revision names the exact file, so it alone decides. The sequence number only identifies the file for rows
    // without one; locally it is kept as a high-water mark (see applyPulledPlayer) and can sit above the server's.
    const sameFile = row.photoRevision !== undefined ? local?.photoRevision === row.photoRevision : local?.photoRevision === undefined && local?.photoSeq === row.photoSeq;
    const current = local !== undefined && sameFile && (await getRosterPhoto(row.id)) !== undefined;
    if (!current) {
      const bytes = await remote.downloadPhoto(photoPath(owner, row.id, row.photoRevision ?? row.photoSeq));
      // A row whose picture is gone is shown without one.
      photo = bytes ? { type: 'image/jpeg', data: bytes } : null;
    }
  }
  return applyPulledPlayer(row, photo);
}
