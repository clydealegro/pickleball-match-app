import type { PGlite } from '@electric-sql/pglite';
import type { PhotoData } from '../store/rosterDb';
import { createDb, run } from './db/harness';
import { RemoteError, type Remote } from './remote';
import type { PushRow } from './rows';

/** The server's file size limit for player photos. */
const MAX_PHOTO_BYTES = 204800;

/**
 * A stand-in for the real server, for tests: the real database rules (the migrations run in an in-memory Postgres,
 * with row-level security, the unique name rule and the server-set `updated_at`) and a small photo store that
 * applies the bucket's rules. Several organizers can use it, each through `remote(user)`.
 */
export interface FakeServer {
  db: PGlite;
  /** Photo files by path. */
  files: Map<string, PhotoData>;
  /** What each remote was asked, in order, as `method` or `method:detail`. */
  calls: string[];
  /** While set, every request fails the way a request with no connection does. */
  offline: boolean;
  /** Pushes of these player ids are refused, as if the server failed on them. */
  refuse: Set<string>;
  /** Every photo download fails with no connection. */
  downloadsOffline: boolean;
  remote(user: string): Remote;
  close(): Promise<void>;
}

const text = (value: unknown) => (value instanceof Date ? value.toISOString() : value);

export async function createFakeServer(): Promise<FakeServer> {
  const db = await createDb();
  const server: FakeServer = {
    db,
    files: new Map(),
    calls: [],
    offline: false,
    refuse: new Set(),
    downloadsOffline: false,
    remote(user) {
      const guard = (call: string) => {
        server.calls.push(call);
        if (server.offline) throw new RemoteError('offline');
      };
      const rows = async (sql: string, params: unknown[] = []) =>
        (await run(db, { user }, sql, params)).rows.map((row) =>
          Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([k, v]) => [k, text(v)])),
        );
      const columns = 'id, name, photo_version, photo_seq, last_played_at, deleted_at, updated_at';
      return {
        async upsertPlayer(row: PushRow) {
          guard(`upsertPlayer:${row.id}`);
          if (server.refuse.has(row.id)) throw new RemoteError('server');
          try {
            await run(
              db,
              { user },
              `insert into public.players (owner_id, id, name, photo_version, photo_seq, last_played_at, deleted_at)
               values ($1, $2, $3, $4, $5, $6, $7)
               on conflict (owner_id, id) do update set name = excluded.name, photo_version = excluded.photo_version,
                 photo_seq = excluded.photo_seq, last_played_at = excluded.last_played_at, deleted_at = excluded.deleted_at`,
              [user, row.id, row.name, row.photo_version, row.photo_seq, row.last_played_at, row.deleted_at],
            );
            return 'ok';
          } catch (error) {
            if ((error as { code?: string }).code === '23505') return 'nameTaken';
            throw error;
          }
        },
        async listLive() {
          guard('listLive');
          return rows(`select ${columns} from public.players where deleted_at is null order by id`);
        },
        async pull(since) {
          guard(`pull:${since ?? 'all'}`);
          return rows(
            `select ${columns} from public.players where ($1::timestamptz is null or updated_at >= $1::timestamptz)
             order by updated_at, id`,
            [since ?? null],
          );
        },
        async uploadPhoto(path, photo) {
          guard(`uploadPhoto:${path}`);
          if (path.split('/')[0] !== user.toLowerCase()) throw new RemoteError('server');
          if (photo.type !== 'image/jpeg' || photo.data.byteLength > MAX_PHOTO_BYTES) throw new RemoteError('server');
          if (!server.files.has(path)) server.files.set(path, { type: photo.type, data: photo.data.slice(0) });
        },
        async downloadPhoto(path) {
          guard(`downloadPhoto:${path}`);
          if (server.downloadsOffline) throw new RemoteError('offline');
          return server.files.get(path)?.data.slice(0) ?? null;
        },
        async listPhotoFiles(folder) {
          guard(`listPhotoFiles:${folder}`);
          return [...server.files.keys()].filter((p) => p.startsWith(`${folder}/`)).map((p) => p.slice(folder.length + 1));
        },
        async removePhotoFiles(paths) {
          guard(`removePhotoFiles:${paths.length}`);
          for (const path of paths) server.files.delete(path);
        },
      };
    },
    close: () => db.close(),
  };
  return server;
}
