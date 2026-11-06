import type { SupabaseClient } from '@supabase/supabase-js';
import type { PhotoData } from '../store/rosterDb';
import type { PushRow } from './rows';

export const PHOTO_BUCKET = 'player-photos';

/** Why a request failed: no connection, a session that is no longer accepted, or anything else. */
export type RemoteFailure = 'offline' | 'auth' | 'server';

export class RemoteError extends Error {
  constructor(readonly kind: RemoteFailure) {
    super(`Sync request failed (${kind})`);
    this.name = 'RemoteError';
  }
}

/** True for a `RemoteError`, even one made by another copy of this module (as when a test runs two devices). */
export function isRemoteError(error: unknown): error is RemoteError {
  return error instanceof Error && error.name === 'RemoteError' && typeof (error as { kind?: unknown }).kind === 'string';
}

/** What the sync engine asks of the server. Rows come back unchecked: the engine validates them. */
export interface Remote {
  /** Inserts or updates one player. `nameTaken` means another live player of this organizer already has the name. */
  upsertPlayer(row: PushRow): Promise<'ok' | 'nameTaken'>;
  /** Every player that is not deleted. */
  listLive(): Promise<unknown[]>;
  /** Every player written at or after `since` (an ISO time), or all of them, oldest write first. */
  pull(since: string | undefined): Promise<unknown[]>;
  /** Stores a JPEG at a path that is never reused. A file already there counts as stored. */
  uploadPhoto(path: string, photo: PhotoData): Promise<void>;
  /** The bytes at a path, or null when there is no such file. */
  downloadPhoto(path: string): Promise<ArrayBuffer | null>;
  /** The names of the files in a folder. */
  listPhotoFiles(folder: string): Promise<string[]>;
  removePhotoFiles(paths: string[]): Promise<void>;
}

/** Photos live at `{owner id}/{player id}/{photo_seq}.jpg`, with the owner id in lower case. */
export const photoFolder = (ownerId: string, playerId: string) => `${ownerId.toLowerCase()}/${playerId.toLowerCase()}`;
export const photoPath = (ownerId: string, playerId: string, seq: number) => `${photoFolder(ownerId, playerId)}/${seq}.jpg`;

interface Failure {
  message?: string;
  status?: number;
  statusCode?: string;
  code?: string;
}

const NETWORK = /failed to fetch|network|load failed|fetch failed/i;

/** Turns a failed request into a `RemoteError`. Status 0 is how supabase-js reports a request that never arrived. */
function fail(error: Failure, status?: number): never {
  const code = status ?? error.status;
  const offline = code === 0 || NETWORK.test(error.message ?? '') || (typeof navigator !== 'undefined' && navigator.onLine === false);
  throw new RemoteError(offline ? 'offline' : code === 401 || error.code === 'PGRST301' ? 'auth' : 'server');
}

const isExists = (error: Failure) => error.status === 409 || error.statusCode === '409' || error.code === 'ResourceAlreadyExists';
const isMissing = (error: Failure) =>
  error.status === 404 || error.statusCode === '404' || error.code === 'NoSuchKey' || /not found/i.test(error.message ?? '');

/** The server answers at most this many rows a request, so longer lists are read a page at a time. */
const PAGE = 500;

/** The real server, as the signed-in organizer `ownerId`. */
export function supabaseRemote(client: SupabaseClient, ownerId: string): Remote {
  const bucket = () => client.storage.from(PHOTO_BUCKET);

  async function allRows(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: Failure | null; status: number }>) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error, status } = await page(from, from + PAGE - 1);
      if (error) fail(error, status);
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) return rows;
    }
  }

  return {
    async upsertPlayer(row) {
      const { error, status } = await client.from('players').upsert({ owner_id: ownerId, ...row }, { onConflict: 'owner_id,id' });
      if (!error) return 'ok';
      // 23505 is a unique violation. The only unique rule besides the key is the name, and an upsert handles the key.
      if (error.code === '23505') return 'nameTaken';
      return fail(error, status);
    },
    listLive() {
      return allRows((from, to) => client.from('players').select('*').is('deleted_at', null).order('id').range(from, to));
    },
    pull(since) {
      return allRows((from, to) => {
        const query = client.from('players').select('*');
        return (since === undefined ? query : query.gte('updated_at', since))
          .order('updated_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to);
      });
    },
    async uploadPhoto(path, photo) {
      const body = new Blob([photo.data], { type: 'image/jpeg' });
      const { error } = await bucket().upload(path, body, { contentType: 'image/jpeg', upsert: false });
      if (error && !isExists(error)) fail(error as Failure);
    },
    async downloadPhoto(path) {
      const { data, error } = await bucket().download(path);
      if (error) {
        if (isMissing(error as Failure)) return null;
        fail(error as Failure);
      }
      return data.arrayBuffer();
    },
    async listPhotoFiles(folder) {
      const { data, error } = await bucket().list(folder, { limit: 100 });
      if (error) fail(error as Failure);
      return data.map((file) => file.name);
    },
    async removePhotoFiles(paths) {
      if (paths.length === 0) return;
      const { error } = await bucket().remove(paths);
      if (error) fail(error as Failure);
    },
  };
}
