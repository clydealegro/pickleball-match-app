import type { PGlite } from '@electric-sql/pglite';
import { RemoteError } from '../remote';
import { run } from '../db/harness';
import type { LiveRemote } from './remote';

export interface LiveFakeFlags {
  /** While true every call fails as if the phone had no signal. */
  offline: boolean;
  calls: string[];
}

/** A `LiveRemote` over the real migrations in an in-memory database, as organizer `ownerId`. For tests. */
export function fakeLiveRemote(db: PGlite, ownerId: string, flags: LiveFakeFlags = { offline: false, calls: [] }): LiveRemote {
  const as = { user: ownerId };
  async function go<T>(name: string, job: () => Promise<T>): Promise<T> {
    flags.calls.push(name);
    if (flags.offline) throw new RemoteError('offline');
    try {
      return await job();
    } catch {
      throw new RemoteError('server');
    }
  }
  return {
    publish: (p) =>
      go('publish', async () => {
        await run(
          db,
          as,
          `insert into public.live_boards (slot_id, session_id, snapshot, version, active, paused, show_photos)
           values ($1, $2, $3::jsonb, $4, true, $5, $6)
           on conflict (owner_id, slot_id) do update set session_id = excluded.session_id, snapshot = excluded.snapshot,
             version = excluded.version, active = true, paused = excluded.paused, show_photos = excluded.show_photos`,
          [p.slotId, p.sessionId, JSON.stringify(p.board), p.version, p.paused, p.showPhotos],
        );
      }),
    heartbeat: (slotId, sessionId) =>
      go('heartbeat', async () => {
        await run(db, as, 'update public.live_boards set session_id = $2 where slot_id = $1 and active', [slotId, sessionId]);
      }),
    putFaces: (slotId, faces) =>
      go('putFaces', async () => {
        for (const f of faces) {
          await run(
            db,
            as,
            `insert into public.live_photos (slot_id, roster_id, photo_seq, data) values ($1, $2, $3, $4)
             on conflict (owner_id, slot_id, roster_id) do update set photo_seq = excluded.photo_seq, data = excluded.data`,
            [slotId, f.rosterId, f.seq, f.data],
          );
        }
      }),
    removeFaces: (slotId) =>
      go('removeFaces', async () => {
        await run(db, as, 'delete from public.live_photos where slot_id = $1', [slotId]);
      }),
    stop: (slotId) =>
      go('stop', async () => {
        await run(db, as, 'update public.live_boards set active = false where slot_id = $1', [slotId]);
        await run(db, as, 'delete from public.live_photos where slot_id = $1', [slotId]);
      }),
  };
}
